// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ProofOfImpact} from "./ProofOfImpact.sol";

/// @title GlassVault — verifiable NGO fund flows
/// @notice Implements the 4 evaluation roots:
///   ① Inbound Donation        — purpose-tagged lots (`donate`, `donateFor` for bridged funds)
///   ② Escrow Condition        — category, budget, challenge window, milestone split, refunds
///   ③ Off-Chain Invoice Proof — EIP-712 vendor signature + file hash + invoice nullifier
///   ④ Impact Verification     — beneficiary Merkle proof + delivery nullifier → Proof-of-Impact token
/// @dev No admin role. Funds move only by these rules. Fraud attempts are RECORDED (not reverted)
///      so they count toward an automatic on-chain freeze. Disputes are settled by the donors
///      whose money is at stake, not by a central auditor.
contract GlassVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────── types ───────────────────────────

    enum Category { Water, Medical, Education }
    enum PayoutStatus { None, Pending, Released, Completed, Challenged, Cancelled }
    /// @dev OverBudget and AmountMismatch are emitted as `Discrepancy` (recorded, not counted toward a
    ///      freeze — stale balances cause them honestly). VendorDoubleSign slashes the vendor, not the NGO.
    enum FraudReason { DuplicateInvoice, ForgedSignature, OutOfCategory, OverBudget, AmountMismatch, UnregisteredVendor, ChallengeUpheld, VendorDoubleSign, DuplicateFiatProof, UnexplainedTransfer }

    struct NGO {
        address admin;
        string name;
        uint256 bond;
        uint32 flagCount;
        uint32 payoutsTotal;
        uint32 payoutsCompleted;
        uint32 challengesLost;
        bool frozen;
    }

    struct Vendor {
        bool registered;
        Category category;
        bytes32 nameHash; // e.g. keccak(GSTIN) — no plaintext on-chain
        uint256 stake;
        bool slashed;     // a slashed vendor can never register again (under any category)
        bool offRamp;     // fiat payment agent: receives dINR, pays local vendors in rupees, must prove it
    }

    /// @notice One donation = one tagged lot of money.
    struct Lot {
        address donor;
        uint256 ngoId;
        Category category;
        uint256 amount;
        uint256 remaining; // not yet reserved by any payout
        uint64 deadline;   // proof deadline — donor can reclaim unspent funds after it
        uint64 sourceChain; // chain the donation originated on (multi-chain tracking)
    }

    /// @notice What the vendor signs. Field-level so a re-scanned file still yields the same nullifier.
    struct Invoice {
        address vendor;
        uint256 ngoId;
        bytes32 invoiceNo; // keccak of the printed invoice number
        uint256 amount;
        uint64 date;
        Category category;
        bytes32 fileHash;  // keccak of the uploaded file (stored on IPFS)
    }

    struct Payout {
        uint256 ngoId;
        address vendor;
        uint256 amount;
        uint256 paid;
        bytes32 nullifier;
        bytes32 fileHash;
        Category category;
        PayoutStatus status;
        uint64 releaseAt;
        bytes32 beneficiaryRoot;
        uint32 deliveriesRequired;
        uint32 deliveries;
    }

    /// @notice What an off-ramp agent signs after paying a local (fiat-only) vendor in rupees.
    ///         Links the on-chain payout to one bank transfer; a bank reference can back only one payout.
    struct FiatSettlement {
        uint256 payoutId;
        uint256 fiatAmount;  // rupees paid out, 18 decimals like dINR
        bytes32 bankRefHash; // keccak of the bank transfer reference (UTR) — no account data on-chain
        bytes32 payeeHash;   // keccak of the local payee (shop name / GSTIN)
        uint64 paidAt;
    }

    struct LotShare {
        uint256 lotId;
        uint256 amount;
    }

    struct Challenge {
        address challenger;
        bytes32 evidenceHash;
        string evidenceURI;
        uint256 votesUphold;
        uint256 votesReject;
        uint64 voteEnd;
        bool resolved;
        bool upheld;
    }

    bytes32 public constant INVOICE_TYPEHASH = keccak256(
        "Invoice(address vendor,uint256 ngoId,bytes32 invoiceNo,uint256 amount,uint64 date,uint8 category,bytes32 fileHash)"
    );

    bytes32 public constant FIAT_TYPEHASH = keccak256(
        "FiatSettlement(uint256 payoutId,uint256 fiatAmount,bytes32 bankRefHash,bytes32 payeeHash,uint64 paidAt)"
    );

    uint8 public constant FRAUD_THRESHOLD = 2;
    uint256 public constant INVOICE_RELEASE_BPS = 7000; // 70% on invoice proof, 30% on impact proof
    uint256 public constant NGO_BOND = 10_000 ether;    // dINR (18 decimals)
    uint256 public constant VENDOR_STAKE = 5_000 ether;
    uint256 public constant CHALLENGE_BOND = 500 ether;

    // ─────────────────────────── state ───────────────────────────

    IERC20 public immutable token;
    ProofOfImpact public immutable impactToken;
    uint64 public immutable challengeWindow;
    address public immutable bridgeGateway; // only source of cross-chain lots
    uint64 public constant MIN_PROOF_PERIOD = 1 hours;

    NGO[] internal _ngos;
    Lot[] internal _lots;
    Payout[] internal _payouts;
    mapping(uint256 => LotShare[]) internal _payoutShares;
    mapping(uint256 => Challenge) internal _challenges;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => Vendor) public vendors;

    /// @notice Global invoice nullifier set — shared across every NGO and every donor.
    mapping(bytes32 => uint256) public nullifierToPayout; // payoutId + 1 (0 = unused)
    /// @notice Delivery nullifiers — one beneficiary can confirm a payout only once.
    mapping(bytes32 => bool) public deliveryUsed;
    /// @notice A beneficiary batch proves delivery for exactly one payout, so the same cards can't
    ///         "prove" every invoice.
    mapping(bytes32 => bool) public rootUsed;
    /// @notice Off-ramp evidence: payoutId → bank reference that settled it (0 = not settled).
    mapping(uint256 => bytes32) public fiatProof;
    /// @notice Global bank-reference nullifier set — one bank transfer can't settle two payouts.
    mapping(bytes32 => bool) public bankRefUsed;
    mapping(uint256 => uint64) public releasedAt;

    // ─────────────────────────── events ──────────────────────────

    event NGORegistered(uint256 indexed ngoId, address indexed admin, string name, uint256 bond);
    event VendorRegistered(address indexed vendor, Category category, bytes32 nameHash, uint256 stake);
    event Donated(uint256 indexed lotId, uint256 indexed ngoId, address indexed donor, Category category, uint256 amount, uint64 deadline);
    event CrossChainDonation(uint256 indexed lotId, uint64 sourceChain, address indexed relayer);
    event PayoutRequested(uint256 indexed payoutId, uint256 indexed ngoId, address indexed vendor, uint256 amount, bytes32 nullifier, bytes32 fileHash, uint64 releaseAt);
    event LotCharged(uint256 indexed payoutId, uint256 indexed lotId, uint256 amount);
    event PayoutReleased(uint256 indexed payoutId, uint256 amount);
    event DeliveryConfirmed(uint256 indexed payoutId, bytes32 deliveryNullifier, uint32 deliveries, uint32 required);
    event ImpactVerified(uint256 indexed payoutId, uint256 finalAmount);
    event FraudFlagged(uint256 indexed ngoId, FraudReason reason, bytes32 nullifier, bytes32 fileHash, uint32 flagCount);
    event NGOFrozen(uint256 indexed ngoId, uint32 flagCount);
    event Discrepancy(uint256 indexed ngoId, FraudReason reason, bytes32 nullifier, bytes32 fileHash);
    event VendorSlashed(address indexed vendor, uint256 amount, bytes32 nullifier);
    event OffRampRegistered(address indexed agent);
    event FiatSettled(uint256 indexed payoutId, address indexed agent, uint256 fiatAmount, bytes32 bankRefHash, bytes32 payeeHash, uint64 paidAt);
    event UnexplainedTransfer(uint256 indexed payoutId, address indexed agent, address indexed reporter, uint256 reward);
    event Challenged(uint256 indexed payoutId, address indexed challenger, bytes32 evidenceHash, string evidenceURI, uint64 voteEnd);
    event Voted(uint256 indexed payoutId, address indexed donor, bool uphold, uint256 weight);
    event ChallengeResolved(uint256 indexed payoutId, bool upheld, uint256 reward);
    event PayoutUnwound(uint256 indexed payoutId, uint256 returnedToLots);
    event Reclaimed(uint256 indexed lotId, address indexed donor, uint256 amount);

    error NotNGOAdmin();
    error NGOIsFrozen();
    error UnknownNGO();
    error ZeroAmount();
    error BadPayout();
    error WindowOpen();
    error WindowClosed();
    error InvalidProof();
    error AlreadyDelivered();
    error NotDonorOfPayout();
    error AlreadyVoted();
    error VotingOpen();
    error NotLotDonor();
    error NotReclaimable();
    error OnlyGateway();
    error DeadlineTooSoon();
    error LotExpired();
    error ImpactProofRequired();
    error CategoryLocked();
    error VendorBanned();
    error RootAlreadyUsed();
    error RoleLocked();
    error NotOffRamp();
    error BadSettlement();
    error SettlementOpen();

    constructor(IERC20 token_, uint64 challengeWindow_, address bridgeGateway_) EIP712("GlassVault", "1") {
        token = token_;
        challengeWindow = challengeWindow_;
        bridgeGateway = bridgeGateway_;
        impactToken = new ProofOfImpact(address(this));
    }

    // ─────────────────────── registration ────────────────────────

    /// @notice NGOs post a bond. It is slashed to whoever proves fraud against them.
    function registerNGO(string calldata name) external nonReentrant returns (uint256 ngoId) {
        ngoId = _ngos.length;
        _ngos.push(NGO({admin: msg.sender, name: name, bond: NGO_BOND, flagCount: 0, payoutsTotal: 0, payoutsCompleted: 0, challengesLost: 0, frozen: false}));
        emit NGORegistered(ngoId, msg.sender, name, NGO_BOND);
        token.safeTransferFrom(msg.sender, address(this), NGO_BOND);
    }

    /// @notice Vendors stake to be allowed to sign invoices. A fake vendor costs real money.
    ///         Category is fixed once registered, so a vendor can't re-categorise to frame an NGO.
    function registerVendor(Category category, bytes32 nameHash) external nonReentrant {
        _registerVendor(category, nameHash, false);
    }

    /// @notice A fiat payment agent (off-ramp) stakes like a vendor. Payouts to it must later be
    ///         settled with a signed FiatSettlement, or anyone can flag them as unexplained.
    function registerOffRamp(Category category, bytes32 nameHash) external nonReentrant {
        _registerVendor(category, nameHash, true);
        emit OffRampRegistered(msg.sender);
    }

    function _registerVendor(Category category, bytes32 nameHash, bool offRamp) internal {
        Vendor storage v = vendors[msg.sender];
        if (v.slashed) revert VendorBanned();
        if (v.registered && v.category != category) revert CategoryLocked();
        if (v.registered && v.offRamp != offRamp) revert RoleLocked();
        v.offRamp = offRamp;
        bool topUp = v.stake < VENDOR_STAKE;
        uint256 due = topUp ? VENDOR_STAKE - v.stake : 0;
        v.registered = true;
        v.category = category;
        v.nameHash = nameHash;
        v.stake = VENDOR_STAKE;
        emit VendorRegistered(msg.sender, category, nameHash, VENDOR_STAKE);
        if (due > 0) token.safeTransferFrom(msg.sender, address(this), due);
    }

    // ─────────────────── ① inbound donation ──────────────────────

    function donate(uint256 ngoId, Category category, uint256 amount, uint64 deadline) external returns (uint256) {
        return _donate(msg.sender, ngoId, category, amount, deadline, uint64(block.chainid));
    }

    /// @notice Donation arriving from another chain via the bridge gateway. The lot keeps the
    ///         original donor and source chain, so the tag survives the hop.
    function donateFor(address donor, uint256 ngoId, Category category, uint256 amount, uint64 deadline, uint64 sourceChain)
        external
        returns (uint256 lotId)
    {
        if (msg.sender != bridgeGateway) revert OnlyGateway();
        lotId = _donate(donor, ngoId, category, amount, deadline, sourceChain);
        emit CrossChainDonation(lotId, sourceChain, msg.sender);
    }

    function _donate(address donor, uint256 ngoId, Category category, uint256 amount, uint64 deadline, uint64 sourceChain)
        internal
        nonReentrant
        returns (uint256 lotId)
    {
        if (_ngo(ngoId).frozen) revert NGOIsFrozen();
        if (amount == 0) revert ZeroAmount();
        if (deadline < block.timestamp + MIN_PROOF_PERIOD) revert DeadlineTooSoon();

        lotId = _lots.length;
        _lots.push(Lot({donor: donor, ngoId: ngoId, category: category, amount: amount, remaining: amount, deadline: deadline, sourceChain: sourceChain}));
        emit Donated(lotId, ngoId, donor, category, amount, deadline);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ─────────── ② escrow condition + ③ invoice proof ───────────

    function invoiceDigest(Invoice calldata inv) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(INVOICE_TYPEHASH, inv.vendor, inv.ngoId, inv.invoiceNo, inv.amount, inv.date, uint8(inv.category), inv.fileHash))
        );
    }

    /// @notice Field-level nullifier. Excludes fileHash and ngoId, so a re-scanned or
    ///         re-used invoice collides no matter which NGO or donor report it appears in.
    function invoiceNullifier(Invoice calldata inv) public pure returns (bytes32) {
        return keccak256(abi.encode(inv.vendor, inv.invoiceNo, inv.date, inv.amount));
    }

    /// @notice NGO requests a payout backed by a vendor-signed invoice, charged to specific donor lots.
    /// @return payoutId id of the new payout, or type(uint256).max if the request was flagged as fraud.
    function requestPayout(
        Invoice calldata inv,
        bytes calldata vendorSig,
        LotShare[] calldata shares,
        bytes32 beneficiaryRoot,
        uint32 deliveriesRequired
    ) external nonReentrant returns (uint256 payoutId) {
        NGO storage org = _ngo(inv.ngoId);
        if (msg.sender != org.admin) revert NotNGOAdmin();
        if (org.frozen) revert NGOIsFrozen();
        if (inv.amount == 0) revert ZeroAmount();
        // root ④ is mandatory: no payout can skip beneficiary proof
        if (deliveriesRequired == 0 || beneficiaryRoot == bytes32(0)) revert ImpactProofRequired();

        bytes32 nullifier = invoiceNullifier(inv);

        // ③ off-chain invoice proof checks — each failure is recorded as a fraud flag
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(invoiceDigest(inv), vendorSig);
        bool vendorSigned = err == ECDSA.RecoverError.NoError && signer == inv.vendor;
        uint256 prior = nullifierToPayout[nullifier];
        if (prior != 0) {
            // The vendor validly signed the same invoice for a second NGO: the vendor double-sold the
            // evidence, so the vendor is slashed and the NGO is not blamed (stops vendors framing NGOs).
            if (vendorSigned && _payouts[prior - 1].ngoId != inv.ngoId) return _slashVendor(inv.vendor, org, nullifier);
            // Same NGO reusing it (double-counting across donors), or a copy with a doctored signature.
            return _flag(inv.ngoId, FraudReason.DuplicateInvoice, nullifier, inv.fileHash);
        }
        if (!vendorSigned) return _flag(inv.ngoId, FraudReason.ForgedSignature, nullifier, inv.fileHash);
        Vendor memory v = vendors[inv.vendor];
        if (!v.registered) return _flag(inv.ngoId, FraudReason.UnregisteredVendor, nullifier, inv.fileHash);
        if (v.category != inv.category) return _flag(inv.ngoId, FraudReason.OutOfCategory, nullifier, inv.fileHash);

        // ② escrow conditions on every charged lot
        uint256 total;
        for (uint256 i; i < shares.length; ++i) {
            Lot storage l = _lots[shares[i].lotId];
            // expired lots belong to the donor's reclaim right — revert, don't flag (prevents reclaim front-run griefing)
            if (block.timestamp > l.deadline) revert LotExpired();
            if (l.ngoId != inv.ngoId || l.category != inv.category) return _flag(inv.ngoId, FraudReason.OutOfCategory, nullifier, inv.fileHash);
            if (shares[i].amount > l.remaining) return _discrepancy(inv.ngoId, FraudReason.OverBudget, nullifier, inv.fileHash);
            total += shares[i].amount;
        }
        if (total != inv.amount) return _discrepancy(inv.ngoId, FraudReason.AmountMismatch, nullifier, inv.fileHash);
        if (rootUsed[beneficiaryRoot]) revert RootAlreadyUsed();

        // all checks passed — reserve funds and open the challenge window
        rootUsed[beneficiaryRoot] = true;
        payoutId = _payouts.length;
        uint64 releaseAt = uint64(block.timestamp) + challengeWindow;
        _payouts.push(Payout({
            ngoId: inv.ngoId,
            vendor: inv.vendor,
            amount: inv.amount,
            paid: 0,
            nullifier: nullifier,
            fileHash: inv.fileHash,
            category: inv.category,
            status: PayoutStatus.Pending,
            releaseAt: releaseAt,
            beneficiaryRoot: beneficiaryRoot,
            deliveriesRequired: deliveriesRequired,
            deliveries: 0
        }));
        nullifierToPayout[nullifier] = payoutId + 1;
        org.payoutsTotal += 1;

        for (uint256 i; i < shares.length; ++i) {
            _lots[shares[i].lotId].remaining -= shares[i].amount;
            _payoutShares[payoutId].push(shares[i]);
            emit LotCharged(payoutId, shares[i].lotId, shares[i].amount);
        }
        emit PayoutRequested(payoutId, inv.ngoId, inv.vendor, inv.amount, nullifier, inv.fileHash, releaseAt);
    }

    /// @notice After the challenge window, anyone can release the invoice tranche (70%) to the vendor.
    function release(uint256 payoutId) external nonReentrant {
        Payout storage p = _payout(payoutId);
        if (p.status != PayoutStatus.Pending) revert BadPayout();
        if (_ngos[p.ngoId].frozen) revert NGOIsFrozen();
        if (block.timestamp < p.releaseAt) revert WindowOpen();

        uint256 tranche = (p.amount * INVOICE_RELEASE_BPS) / 10_000;
        p.status = PayoutStatus.Released;
        p.paid = tranche;
        releasedAt[payoutId] = uint64(block.timestamp);
        emit PayoutReleased(payoutId, tranche);
        token.safeTransfer(p.vendor, tranche);

        if (_impactProven(payoutId, p)) _complete(payoutId, p);
    }

    // ───────────── ④ cryptographic impact verification ─────────────

    /// @notice A beneficiary's QR card holds `secret`. The NGO only published a Merkle root of
    ///         commitments, so identities never touch the chain.
    /// @dev leaf = keccak256(bytes.concat(keccak256(abi.encode(commitment)))), commitment = keccak256(abi.encode(secret))
    function confirmDelivery(uint256 payoutId, bytes32 secret, bytes32[] calldata proof) external nonReentrant {
        Payout storage p = _payout(payoutId);
        if (p.status != PayoutStatus.Pending && p.status != PayoutStatus.Released) revert BadPayout();
        if (_ngos[p.ngoId].frozen) revert NGOIsFrozen();

        bytes32 commitment = keccak256(abi.encode(secret));
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(commitment))));
        if (!MerkleProof.verifyCalldata(proof, p.beneficiaryRoot, leaf)) revert InvalidProof();

        bytes32 deliveryNullifier = keccak256(abi.encode(payoutId, commitment));
        if (deliveryUsed[deliveryNullifier]) revert AlreadyDelivered();
        deliveryUsed[deliveryNullifier] = true;

        p.deliveries += 1;
        emit DeliveryConfirmed(payoutId, deliveryNullifier, p.deliveries, p.deliveriesRequired);

        if (p.status == PayoutStatus.Released && _impactProven(payoutId, p)) _complete(payoutId, p);
    }

    // ───────────────────── off-chain fiat off-ramp ─────────────────────

    function fiatDigest(FiatSettlement calldata f) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(FIAT_TYPEHASH, f.payoutId, f.fiatAmount, f.bankRefHash, f.payeeHash, f.paidAt)));
    }

    /// @notice Deadline for an off-ramp payout's fiat settlement (0 until released).
    function fiatDeadline(uint256 payoutId) public view returns (uint64) {
        uint64 t = releasedAt[payoutId];
        return t == 0 ? 0 : t + 2 * challengeWindow;
    }

    /// @notice Records the agent-signed proof that a released payout was paid out in rupees. Anyone can
    ///         submit it (the agent's signature is the proof). A bank reference already used for
    ///         another payout is double-counted evidence: recorded as a fraud flag on the NGO.
    /// @return settled false if the settlement was flagged as a duplicate.
    function attestFiat(FiatSettlement calldata f, bytes calldata agentSig) external nonReentrant returns (bool settled) {
        Payout storage p = _payout(f.payoutId);
        if (!vendors[p.vendor].offRamp) revert NotOffRamp();
        if (p.status != PayoutStatus.Released || fiatProof[f.payoutId] != 0) revert BadPayout();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(fiatDigest(f), agentSig);
        if (err != ECDSA.RecoverError.NoError || signer != p.vendor) revert BadSettlement();
        // paid in rupees after the money left escrow, never in the future, never more than the invoice
        if (f.bankRefHash == bytes32(0) || f.fiatAmount == 0 || f.fiatAmount > p.amount) revert BadSettlement();
        if (f.paidAt < releasedAt[f.payoutId] || f.paidAt > block.timestamp) revert BadSettlement();

        if (bankRefUsed[f.bankRefHash]) {
            _flag(p.ngoId, FraudReason.DuplicateFiatProof, f.bankRefHash, p.fileHash);
            return false;
        }
        bankRefUsed[f.bankRefHash] = true;
        fiatProof[f.payoutId] = f.bankRefHash;
        emit FiatSettled(f.payoutId, p.vendor, f.fiatAmount, f.bankRefHash, f.payeeHash, f.paidAt);
        if (_impactProven(f.payoutId, p)) _complete(f.payoutId, p);
        return true;
    }

    /// @notice An off-ramp payout released but never proven paid in rupees is an unexplained transfer.
    ///         After the deadline anyone can flag it: the agent's stake goes to the reporter, the agent is
    ///         banned, the NGO gets a fraud flag, and the unpaid 30% returns to the donors' lots.
    function flagUnsettled(uint256 payoutId) external nonReentrant {
        Payout storage p = _payout(payoutId);
        if (!vendors[p.vendor].offRamp) revert NotOffRamp();
        if (p.status != PayoutStatus.Released || fiatProof[payoutId] != 0) revert BadPayout();
        if (block.timestamp <= fiatDeadline(payoutId)) revert SettlementOpen();

        Vendor storage v = vendors[p.vendor];
        uint256 reward = v.stake;
        v.stake = 0;
        v.registered = false;
        v.slashed = true;
        _unwind(payoutId, p);
        _flag(p.ngoId, FraudReason.UnexplainedTransfer, p.nullifier, p.fileHash);
        emit UnexplainedTransfer(payoutId, p.vendor, msg.sender, reward);
        if (reward > 0) token.safeTransfer(msg.sender, reward);
    }

    /// @dev Root ④ is met when enough beneficiaries confirmed — and, for off-ramp payouts, the rupee
    ///      payment to the local vendor is proven too.
    function _impactProven(uint256 payoutId, Payout storage p) internal view returns (bool) {
        return p.deliveries >= p.deliveriesRequired && (!vendors[p.vendor].offRamp || fiatProof[payoutId] != 0);
    }

    // ───────────────── challenge court (no auditor) ─────────────────

    /// @notice Anyone can dispute a pending payout during its window by posting a bond + evidence.
    ///         The donors whose lots fund the payout then vote, weighted by their money at stake.
    function challenge(uint256 payoutId, bytes32 evidenceHash, string calldata evidenceURI) external nonReentrant {
        Payout storage p = _payout(payoutId);
        if (p.status != PayoutStatus.Pending) revert BadPayout();
        if (block.timestamp >= p.releaseAt) revert WindowClosed();

        p.status = PayoutStatus.Challenged;
        uint64 voteEnd = uint64(block.timestamp) + challengeWindow;
        _challenges[payoutId] = Challenge({
            challenger: msg.sender,
            evidenceHash: evidenceHash,
            evidenceURI: evidenceURI,
            votesUphold: 0,
            votesReject: 0,
            voteEnd: voteEnd,
            resolved: false,
            upheld: false
        });
        emit Challenged(payoutId, msg.sender, evidenceHash, evidenceURI, voteEnd);
        token.safeTransferFrom(msg.sender, address(this), CHALLENGE_BOND);
    }

    function vote(uint256 payoutId, bool uphold) external {
        Challenge storage c = _challenges[payoutId];
        if (_payouts.length <= payoutId || _payouts[payoutId].status != PayoutStatus.Challenged) revert BadPayout();
        if (block.timestamp >= c.voteEnd) revert WindowClosed();
        if (hasVoted[payoutId][msg.sender]) revert AlreadyVoted();

        uint256 weight;
        LotShare[] storage shares = _payoutShares[payoutId];
        for (uint256 i; i < shares.length; ++i) {
            if (_lots[shares[i].lotId].donor == msg.sender) weight += shares[i].amount;
        }
        if (weight == 0) revert NotDonorOfPayout();

        hasVoted[payoutId][msg.sender] = true;
        if (uphold) c.votesUphold += weight;
        else c.votesReject += weight;
        emit Voted(payoutId, msg.sender, uphold, weight);
    }

    /// @notice Upheld: payout cancelled, funds back to lots, NGO bond + vendor stake slashed to the
    ///         challenger, and a fraud flag recorded. Rejected (or tie): payout resumes and the
    ///         challenger's bond compensates the NGO.
    function resolve(uint256 payoutId) external nonReentrant {
        Payout storage p = _payout(payoutId);
        Challenge storage c = _challenges[payoutId];
        if (p.status != PayoutStatus.Challenged || c.resolved) revert BadPayout();
        if (block.timestamp < c.voteEnd) revert VotingOpen();

        c.resolved = true;
        NGO storage org = _ngos[p.ngoId];

        // Quorum: upholding needs a majority of the payout's own funding, not just of the votes cast.
        // Stops a 1-rupee donor from slashing an honest NGO when nobody else votes.
        if (c.votesUphold > c.votesReject && c.votesUphold * 2 > p.amount) {
            c.upheld = true;
            org.challengesLost += 1;
            _unwind(payoutId, p);

            uint256 reward = CHALLENGE_BOND + org.bond / 2;
            org.bond -= org.bond / 2;
            Vendor storage v = vendors[p.vendor];
            reward += v.stake;
            v.stake = 0;
            v.registered = false;
            v.slashed = true;

            _flag(p.ngoId, FraudReason.ChallengeUpheld, p.nullifier, p.fileHash);
            emit ChallengeResolved(payoutId, true, reward);
            token.safeTransfer(c.challenger, reward);
        } else {
            p.status = PayoutStatus.Pending;
            p.releaseAt = uint64(block.timestamp);
            emit ChallengeResolved(payoutId, false, CHALLENGE_BOND);
            token.safeTransfer(org.admin, CHALLENGE_BOND);
        }
    }

    // ─────────────────────── refunds / unwind ───────────────────────

    /// @notice When an NGO is frozen, anyone can return the unpaid part of its payouts to the donor lots.
    function unwindFrozen(uint256 payoutId) external nonReentrant {
        Payout storage p = _payout(payoutId);
        if (!_ngos[p.ngoId].frozen) revert BadPayout();
        // Challenged payouts must go through resolve() first so the challenger's bond is settled.
        if (p.status != PayoutStatus.Pending && p.status != PayoutStatus.Released) revert BadPayout();
        _unwind(payoutId, p);
    }

    /// @notice Donor takes back unspent money if the NGO is frozen or missed the proof deadline.
    function reclaim(uint256 lotId) external nonReentrant {
        Lot storage l = _lots[lotId];
        if (l.donor != msg.sender) revert NotLotDonor();
        if (!_ngos[l.ngoId].frozen && block.timestamp <= l.deadline) revert NotReclaimable();
        uint256 amount = l.remaining;
        if (amount == 0) revert ZeroAmount();
        l.remaining = 0;
        emit Reclaimed(lotId, msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    // ─────────────────────────── internals ───────────────────────────

    /// @dev Returns the unpaid part of a payout to its lots, pro-rata by share.
    function _unwind(uint256 payoutId, Payout storage p) internal {
        uint256 unpaid = p.amount - p.paid;
        p.status = PayoutStatus.Cancelled;
        LotShare[] storage shares = _payoutShares[payoutId];
        uint256 returned;
        for (uint256 i; i < shares.length; ++i) {
            uint256 back = i + 1 == shares.length ? unpaid - returned : (shares[i].amount * unpaid) / p.amount;
            _lots[shares[i].lotId].remaining += back;
            returned += back;
        }
        emit PayoutUnwound(payoutId, returned);
    }

    function _complete(uint256 payoutId, Payout storage p) internal {
        uint256 finalTranche = p.amount - p.paid;
        p.status = PayoutStatus.Completed;
        p.paid = p.amount;
        _ngos[p.ngoId].payoutsCompleted += 1;
        emit ImpactVerified(payoutId, finalTranche);

        // Every donor whose lot funded this payout gets a soulbound Proof-of-Impact token.
        LotShare[] storage shares = _payoutShares[payoutId];
        for (uint256 i; i < shares.length; ++i) {
            impactToken.mint(_lots[shares[i].lotId].donor, payoutId, shares[i].lotId, shares[i].amount);
        }
        token.safeTransfer(p.vendor, finalTranche);
    }

    function _flag(uint256 ngoId, FraudReason reason, bytes32 nullifier, bytes32 fileHash) internal returns (uint256) {
        NGO storage org = _ngos[ngoId];
        org.flagCount += 1;
        emit FraudFlagged(ngoId, reason, nullifier, fileHash, org.flagCount);
        if (org.flagCount >= FRAUD_THRESHOLD && !org.frozen) {
            org.frozen = true;
            emit NGOFrozen(ngoId, org.flagCount);
        }
        return type(uint256).max;
    }

    /// @dev Recorded on-chain for donors and the reconciler, but not counted toward a freeze.
    function _discrepancy(uint256 ngoId, FraudReason reason, bytes32 nullifier, bytes32 fileHash) internal returns (uint256) {
        emit Discrepancy(ngoId, reason, nullifier, fileHash);
        return type(uint256).max;
    }

    /// @dev The slashed stake joins the honest NGO's bond: it stays escrowed and remains slashable.
    function _slashVendor(address vendor, NGO storage org, bytes32 nullifier) internal returns (uint256) {
        Vendor storage v = vendors[vendor];
        uint256 amount = v.stake;
        v.stake = 0;
        v.registered = false;
        v.slashed = true;
        org.bond += amount;
        emit VendorSlashed(vendor, amount, nullifier);
        return type(uint256).max;
    }

    function _ngo(uint256 id) internal view returns (NGO storage) {
        if (id >= _ngos.length) revert UnknownNGO();
        return _ngos[id];
    }

    function _payout(uint256 id) internal view returns (Payout storage) {
        if (id >= _payouts.length) revert BadPayout();
        return _payouts[id];
    }

    // ─────────────────────────── views ───────────────────────────

    /// @notice 0–100 reputation computed purely from on-chain history.
    function trustScore(uint256 ngoId) external view returns (uint256) {
        NGO storage org = _ngo(ngoId);
        if (org.frozen) return 0;
        int256 score = 60;
        if (org.payoutsTotal > 0) score += int256(uint256(40) * org.payoutsCompleted / org.payoutsTotal);
        score -= int256(uint256(org.flagCount)) * 20;
        score -= int256(uint256(org.challengesLost)) * 25;
        if (score < 0) return 0;
        return score > 100 ? 100 : uint256(score);
    }

    function ngo(uint256 id) external view returns (NGO memory) { return _ngos[id]; }
    function lot(uint256 id) external view returns (Lot memory) { return _lots[id]; }
    function payout(uint256 id) external view returns (Payout memory) { return _payouts[id]; }
    function payoutShares(uint256 id) external view returns (LotShare[] memory) { return _payoutShares[id]; }
    function challengeOf(uint256 id) external view returns (Challenge memory) { return _challenges[id]; }
    function counts() external view returns (uint256 ngos, uint256 lots, uint256 payouts) {
        return (_ngos.length, _lots.length, _payouts.length);
    }
}
