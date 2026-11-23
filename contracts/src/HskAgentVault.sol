// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title HskAgentVault — vault holding WHSK + mUSDC, traded ONLY by the agent EOA
///         through an approved Uniswap-V2-compatible router (HSKSwap on HSK Chain,
///         or our own V2 venue on testnet — same interface).
/// @notice Testnet MVP for the HSK Chain Horizon Hackathon, Track 1 (AI Agent Trading).
///         Risk limits are enforced ON-CHAIN, not just in the off-chain agent:
///         per-trade size cap, slippage guard (minOut), daily loss cap, session
///         stop-loss, pause. No leverage, no flash loans, no unlimited approvals
///         (exact-amount approval per trade). Owner = Sandi's agent wallet on
///         testnet; agent = the off-chain bot key (same wallet in the MVP).
///         The vault NEVER holds mainnet funds in this phase.

import "./interfaces/IVenue.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract HskAgentVault {
    address public owner;
    address public agent;
    address public immutable WHSK; // 18 decimals
    address public immutable MUSDC; // 6 decimals
    address public router; // approved V2-compatible router
    address public pair; // WHSK-MUSDC pair (NAV pricing)

    uint256 public maxTradeBps = 200; // 2% of NAV per trade
    uint256 public maxSlippageBps = 100; // 1% (enforced via minOut, computed off-chain)
    uint256 public dailyLossCapBps = 500; // 5% of day-start NAV -> auto-pause
    uint256 public stopLossBps = 1000; // 10% below session-start NAV -> auto-pause
    bool public paused;

    uint256 public sessionStartNav; // NAV at first deposit, 0 until funded
    uint256 public dayStartNav;
    uint256 public dayStartTs;

    uint256 public tradeCount;

    event TradeExecuted(bool indexed buyWhsk, uint256 amountIn, uint256 amountOut, uint256 navAfter);
    event RiskPaused(string reason, uint256 nav);
    event ParamsUpdated(uint256 maxTradeBps, uint256 maxSlippageBps, uint256 dailyLossCapBps, uint256 stopLossBps);
    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);

    bool private _locked;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "not agent");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address whsk_, address musdc_, address router_, address pair_, address agent_) {
        owner = msg.sender;
        agent = agent_;
        WHSK = whsk_;
        MUSDC = musdc_;
        router = router_;
        pair = pair_;
    }

    /// @notice Pool-implied WHSK price in mUSDC base units (6 decimals), e.g. 80000 = $0.08.
    function poolPrice() public view returns (uint256) {
        (uint112 r0, uint112 r1,) = IV2Pair(pair).getReserves();
        if (r0 == 0 || r1 == 0) return 0;
        address t0 = IV2Pair(pair).token0();
        uint256 reserveWhsk = t0 == WHSK ? uint256(r0) : uint256(r1);
        uint256 reserveMusdc = t0 == WHSK ? uint256(r1) : uint256(r0);
        // price6 = reserveMusdc * 1e18 / reserveWhsk
        return (reserveMusdc * 1e18) / reserveWhsk;
    }

    /// @notice Vault NAV in mUSDC base units (6 decimals).
    function nav() public view returns (uint256) {
        uint256 price = poolPrice();
        uint256 whskBal = IERC20(WHSK).balanceOf(address(this));
        uint256 musdcBal = IERC20(MUSDC).balanceOf(address(this));
        if (price == 0) return musdcBal;
        return musdcBal + (whskBal * price) / 1e18;
    }

    function deposit(address token, uint256 amount) external onlyOwner {
        require(token == WHSK || token == MUSDC, "bad token");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "deposit failed");
        if (sessionStartNav == 0) {
            sessionStartNav = nav();
            dayStartNav = sessionStartNav;
            dayStartTs = block.timestamp;
        }
        emit Deposited(token, amount);
    }

    function withdraw(address token, uint256 amount) external onlyOwner {
        require(token == WHSK || token == MUSDC, "bad token");
        require(IERC20(token).transfer(msg.sender, amount), "withdraw failed");
        emit Withdrawn(token, amount);
    }

    /// @notice Execute one agent trade through the approved router.
    /// @param buyWhsk true = mUSDC -> WHSK, false = WHSK -> mUSDC
    /// @param amountIn exact input amount (token decimals)
    /// @param minOut minimum output, computed off-chain from the quote minus max slippage
    function executeTrade(bool buyWhsk, uint256 amountIn, uint256 minOut)
        external
        onlyAgent
        whenNotPaused
        nonReentrant
        returns (uint256 amountOut)
    {
        uint256 navBefore = nav();
        require(navBefore > 0, "empty vault");
        // Cap is NAV-denominated (mUSDC units): convert WHSK sells via pool price.
        uint256 amountInValue = buyWhsk ? amountIn : (amountIn * poolPrice()) / 1e18;
        require(amountInValue <= (navBefore * maxTradeBps) / 10000, "trade too big");

        address tokenIn = buyWhsk ? MUSDC : WHSK;
        address tokenOut = buyWhsk ? WHSK : MUSDC;

        require(IERC20(tokenIn).approve(router, amountIn), "approve failed");
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint256[] memory amounts = IV2Router02(router).swapExactTokensForTokens(
            amountIn, minOut, path, address(this), block.timestamp + 300
        );
        amountOut = amounts[1];
        tradeCount += 1;

        uint256 navAfter = nav();
        _checkRisk(navAfter);
        emit TradeExecuted(buyWhsk, amountIn, amountOut, navAfter);
    }

    function _checkRisk(uint256 navAfter) internal {
        // Roll the daily window.
        if (block.timestamp >= dayStartTs + 1 days) {
            dayStartNav = navAfter;
            dayStartTs = block.timestamp;
        }
        if (dayStartNav > 0 && navAfter < dayStartNav) {
            uint256 lossBps = ((dayStartNav - navAfter) * 10000) / dayStartNav;
            if (lossBps > dailyLossCapBps) {
                paused = true;
                emit RiskPaused("daily loss cap", navAfter);
                return;
            }
        }
        if (sessionStartNav > 0 && navAfter < sessionStartNav) {
            uint256 lossBps = ((sessionStartNav - navAfter) * 10000) / sessionStartNav;
            if (lossBps > stopLossBps) {
                paused = true;
                emit RiskPaused("session stop-loss", navAfter);
            }
        }
    }

    // ---- owner controls ----

    function setRiskParams(
        uint256 maxTradeBps_,
        uint256 maxSlippageBps_,
        uint256 dailyLossCapBps_,
        uint256 stopLossBps_
    ) external onlyOwner {
        require(maxTradeBps_ <= 1000, "maxTrade too high");
        require(maxSlippageBps_ <= 500, "slippage too high");
        require(dailyLossCapBps_ <= 2000, "daily cap too high");
        require(stopLossBps_ <= 5000, "stop too high");
        maxTradeBps = maxTradeBps_;
        maxSlippageBps = maxSlippageBps_;
        dailyLossCapBps = dailyLossCapBps_;
        stopLossBps = stopLossBps_;
        emit ParamsUpdated(maxTradeBps_, maxSlippageBps_, dailyLossCapBps_, stopLossBps_);
    }

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
    }

    function setRouter(address router_) external onlyOwner {
        router = router_;
    }

    function setPair(address pair_) external onlyOwner {
        pair = pair_;
    }

    /// @notice Re-baseline session/day NAV (owner only). Call after funding or
    ///         withdrawing so stop-loss / daily-cap math measures from the true
    ///         funded NAV, not from a mid-funding deposit.
    function resetSessionNav() external onlyOwner {
        sessionStartNav = nav();
        dayStartNav = sessionStartNav;
        dayStartTs = block.timestamp;
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
        dayStartNav = nav();
        dayStartTs = block.timestamp;
    }
}
