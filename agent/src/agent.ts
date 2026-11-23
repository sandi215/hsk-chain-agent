import { promises as fs } from 'node:fs';
import { config } from './config.js';
import { getReferencePrice } from './price.js';
import { decideTrade, DEFAULT_PARAMS, type StrategyParams } from './strategy.js';
import {
  executeVaultTrade,
  quoteMinOut,
  readPool,
  readVault,
} from './chain.js';

export interface TradeRecord {
  at: string;
  action: 'buy' | 'sell';
  amountIn: string;
  txHash: string;
  poolPrice6: string;
  refPrice6: string;
  nav6: string;
}

export interface AgentState {
  updatedAt: string;
  poolPrice6: string;
  refPrice6: string;
  deviationBps: number;
  nav6: string;
  vaultWhsk: string;
  vaultMusdc: string;
  paused: boolean;
  tradeCount: string;
  lastDecision: string;
  lastTradeAtMs: number;
  params: StrategyParams;
  trades: TradeRecord[];
}

async function loadState(): Promise<AgentState | null> {
  try {
    return JSON.parse(await fs.readFile(config.stateFile, 'utf8')) as AgentState;
  } catch {
    return null;
  }
}

async function saveState(state: AgentState): Promise<void> {
  await fs.writeFile(config.stateFile, JSON.stringify(state, null, 2));
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export async function tick(): Promise<void> {
  const prev = await loadState();
  const params: StrategyParams = {
    deviationThresholdBps: prev?.params.deviationThresholdBps ?? config.deviationThresholdBps,
    maxTradeBps: prev?.params.maxTradeBps ?? config.maxTradeBps,
    maxSlippageBps: prev?.params.maxSlippageBps ?? config.maxSlippageBps,
    maxPoolShareBps: prev?.params.maxPoolShareBps ?? config.maxPoolShareBps,
    gapCloseBps: prev?.params.gapCloseBps ?? config.gapCloseBps,
    cooldownMs: prev?.params.cooldownMs ?? config.cooldownMs,
    minBuyAmount: prev?.params.minBuyAmount ?? config.minBuyAmount,
    minSellAmount: prev?.params.minSellAmount ?? config.minSellAmount,
  };
  const lastTradeAtMs = prev?.lastTradeAtMs ?? 0;

  const [pool, vault, ref] = await Promise.all([readPool(), readVault(), getReferencePrice()]);
  const decision = decideTrade(
    {
      poolPrice6: pool.poolPrice6,
      refPrice6: ref.price6,
      reserveWhsk: pool.reserveWhsk,
      reserveMusdc: pool.reserveMusdc,
      vaultNav6: vault.nav6,
      paused: vault.paused,
      lastTradeAtMs,
    },
    params,
    Date.now(),
  );

  let trades: TradeRecord[] = prev?.trades ?? [];
  let newLastTradeAtMs = lastTradeAtMs;
  if (decision.action === 'buy' || decision.action === 'sell') {
    const buy = decision.action === 'buy';
    const minOut = await quoteMinOut(buy, decision.amountIn, params.maxSlippageBps);
    const txHash = await executeVaultTrade(buy, decision.amountIn, minOut);
    log(
      `TRADE ${decision.action} amountIn=${decision.amountIn} minOut=${minOut} tx=${txHash} (${decision.reason})`,
    );
    trades = [
      ...trades,
      {
        at: new Date().toISOString(),
        action: decision.action,
        amountIn: decision.amountIn.toString(),
        txHash,
        poolPrice6: pool.poolPrice6.toString(),
        refPrice6: ref.price6.toString(),
        nav6: vault.nav6.toString(),
      },
    ].slice(-50);
    newLastTradeAtMs = Date.now();
  } else {
    log(`hold: ${decision.reason} (dev ${decision.deviationBps}bps)`);
  }

  const state: AgentState = {
    updatedAt: new Date().toISOString(),
    poolPrice6: pool.poolPrice6.toString(),
    refPrice6: ref.price6.toString(),
    deviationBps: decision.deviationBps,
    nav6: vault.nav6.toString(),
    vaultWhsk: vault.whskBalance.toString(),
    vaultMusdc: vault.musdcBalance.toString(),
    paused: vault.paused,
    tradeCount: vault.tradeCount.toString(),
    lastDecision: decision.action === 'hold' ? `hold: ${decision.reason}` : `${decision.action} ${decision.amountIn}`,
    lastTradeAtMs: newLastTradeAtMs,
    params,
    trades,
  };
  await saveState(state);
}

export async function runLoop(): Promise<never> {
  log('agent loop starting');
  for (;;) {
    try {
      await tick();
    } catch (err) {
      log(`tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

// Keep DEFAULT_PARAMS referenced so the import stays meaningful if config is unset.
export const _defaultParams = DEFAULT_PARAMS;
