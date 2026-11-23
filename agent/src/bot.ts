import { promises as fs } from 'node:fs';
import { Bot } from 'grammy';
import { config } from './config.js';
import { readVault } from './chain.js';
import { setVaultPaused } from './chain.js';
import type { AgentState } from './agent.js';

async function loadState(): Promise<AgentState | null> {
  try {
    return JSON.parse(await fs.readFile(config.stateFile, 'utf8')) as AgentState;
  } catch {
    return null;
  }
}

function fmtUsdc6(v: string): string {
  const n = BigInt(v);
  return `${(n / 1_000_000n).toString()}.${(n % 1_000_000n).toString().padStart(6, '0')}`;
}

function fmtWhsk(wei: string): string {
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const frac = ((n % 10n ** 18n) / 10n ** 14n).toString().padStart(4, '0');
  return `${whole}.${frac}`;
}

function fmtPrice6(v: string): string {
  return `$${(Number(v) / 1e6).toFixed(4)}`;
}

export function createBot(): Bot | null {
  if (!config.telegramBotToken) {
    console.log('TELEGRAM_BOT_TOKEN not set — bot disabled (agent loop still runs).');
    return null;
  }
  const bot = new Bot(config.telegramBotToken);

  bot.command('start', (ctx) =>
    ctx.reply(
      'HSK Agent Trading bot\n' +
        '/status — NAV, positions, prices, deviation\n' +
        '/pnl — NAV vs session start (from vault)\n' +
        '/trades — last 5 trades\n' +
        '/set <param> <value> — deviationThresholdBps, maxTradeBps, maxSlippageBps, maxPoolShareBps, gapCloseBps, cooldownMs\n' +
        '/pause — halt trading (vault)\n' +
        '/resume — resume trading',
    ),
  );

  bot.command('status', async (ctx) => {
    const [state, vault] = await Promise.all([loadState(), readVault().catch(() => null)]);
    if (!state) return ctx.reply('No state yet — agent has not ticked.');
    await ctx.reply(
      `NAV: ${fmtUsdc6(state.nav6)} mUSDC\n` +
        `WHSK: ${fmtWhsk(state.vaultWhsk)} | mUSDC: ${fmtUsdc6(state.vaultMusdc)}\n` +
        `Pool: ${fmtPrice6(state.poolPrice6)} | Ref: ${fmtPrice6(state.refPrice6)} | dev: ${state.deviationBps}bps\n` +
        `Trades: ${state.tradeCount} | Paused: ${state.paused ? 'YES' : 'no'}\n` +
        `Last: ${state.lastDecision}\n` +
        `Updated: ${state.updatedAt}` +
        (vault ? `\nOn-chain NAV: ${fmtUsdc6(vault.nav6.toString())} mUSDC` : ''),
    );
  });

  bot.command('pnl', async (ctx) => {
    const state = await loadState();
    if (!state) return ctx.reply('No state yet.');
    await ctx.reply(
      `NAV now: ${fmtUsdc6(state.nav6)} mUSDC\n` +
        `Trades so far: ${state.tradeCount}\n` +
        `Last decision: ${state.lastDecision}`,
    );
  });

  bot.command('trades', async (ctx) => {
    const state = await loadState();
    if (!state || state.trades.length === 0) return ctx.reply('No trades yet.');
    const lines = state.trades.slice(-5).map(
      (t) => `${t.at.slice(11, 19)} ${t.action} ${t.amountIn} (pool ${fmtPrice6(t.poolPrice6)}, ref ${fmtPrice6(t.refPrice6)})`,
    );
    await ctx.reply(lines.join('\n'));
  });

  bot.command('set', async (ctx) => {
    const [, key, value] = ctx.message?.text?.split(/\s+/) ?? [];
    const allowed = [
      'deviationThresholdBps',
      'maxTradeBps',
      'maxSlippageBps',
      'maxPoolShareBps',
      'gapCloseBps',
      'cooldownMs',
    ] as const;
    if (!key || !allowed.includes(key as (typeof allowed)[number]) || !/^\d+$/.test(value ?? '')) {
      return ctx.reply(`Usage: /set <param> <value>\nParams: ${allowed.join(', ')}`);
    }
    const state = (await loadState()) ?? null;
    if (!state) return ctx.reply('No state yet — wait for the first agent tick.');
    (state.params as unknown as Record<string, number>)[key] = Number(value);
    await fs.writeFile(config.stateFile, JSON.stringify(state, null, 2));
    await ctx.reply(`Set ${key} = ${value}. Applies from the next tick.`);
  });

  bot.command('pause', async (ctx) => {
    const tx = await setVaultPaused(true);
    await ctx.reply(`Trading paused on-chain. tx ${tx}`);
  });

  bot.command('resume', async (ctx) => {
    const tx = await setVaultPaused(false);
    await ctx.reply(`Trading resumed on-chain. tx ${tx}`);
  });

  return bot;
}
