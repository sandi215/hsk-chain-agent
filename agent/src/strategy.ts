/**
 * Pure decision engine for the reference-peg mean-reversion strategy.
 *
 * Idea: the WHSK-mUSDC pool on HSK Chain testnet has thin, mostly
 * self-seeded liquidity, so its price drifts from the real HSK price.
 * The agent buys WHSK when the pool is cheap vs the CEX reference and
 * sells when it is expensive, always trading TOWARD the peg — never
 * chasing momentum, never trading its own prints.
 *
 * All money math is bigint. Prices are 6-decimal units (80000 = $0.08).
 * No network, no signing, no side effects: fully unit-testable.
 */

export interface StrategyParams {
  /** Trade only if |pool - ref| / ref exceeds this (bps). Default 150 = 1.5%. */
  deviationThresholdBps: number;
  /** Max trade value as share of vault NAV (bps). Default 200 = 2%. */
  maxTradeBps: number;
  /** Max slippage accepted on a trade (bps). Default 100 = 1%. */
  maxSlippageBps: number;
  /** Max share of pool reserves in one trade (bps). Default 100 = 1%. */
  maxPoolShareBps: number;
  /** Fraction of the price gap to close per trade (bps). Default 5000 = 50%. */
  gapCloseBps: number;
  /** Min ms between trades. Default 60_000. */
  cooldownMs: number;
  /** Dust guard: min buy size in mUSDC base units. Default 100_000 = 0.1 mUSDC. */
  minBuyAmount: number;
  /** Dust guard: min sell size in WHSK wei. Default 10^15 = 0.001 WHSK. */
  minSellAmount: number;
}

export interface MarketState {
  poolPrice6: bigint;
  refPrice6: bigint;
  reserveWhsk: bigint; // wei (18 dec)
  reserveMusdc: bigint; // base units (6 dec)
  vaultNav6: bigint; // mUSDC base units (6 dec)
  paused: boolean;
  lastTradeAtMs: number;
}

export type Decision =
  | { action: 'buy' | 'sell'; amountIn: bigint; reason: string; deviationBps: number }
  | { action: 'hold'; amountIn: 0n; reason: string; deviationBps: number };

export const DEFAULT_PARAMS: StrategyParams = {
  deviationThresholdBps: 150,
  maxTradeBps: 200,
  maxSlippageBps: 100,
  maxPoolShareBps: 100,
  gapCloseBps: 5000,
  cooldownMs: 60_000,
  minBuyAmount: 100_000,
  minSellAmount: 10 ** 15,
};

/** Signed deviation of pool price vs reference, in bps (positive = pool expensive). */
export function deviationBps(poolPrice6: bigint, refPrice6: bigint): number {
  if (refPrice6 <= 0n) return 0;
  return Number(((poolPrice6 - refPrice6) * 10_000n) / refPrice6);
}

/**
 * Constant-product approximation: to move the price by `moveBps` of itself,
 * the input (in units of the input-side reserve) is roughly
 * reserveIn * moveBps / (2 * 10000). (dP/P ~= 2 * dR/R for a CPAMM.)
 */
function gapAmount(reserveIn: bigint, moveBps: number): bigint {
  if (moveBps <= 0) return 0n;
  return (reserveIn * BigInt(Math.floor(moveBps))) / 20_000n;
}

export function decideTrade(
  m: MarketState,
  p: StrategyParams,
  nowMs: number,
): Decision {
  const dev = deviationBps(m.poolPrice6, m.refPrice6);
  if (m.paused) return { action: 'hold', amountIn: 0n, reason: 'vault paused', deviationBps: dev };
  if (m.poolPrice6 <= 0n || m.refPrice6 <= 0n || m.vaultNav6 <= 0n) {
    return { action: 'hold', amountIn: 0n, reason: 'missing market data', deviationBps: dev };
  }
  if (Math.abs(dev) < p.deviationThresholdBps) {
    return { action: 'hold', amountIn: 0n, reason: 'within band', deviationBps: dev };
  }
  if (nowMs - m.lastTradeAtMs < p.cooldownMs) {
    return { action: 'hold', amountIn: 0n, reason: 'cooldown', deviationBps: dev };
  }

  // Pool cheap (dev < 0) -> buy WHSK with mUSDC. Pool expensive -> sell WHSK.
  const buy = dev < 0;
  // How far toward the peg do we want to move the price this trade?
  // NOTE: must stay an integer — a fractional moveBps crashes BigInt() in gapAmount().
  const moveBps = Math.floor((Math.min(Math.abs(dev), 10_000) * p.gapCloseBps) / 10_000);

  let amountIn: bigint;
  if (buy) {
    const maxTrade = (m.vaultNav6 * BigInt(p.maxTradeBps)) / 10_000n; // mUSDC units
    const maxPoolShare = (m.reserveMusdc * BigInt(p.maxPoolShareBps)) / 10_000n;
    const gap = gapAmount(m.reserveMusdc, moveBps);
    amountIn = [maxTrade, maxPoolShare, gap].reduce((a, b) => (a < b ? a : b));
    if (amountIn < BigInt(p.minBuyAmount)) {
      // Dust guard: too small to be worth the gas or the noise.
      return { action: 'hold', amountIn: 0n, reason: 'trade too small', deviationBps: dev };
    }
    return { action: 'buy', amountIn, reason: `pool ${-dev}bps below ref`, deviationBps: dev };
  }
  // Sell: caps are in WHSK units. Convert the NAV cap via the pool price.
  const maxTradeMusdc = (m.vaultNav6 * BigInt(p.maxTradeBps)) / 10_000n;
  const maxTradeWhsk = (maxTradeMusdc * 1_000_000_000_000_000_000n) / m.poolPrice6;
  const maxPoolShare = (m.reserveWhsk * BigInt(p.maxPoolShareBps)) / 10_000n;
  const gap = gapAmount(m.reserveWhsk, moveBps);
  amountIn = [maxTradeWhsk, maxPoolShare, gap].reduce((a, b) => (a < b ? a : b));
  if (amountIn < BigInt(p.minSellAmount)) {
    // Dust guard: too small to be worth the gas or the noise.
    return { action: 'hold', amountIn: 0n, reason: 'trade too small', deviationBps: dev };
  }
  return { action: 'sell', amountIn, reason: `pool ${dev}bps above ref`, deviationBps: dev };
}
