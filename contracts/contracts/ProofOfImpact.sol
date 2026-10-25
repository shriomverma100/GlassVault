// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Soulbound token a donor receives when their money's impact is cryptographically verified.
///         Non-transferable: it proves "my rupees did this", so it can't be bought.
contract ProofOfImpact is ERC721 {
    struct Impact {
        uint256 payoutId;
        uint256 lotId;
        uint256 amount;
        uint64 verifiedAt;
    }

    address public immutable vault;
    uint256 public totalMinted;
    mapping(uint256 => Impact) public impacts;

    error OnlyVault();
    error Soulbound();

    constructor(address vault_) ERC721("GlassVault Proof of Impact", "IMPACT") {
        vault = vault_;
    }

    function mint(address donor, uint256 payoutId, uint256 lotId, uint256 amount) external returns (uint256 id) {
        if (msg.sender != vault) revert OnlyVault();
        id = totalMinted++;
        impacts[id] = Impact({payoutId: payoutId, lotId: lotId, amount: amount, verifiedAt: uint64(block.timestamp)});
        _mint(donor, id);
    }

    /// @dev Block every transfer except minting.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
