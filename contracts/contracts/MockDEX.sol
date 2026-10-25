// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-rate ETH → dINR exchange: the "swap" hop of a multi-hop donation
///         (e.g. "50 ETH earmarked for water is swapped, bridged, then spent").
/// @dev Local stand-in for a real DEX pool (Uniswap on a testnet in production). The swap is a real
///      on-chain event, so the tracer reconstructs it exactly like it would a pool swap.
contract MockDEX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable dinr;
    uint256 public immutable rate; // dINR wei per 1 ETH

    event Swapped(address indexed sender, address indexed to, uint256 ethIn, uint256 dinrOut);

    error ZeroAmount();
    error Slippage();

    constructor(IERC20 dinr_, uint256 rate_) {
        dinr = dinr_;
        rate = rate_;
    }

    function quote(uint256 ethIn) public view returns (uint256) {
        return (ethIn * rate) / 1 ether;
    }

    function swapExactETHForDINR(uint256 minOut, address to) external payable nonReentrant returns (uint256 out) {
        if (msg.value == 0) revert ZeroAmount();
        out = quote(msg.value);
        if (out < minOut) revert Slippage();
        emit Swapped(msg.sender, to, msg.value, out);
        dinr.safeTransfer(to, out);
    }
}
