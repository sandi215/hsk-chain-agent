// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/interfaces/IVenue.sol";
import "../src/MockUSDC.sol";
import "../src/HskAgentVault.sol";

/// @notice Full local test of the venue + vault on a fork-free in-memory chain.
///         Mirrors exactly what DeployVenue / SeedPool / DeployVault do on testnet.
///         The canonical V2 contracts are deployed from their published npm build
///         artifacts via deployCode (see src/interfaces/IVenue.sol for why).
contract HskAgentVaultTest is Test {
    IWETH internal whsk;
    MockUSDC internal musdc;
    IV2Factory internal factory;
    IV2Router02 internal router;
    IV2Pair internal pair;
    HskAgentVault internal vault;

    address internal attacker = address(0xBEEF);

    uint256 internal constant POOL_WHSK = 10_000 ether;
    uint256 internal constant POOL_MUSDC = 800_000_000; // 800 mUSDC, 6 dec -> price $0.08

    function setUp() public {
        address whskAddr = deployCode("artifacts/WETH9.json");
        address factoryAddr = deployCode(
            "artifacts/UniswapV2Factory.json", abi.encode(address(this))
        );
        address routerAddr = deployCode(
            "artifacts/UniswapV2Router02.json",
            abi.encode(factoryAddr, whskAddr)
        );
        whsk = IWETH(whskAddr);
        factory = IV2Factory(factoryAddr);
        router = IV2Router02(routerAddr);
        musdc = new MockUSDC();

        // Seed the pool: 10,000 WHSK + 800 mUSDC.
        whsk.deposit{value: POOL_WHSK}();
        musdc.mint(address(this), POOL_MUSDC);
        whsk.approve(address(router), POOL_WHSK);
        musdc.approve(address(router), POOL_MUSDC);
        router.addLiquidity(
            address(whsk), address(musdc), POOL_WHSK, POOL_MUSDC, 0, 0, address(this), block.timestamp + 600
        );
        pair = IV2Pair(factory.getPair(address(whsk), address(musdc)));

        vault = new HskAgentVault(address(whsk), address(musdc), address(router), address(pair), address(this));

        // Fund the vault: 1,000 WHSK + 80 mUSDC (NAV ~160 mUSDC at $0.08).
        whsk.deposit{value: 1_000 ether}();
        musdc.mint(address(this), 80_000_000);
        whsk.approve(address(vault), 1_000 ether);
        musdc.approve(address(vault), 80_000_000);
        vault.deposit(address(whsk), 1_000 ether);
        vault.deposit(address(musdc), 80_000_000);
        vault.resetSessionNav(); // baseline AFTER both deposits (NAV ~160 mUSDC)
    }

    receive() external payable {}

    function testPoolPriceIsPegged() public view {
        uint256 price = vault.poolPrice();
        // 800e6 * 1e18 / 10000e18 = 80000 ($0.08 in 6-dec units)
        assertApproxEqRel(price, 80_000, 0.001 ether);
    }

    function testNavAfterDeposit() public view {
        // 80 mUSDC + 1000 WHSK * $0.08 = 160 mUSDC
        assertApproxEqRel(vault.nav(), 160_000_000, 0.001 ether);
    }

    function testBuyWhskExecutes() public {
        uint256 musdcBefore = musdc.balanceOf(address(vault));
        uint256 whskBefore = whsk.balanceOf(address(vault));
        uint256 amountIn = 10_000_000; // 10 mUSDC — over the 2% cap, so use 3 mUSDC
        amountIn = 3_000_000;
        uint256[] memory quoted = router.getAmountsOut(amountIn, _path(false));
        uint256 minOut = (quoted[1] * 9_900) / 10_000; // 1% slippage
        vault.executeTrade(true, amountIn, minOut);
        assertEq(musdc.balanceOf(address(vault)), musdcBefore - amountIn);
        assertGt(whsk.balanceOf(address(vault)), whskBefore);
        assertEq(vault.tradeCount(), 1);
    }

    function testSellWhskExecutes() public {
        uint256 whskBefore = whsk.balanceOf(address(vault));
        uint256 amountIn = 3 ether; // ~$0.24, within the 2% cap (3.2 mUSDC)
        uint256[] memory quoted = router.getAmountsOut(amountIn, _path(true));
        uint256 minOut = (quoted[1] * 9_900) / 10_000;
        vault.executeTrade(false, amountIn, minOut);
        assertEq(whsk.balanceOf(address(vault)), whskBefore - amountIn);
        assertEq(vault.tradeCount(), 1);
    }

    function testTradeTooBigReverts() public {
        // maxTradeBps = 200 -> 2% of ~160 mUSDC NAV = 3.2 mUSDC; 10 mUSDC buy is over the cap.
        vm.expectRevert("trade too big");
        vault.executeTrade(true, 10_000_000, 0);
    }

    function testOnlyAgentCanTrade() public {
        vm.prank(attacker);
        vm.expectRevert("not agent");
        vault.executeTrade(true, 1_000_000, 0);
    }

    function testSlippageGuardReverts() public {
        uint256 amountIn = 1_000_000; // 1 mUSDC, within the 2% cap
        uint256[] memory quoted = router.getAmountsOut(amountIn, _path(false));
        vm.expectRevert("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        vault.executeTrade(true, amountIn, quoted[1] + 1);
    }

    function testPauseBlocksTrades() public {
        vault.pause();
        vm.expectRevert("paused");
        vault.executeTrade(true, 1_000_000, 0);
        vault.unpause();
        vault.executeTrade(true, 1_000_000, 0); // works again
        assertEq(vault.tradeCount(), 1);
    }

    function testSetRiskParamsBounds() public {
        vm.expectRevert("maxTrade too high");
        vault.setRiskParams(1001, 100, 500, 1000);
        vault.setRiskParams(100, 50, 300, 500);
        assertEq(vault.maxTradeBps(), 100);
        assertEq(vault.dailyLossCapBps(), 300);
    }

    function testStopLossPausesAfterCrash() public {
        // Attacker dumps 9,000 WHSK into the pool -> price craters ~-72%.
        deal(attacker, 9_000 ether);
        vm.startPrank(attacker);
        IWETH(address(whsk)).deposit{value: 9_000 ether}();
        whsk.approve(address(router), 9_000 ether);
        address[] memory path = new address[](2);
        path[0] = address(whsk);
        path[1] = address(musdc);
        router.swapExactTokensForTokens(9_000 ether, 0, path, attacker, block.timestamp + 600);
        vm.stopPrank();

        // Any next vault trade sees NAV far below session start -> auto-pause.
        vault.executeTrade(true, 1_000_000, 0);
        assertTrue(vault.paused());
    }

    function testMeanReversionBuyGetsCheapWhsk() public {
        // Crash the pool price first (same dump as above).
        deal(attacker, 9_000 ether);
        vm.startPrank(attacker);
        IWETH(address(whsk)).deposit{value: 9_000 ether}();
        whsk.approve(address(router), 9_000 ether);
        address[] memory path = new address[](2);
        path[0] = address(whsk);
        path[1] = address(musdc);
        router.swapExactTokensForTokens(9_000 ether, 0, path, attacker, block.timestamp + 600);
        vm.stopPrank();

        // Pool price is now ~$0.022 vs $0.08 reference: the agent buys the dip.
        uint256 priceNow = vault.poolPrice();
        assertLt(priceNow, 30_000); // crashed below $0.03
        uint256 amountIn = 1_000_000; // 1 mUSDC
        uint256[] memory quoted = router.getAmountsOut(amountIn, _path(false));
        uint256 minOut = (quoted[1] * 9_900) / 10_000;
        uint256 whskBefore = whsk.balanceOf(address(vault));
        vault.executeTrade(true, amountIn, minOut);
        // At the crashed price, 1 mUSDC buys far more WHSK than at the $0.08 peg (~12.5).
        assertGt(whsk.balanceOf(address(vault)) - whskBefore, 30 ether);
    }

    function _path(bool sellWhsk) internal view returns (address[] memory p) {
        p = new address[](2);
        p[0] = sellWhsk ? address(whsk) : address(musdc);
        p[1] = sellWhsk ? address(musdc) : address(whsk);
    }
}
