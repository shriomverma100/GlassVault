// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDex {
    function swapExactETHForDINR(uint256 minOut, address to) external payable returns (uint256);
}

interface IGlassVault {
    function donateFor(address donor, uint256 ngoId, uint8 category, uint256 amount, uint64 deadline, uint64 sourceChain)
        external
        returns (uint256);
}

/// @notice Lock-and-release bridge for tagged donations between two chains.
///         Source chain: `sendDonation` locks tokens and emits the donation tag.
///         Destination chain: the relayer calls `deliverDonation`, which funds a vault lot that keeps
///         the original donor + source chain. Each (sourceChain, nonce) can be delivered once.
/// @dev Demo relayer is a single bonded key; production would use a light client or CCIP.
contract BridgeGateway is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable relayer;
    IGlassVault public vault; // set on the destination chain only
    uint256 public nonce;
    mapping(bytes32 => bool) public delivered;
    /// @notice Source side: what each nonce locked, so an undeliverable donation can be refunded.
    struct Sent {
        address donor;
        uint256 amount;
        bool refunded;
    }
    mapping(uint256 => Sent) public sent;
    /// @notice Destination lots need a proof period; leave margin for the relay.
    uint64 public constant MIN_SOURCE_PERIOD = 2 hours;

    event DonationSent(uint256 indexed nonce, address indexed donor, uint256 ngoId, uint8 category, uint256 amount, uint64 deadline, uint64 destChain);
    event DonationDelivered(uint64 indexed sourceChain, uint256 indexed nonce, uint256 lotId);
    event DonationRefunded(uint256 indexed nonce, address indexed donor, uint256 amount);
    /// @notice The swap hop of a multi-hop donation: links the original asset to the bridged tag.
    event DonationSwapped(uint256 indexed nonce, address indexed donor, address dex, uint256 ethIn, uint256 dinrOut);

    error OnlyRelayer();
    error AlreadyDelivered();
    error VaultAlreadySet();
    error Slippage();
    error BadDonation();
    error NotRefundable();

    constructor(IERC20 token_, address relayer_) {
        token = token_;
        relayer = relayer_;
    }

    function setVault(IGlassVault vault_) external {
        if (msg.sender != relayer) revert OnlyRelayer();
        if (address(vault) != address(0)) revert VaultAlreadySet();
        vault = vault_;
        token.forceApprove(address(vault_), type(uint256).max);
    }

    function sendDonation(uint256 ngoId, uint8 category, uint256 amount, uint64 deadline, uint64 destChain) external nonReentrant {
        if (amount == 0 || deadline < block.timestamp + MIN_SOURCE_PERIOD) revert BadDonation();
        uint256 n = nonce++;
        sent[n] = Sent({donor: msg.sender, amount: amount, refunded: false});
        emit DonationSent(n, msg.sender, ngoId, category, amount, deadline, destChain);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Donate in ETH: swap to dINR at `dex`, then lock and tag it like `sendDonation`.
    /// @dev The amount locked is what this gateway actually received (balance delta), so a dishonest
    ///      dex can't inflate the tagged amount.
    function sendDonationWithSwap(address dex, uint256 ngoId, uint8 category, uint64 deadline, uint64 destChain, uint256 minOut)
        external
        payable
        nonReentrant
    {
        uint256 before = token.balanceOf(address(this));
        IDex(dex).swapExactETHForDINR{value: msg.value}(minOut, address(this));
        uint256 amount = token.balanceOf(address(this)) - before;
        if (amount < minOut || amount == 0) revert Slippage();
        if (deadline < block.timestamp + MIN_SOURCE_PERIOD) revert BadDonation();
        uint256 n = nonce++;
        sent[n] = Sent({donor: msg.sender, amount: amount, refunded: false});
        emit DonationSwapped(n, msg.sender, dex, msg.value, amount);
        emit DonationSent(n, msg.sender, ngoId, category, amount, deadline, destChain);
    }

    /// @notice Source side: the relayer reports that the destination rejected nonce `n` (NGO frozen,
    ///         deadline too close) and the locked dINR goes back to the donor. Once only.
    function refundFailed(uint256 n) external nonReentrant {
        if (msg.sender != relayer) revert OnlyRelayer();
        Sent storage s = sent[n];
        if (s.donor == address(0) || s.refunded) revert NotRefundable();
        s.refunded = true;
        emit DonationRefunded(n, s.donor, s.amount);
        token.safeTransfer(s.donor, s.amount);
    }

    function deliverDonation(
        uint64 sourceChain,
        uint256 srcNonce,
        address donor,
        uint256 ngoId,
        uint8 category,
        uint256 amount,
        uint64 deadline
    ) external nonReentrant returns (uint256 lotId) {
        if (msg.sender != relayer) revert OnlyRelayer();
        bytes32 key = keccak256(abi.encode(sourceChain, srcNonce));
        if (delivered[key]) revert AlreadyDelivered();
        delivered[key] = true;
        lotId = vault.donateFor(donor, ngoId, category, amount, deadline, sourceChain);
        emit DonationDelivered(sourceChain, srcNonce, lotId);
    }
}
