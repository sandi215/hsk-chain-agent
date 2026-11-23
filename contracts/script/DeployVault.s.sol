// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/HskAgentVault.sol";

/// @notice Deploy HskAgentVault on HSK Chain testnet (chain 133).
/// @dev Env: PRIVATE_KEY, WHSK, MUSDC, ROUTER, PAIR, AGENT (agent EOA).
///      Run AFTER DeployVenue + SeedPool. AGENT is the off-chain bot key
///      (the agent testnet wallet in the MVP).
contract DeployVault is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address whsk = vm.envAddress("WHSK");
        address musdc = vm.envAddress("MUSDC");
        address router = vm.envAddress("ROUTER");
        address pair = vm.envAddress("PAIR");
        address agent = vm.envAddress("AGENT");

        vm.startBroadcast(pk);
        HskAgentVault vault = new HskAgentVault(whsk, musdc, router, pair, agent);
        vm.stopBroadcast();

        console.log("HskAgentVault:", address(vault));
        console.log("owner:        ", vm.addr(pk));
        console.log("agent:        ", agent);
    }
}
