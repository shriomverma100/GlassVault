// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Demo rupee stablecoin. 1 dINR = 1 ₹. Owner mints for local demos only.
contract DINR is ERC20, Ownable {
    constructor() ERC20("Digital INR", "dINR") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
