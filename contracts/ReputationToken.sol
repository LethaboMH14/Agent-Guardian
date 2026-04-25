// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ReputationToken
 * @notice ERC-20 token representing Reputation-as-Collateral
 * @dev Mints tokens proportional to Agent reputation score
 */
contract ReputationToken is ERC20, Ownable {
    constructor() ERC20("Reputation-as-Collateral", "rAGNT") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
