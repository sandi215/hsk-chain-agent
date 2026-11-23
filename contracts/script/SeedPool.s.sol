// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/interfaces/IVenue.sol";
import "../src/MockUSDC.sol";

/// @notice Seed the WHSK-mUSDC pool: wrap tHSK -> WHSK, mint mUSDC, add liquidity.
/// @dev Env: PRIVATE_KEY, ROUTER, WHSK, MUSDC, TSHK_AMOUNT (wei), MUSDC_AMOUNT (6-dec base units).
///      Example: TSHK_AMOUNT=70000000000000000 (0.07 tHSK) MUSDC_AMOUNT=5600 (0.0056 mUSDC)
///      -> pool price ~$0.08/WHSK. Run AFTER the faucet claim (needs tHSK balance).
///      NOTE: the work is split into _seed() because a single run() with all
///      locals trips solc's "stack too deep" on the addLiquidity call.
contract SeedPool is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address routerAddr = vm.envAddress("ROUTER");
        address whskAddr = vm.envAddress("WHSK");
        address musdcAddr = vm.envAddress("MUSDC");
        uint256 tshkAmount = vm.envUint("TSHK_AMOUNT");
        uint256 musdcAmount = vm.envUint("MUSDC_AMOUNT");

        vm.startBroadcast(pk);
        _seed(routerAddr, whskAddr, musdcAddr, tshkAmount, musdcAmount, me);
        vm.stopBroadcast();
        console.log("seeded WHSK:", tshkAmount);
        console.log("seeded mUSDC:", musdcAmount);
    }

    function _seed(
        address routerAddr,
        address whskAddr,
        address musdcAddr,
        uint256 tshkAmount,
        uint256 musdcAmount,
        address me
    ) internal {
        IWETH(whskAddr).deposit{value: tshkAmount}();
        MockUSDC(musdcAddr).mint(me, musdcAmount);
        IWETH(whskAddr).approve(routerAddr, tshkAmount);
        MockUSDC(musdcAddr).approve(routerAddr, musdcAmount);
        IV2Router02(routerAddr).addLiquidity(
            whskAddr,
            musdcAddr,
            tshkAmount,
            musdcAmount,
            0,
            0,
            me,
            block.timestamp + 600
        );
    }
}
