// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Minimal 0.8.19 interfaces for the Uniswap-V2-compatible venue.
///         The canonical V2 contracts are Solidity 0.5.16/0.6.6 and cannot be
///         imported into 0.8.19 files (foundry single-version import graphs),
///         so we deploy them from their published npm build artifacts
///         (Uniswap v2-core, v2-periphery) via forge-std deployCode
///         and talk to them through these interfaces. Same bytecode, same ABI
///         as the audited V2 deployment — only the calling layer is 0.8.19.

interface IV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IV2Router02 {
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function approve(address guy, uint256 wad) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address dst, uint256 wad) external returns (bool);
}

interface IV2Pair {
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
}
