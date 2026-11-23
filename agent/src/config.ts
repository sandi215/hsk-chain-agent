import 'dotenv/config';

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  rpcUrl: env('RPC_URL', 'https://testnet.hsk.xyz'),
  agentPrivateKey: env('AGENT_PRIVATE_KEY') as `0x${string}`,
  vaultAddress: env('VAULT_ADDRESS') as `0x${string}`,
  routerAddress: env('ROUTER_ADDRESS') as `0x${string}`,
  pairAddress: env('PAIR_ADDRESS') as `0x${string}`,
  whskAddress: env('WHSK_ADDRESS') as `0x${string}`,
  musdcAddress: env('MUSDC_ADDRESS') as `0x${string}`,
  telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
  deviationThresholdBps: envInt('DEVIATION_THRESHOLD_BPS', 150),
  maxTradeBps: envInt('MAX_TRADE_BPS', 200),
  maxSlippageBps: envInt('MAX_SLIPPAGE_BPS', 100),
  maxPoolShareBps: envInt('MAX_POOL_SHARE_BPS', 100),
  gapCloseBps: envInt('GAP_CLOSE_BPS', 5000),
  cooldownMs: envInt('COOLDOWN_MS', 60_000),
  pollIntervalMs: envInt('POLL_INTERVAL_MS', 30_000),
  stateFile: env('STATE_FILE', './state.json'),
  // Dust guards (tiny-pool demo values go in .env; defaults = phase-1 values).
  minBuyAmount: envInt('MIN_BUY_AMOUNT', 100_000),
  minSellAmount: envInt('MIN_SELL_AMOUNT', 10 ** 15),
};
