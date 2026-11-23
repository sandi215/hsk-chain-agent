import { describe, expect, it } from 'vitest';
import {
  decideTrade,
  deviationBps,
  DEFAULT_PARAMS,
  type MarketState,
} from '../src/strategy.js';

function base(over: Partial<MarketState> = {}): MarketState {
  return {
    poolPrice6: 80_000n, // $0.08
    refPrice6: 80_000n,
    reserveWhsk: 10_000n * 10n ** 18n,
    reserveMusdc: 800_000_000n, // 800 mUSDC
    vaultNav6: 160_000_000n, // 160 mUSDC
    paused: false,
    lastTradeAtMs: 0,
    ...over,
  };
}

describe('deviationBps', () => {
  it('is 0 at peg', () => {
    expect(deviationBps(80_000n, 80_000n)).toBe(0);
  });
  it('is negative when the pool is cheap', () => {
    expect(deviationBps(78_400n, 80_000n)).toBe(-200); // -2%
  });
  it('is positive when the pool is expensive', () => {
    expect(deviationBps(84_000n, 80_000n)).toBe(500); // +5%
  });
});

describe('decideTrade', () => {
  it('holds within the band', () => {
    const d = decideTrade(base({ poolPrice6: 80_800n }), DEFAULT_PARAMS, 1_000_000);
    expect(d.action).toBe('hold');
    expect(d.reason).toBe('within band');
  });

  it('buys when the pool is cheap beyond threshold', () => {
    const d = decideTrade(base({ poolPrice6: 76_000n }), DEFAULT_PARAMS, 1_000_000);
    expect(d.action).toBe('buy');
    expect(d.amountIn > 0n).toBe(true);
    expect(d.deviationBps).toBe(-500);
  });

  it('sells when the pool is expensive beyond threshold', () => {
    const d = decideTrade(base({ poolPrice6: 84_000n }), DEFAULT_PARAMS, 1_000_000);
    expect(d.action).toBe('sell');
    expect(d.amountIn > 0n).toBe(true);
    expect(d.deviationBps).toBe(500);
  });

  it('caps the buy at maxTradeBps of NAV', () => {
    // 2% of 160 mUSDC = 3.2 mUSDC. A huge deviation would otherwise ask for more.
    const d = decideTrade(base({ poolPrice6: 40_000n }), DEFAULT_PARAMS, 1_000_000);
    expect(d.action).toBe('buy');
    if (d.action === 'buy') expect(d.amountIn <= 3_200_000n).toBe(true);
  });

  it('caps the trade at maxPoolShareBps of reserves', () => {
    // Pool with 100 mUSDC reserves: 1% = 1 mUSDC. NAV cap is 2% of 1,000 mUSDC
    // = 20 mUSDC, so the pool-share cap binds.
    const d = decideTrade(
      base({ poolPrice6: 40_000n, vaultNav6: 1_000_000_000n, reserveMusdc: 100_000_000n }),
      DEFAULT_PARAMS,
      1_000_000,
    );
    expect(d.action).toBe('buy');
    if (d.action === 'buy') expect(d.amountIn <= 1_000_000n).toBe(true); // 1% of 100,000,000
  });

  it('holds during cooldown', () => {
    const d = decideTrade(
      base({ poolPrice6: 76_000n, lastTradeAtMs: 999_000 }),
      DEFAULT_PARAMS,
      1_000_000,
    );
    expect(d.action).toBe('hold');
    expect(d.reason).toBe('cooldown');
  });

  it('holds when paused', () => {
    const d = decideTrade(base({ poolPrice6: 76_000n, paused: true }), DEFAULT_PARAMS, 1_000_000);
    expect(d.action).toBe('hold');
    expect(d.reason).toBe('vault paused');
  });

  it('holds on dust-sized trades', () => {
    const d = decideTrade(
      base({ poolPrice6: 79_900n, refPrice6: 80_000n }), // -12.5bps, below threshold anyway
      DEFAULT_PARAMS,
      1_000_000,
    );
    expect(d.action).toBe('hold');
  });
});

describe('decideTrade odd-deviation regression', () => {
  it('does not crash when moveBps would be fractional (dev 1543bps)', () => {
    // ref 80359, pool 92763 -> dev = 1543bps (odd). moveBps = 1543*5000/10000 = 771.5.
    // BigInt(771.5) used to throw and kill the tick; it must now floor to 771.
    const d = decideTrade(
      base({ poolPrice6: 92_763n, refPrice6: 80_359n }),
      DEFAULT_PARAMS,
      1_000_000,
    );
    expect(d.action).toBe('sell');
    expect(d.deviationBps).toBe(1543);
  });
});
