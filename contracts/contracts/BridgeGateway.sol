// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

    event DonationSent(uint256 indexed nonce, address indexed donor, uint256 ngoId, uint8 category, uint256 amount, uint64 deadline, uint64 destChain);
    event DonationDelivered(uint64 indexed sourceChain, uint256 indexed nonce, uint256 lotId);

    error OnlyRelayer();
    error AlreadyDelivered();
    error VaultAlreadySet();

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
        uint256 n = nonce++;
        emit DonationSent(n, msg.sender, ngoId, category, amount, deadline, destChain);
        token.safeTransferFrom(msg.sender, address(this), amount);
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
