// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/interfaces/IVenue.sol";
import "../src/MockUSDC.sol";

/// @notice Deploy the Uniswap-V2-compatible venue on HSK Chain testnet (chain 133).
/// @dev Run: PRIVATE_KEY=... forge script script/DeployVenue.s.sol --rpc-url https://testnet.hsk.xyz --broadcast
///      HSKSwap's own router/factory addresses are NOT published anywhere we could
///      find (app is geo-blocked, no docs/GitHub), so we deploy the canonical V2
///      contracts ourselves from their published npm build artifacts.
///      The agent is router-agnostic: point the VAULT at the HSKSwap router later
///      if its address becomes known.
contract DeployVenue is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // NOTE: deployCode must run INSIDE the broadcast block — calls made
        // before startBroadcast only execute in the local simulation and are
        // never broadcast, so the contracts would not exist on-chain.
        vm.startBroadcast(pk);

        address whskAddr = deployCode("artifacts/WETH9.json");
        address factoryAddr = deployCode(
            "artifacts/UniswapV2Factory.json", abi.encode(deployer)
        );
        address routerAddr = deployCode(
            "artifacts/UniswapV2Router02.json",
            abi.encode(factoryAddr, whskAddr)
        );

        MockUSDC musdc = new MockUSDC();
        vm.stopBroadcast();

        console.log("WHSK (WETH9):", whskAddr);
        console.log("V2 Factory:  ", factoryAddr);
        console.log("V2 Router02:", routerAddr);
        console.log("mUSDC:       ", address(musdc));
        console.log("deployer:    ", deployer);
    }
}
