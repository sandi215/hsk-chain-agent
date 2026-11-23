# HSK Agent — Track 1 (AI Agent Trading) — DESIGN

HSK Chain Horizon Hackathon · Seoul. Solo entry, DoraHacks account "jepee".
Submit build before **3 Dec 2026, 11:00 WIB**. Prize 12,000 USDT (6,000/track;
1st 3,000 / 2nd 2,000 / 3rd 1,000). Demo Day 5 Dec (hybrid, Seoul), winners 6 Dec.
Verified hackathon facts: `../hsk-chain-horizon-verified-2026-11-23.md`.
Mainnet deploy cost research: `../hsk-chain-mainnet-cost-2026-11-23.md`.

## 1. What we found on the ground (23 Nov 2026)

- **HSK Chain testnet is live and reachable**: chain 133, RPC `https://testnet.hsk.xyz`
  (block ~36,090,889 at check), gas ~1 gwei, explorer `https://testnet-explorer.hsk.xyz`
  (API unreachable from this VM; use the dRPC alt `https://hashkey-testnet.drpc.org` if needed).
- **HSKSwap contracts are NOT discoverable**: the app (`app.hskswap.com`) is
  geo-blocked from this VM (Cloudflare "Access Restricted — not available in your
  jurisdiction"); no router/factory addresses in any indexed doc, GitHub, or search
  result. DeFiLlama: HSK Chain DeFi TVL is **$1,208 total**, DEX aggregator volume $0.
  There is effectively **no organic DEX liquidity** on HSK Chain (mainnet or testnet).
- **The faucet-page USDC address is NOT an HSK token**: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
  has no code on HSK testnet; on Ethereum Sepolia it is USDC (name "USDC", 6 decimals).
  It belongs to the HSP/Sepolia side of the hackathon, not to HSKSwap on HSK Chain.
- **Faucet is reCAPTCHA-gated**: `faucet.hsk.xyz` → `faucet.hskchain.net/faucet`,
  API `https://faucet-api.hashkeychain.net`, `POST /api/faucet/drip` needs
  `{token: <reCAPTCHA v2 token>, address}`. No API-only claim is possible without
  solving the captcha — that step needs a browser (parent) or Sandi on his phone.
  **Claimed 23 Nov 00:40 WIB** (browser task): 0.1 tHSK actually received
  (advertised 1 HSK/24h), tx `0x61e9de06373e475403faaef8ce24d7f12048d16f063595cec7abb0b0d277984a`,
  block 36091273. Next claim ~24h later. Thirdweb's universal faucet is a backup
  (0.01 tHSK / 24h, wallet connect).
  Explorer: `https://testnet-explorer.hskchain.net` — `testnet-explorer.hsk.xyz` is DEAD.
- **Mainnet deploy is cheap** (~$0.01–0.08 at 500 gwei, HSK ~$0.0805) but HSK must be
  bought on a CEX + bridged — no mainnet faucet. That is a later phase; this phase
  is **testnet only**.

## 2. Strategy — reference-peg mean reversion (ONE pair, ONE idea)

Because the venue has no organic price action, momentum/trend strategies are
meaningless (the agent's own trades would be the only price moves). The honest,
demonstrable edge is **arbitrage between the AMM pool price and the real HSK price**:

- **Pair**: WHSK–mUSDC on our own Uniswap-V2-compatible venue (see §3).
- **Reference**: HSK/USD from CoinGecko (primary) / MEXC ticker (fallback), ~$0.0803 live.
- **Signal**: `deviation = (poolPrice - refPrice) / refPrice`. Trade only if
  `|deviation| > 1.5%` (150 bps).
- **Direction**: pool cheap → buy WHSK with mUSDC; pool expensive → sell WHSK.
  Always trading TOWARD the peg, never chasing momentum.
- **Size** (per trade): `min(2% of vault NAV, 1% of pool reserves, amount that closes
  50% of the price gap)` — CPAMM approximation `dP/P ~= 2*dR/R`. Dust guards
  (0.1 mUSDC / 0.001 WHSK) skip noise trades.
- **Execution**: quote via router `getAmountsOut`, `minOut` = quote minus 1% max slippage.
- **Risk** (enforced ON-CHAIN in the vault, not just in the bot):
  max 2% NAV per trade · max 1% slippage · daily loss cap 5% of day-start NAV →
  auto-pause · session stop-loss 10% below session-start NAV → auto-pause ·
  60 s cooldown between trades · exact-amount approvals only (no unlimited allowance) ·
  no leverage, no flash loans.
- **Demo story**: the pool is seeded at the peg ($0.08). The reference price moves
  (real HSK moves on CEXes) and/or a demo trade displaces the pool; the agent
  detects the deviation and arbs it back, printing the trade + PnL in Telegram.
  Every decision is logged with its reason (hold: within band / cooldown / too small).

## 3. Contracts (`contracts/`, Foundry)

- **`HskAgentVault.sol`** — holds WHSK + mUSDC. Only the agent EOA can trade, only
  through the approved router. `deposit`/`withdraw`/`setRiskParams`/`setAgent`/
  `setRouter`/`setPair`/`pause`/`unpause`/`resetSessionNav` are owner-only.
  `nav()` and `poolPrice()` read the pair reserves (mUSDC terms, 6 decimals).
  `_checkRisk` auto-pauses on daily-loss or session stop-loss breach.
- **`MockUSDC.sol`** — testnet-only 6-decimal mock USDC, owner-mintable, for seeding.
- **Venue** — canonical Uniswap V2 (Factory + Router02 + WETH9-as-WHSK), deployed from
  the published npm build artifacts (`artifacts/`, converted to forge format) via
  `deployCode`, because V2 source is Solidity 0.5.16/0.6.6 and cannot be imported
  into 0.8.19 files. Same bytecode/ABI as audited V2. All calls go through the
  minimal 0.8.19 interfaces in `src/interfaces/IVenue.sol`.
- **Scripts**: `DeployVenue.s.sol` (WHSK/factory/router/mUSDC),
  `SeedPool.s.sol` (wrap tHSK, mint mUSDC, add liquidity — e.g. 10,000 tHSK + 800 mUSDC
  ≈ $0.08 peg), `DeployVault.s.sol`.
- **Tests**: `forge test` — **11/11 pass**, including pool peg, NAV math, buy/sell,
  trade-size cap, only-agent, slippage guard, pause, risk-param bounds, stop-loss
  auto-pause after a simulated 9,000-WHSK dump, and a mean-reversion buy at the
  crashed price. Two real bugs were caught and fixed by the tests (trade-size cap
  unit mismatch WHSK-wei vs mUSDC-NAV; session NAV baselined mid-funding).

## 4. Off-chain agent (`agent/`, TypeScript + viem)

- **`strategy.ts`** — pure decision engine (no I/O, 11/11 vitest pass).
- **`price.ts`** — CoinGecko → MEXC fallback reference price (verified live: $0.0803).
- **`chain.ts`** — viem clients (chain 133), pool/vault reads, quote + minOut,
  `executeVaultTrade`, pause/resume.
- **`agent.ts`** — 30 s loop: read pool + vault + reference → decide → execute →
  append to `state.json` (NAV series, last decision, last 50 trades).
- **`bot.ts`** — Telegram (grammy): `/status` (NAV, positions, pool/ref/deviation),
  `/pnl`, `/trades`, `/set <param> <value>` (live risk tuning), `/pause`, `/resume`.
  Bot token is NOT created in this phase (needs BotFather — parent step).
- **Config**: all addresses/params via `.env` (see `.env.example`). Private key is
  the agent testnet wallet only, never mainnet.

## 5. What is scaffolded (23 Nov 2026)

```
hsk-chain-agent/
  DESIGN.md            <- this file
  README.md
  contracts/           foundry project; forge test 11/11 PASS
    src/HskAgentVault.sol, src/MockUSDC.sol, src/interfaces/IVenue.sol
    script/DeployVenue.s.sol, SeedPool.s.sol, DeployVault.s.sol
    test/HskAgentVault.t.sol
    artifacts/         V2 build artifacts (forge format, from npm)
  agent/               npm project; tsc clean; vitest 11/11 PASS
    src/config.ts, price.ts, strategy.ts, chain.ts, agent.ts, bot.ts, index.ts
    test/strategy.test.ts
```

## 6. Phase 2 — DEPLOYED + trading on testnet (23 Nov 2026, ~00:47–00:57 WIB)

Budget was 0.1 tHSK total (faucet). Scaled the plan down: pool 0.07 tHSK +
5,600 mUSDC base units @ $0.08 peg; vault funded 0.01 WHSK + 800 mUSDC
(NAV 1,600 at baseline). Spent ~0.095 tHSK; **remaining 0.00526 tHSK**.

Deployed (chain 133, all by `0x83291a838d361a2cB73869EB26ED9Fa140F0256D`):
WHSK `0x47800f60e6b135813Ff3fa68fe3cD3AF50C6264f` · Factory
`0x018Bb6ee03813F4C5c8e9bc182851EDfB3852876` · Router02
`0xf1854df26d6bCcEA96C14457c93B4CdF99A74E65` · mUSDC
`0xB314885fBF45BE45b47A18fBdAcCD4c952f98A59` · Pair
`0x2e28906B86A0d1857f08ebe84C733DF3D112f654` · Vault
`0xedf7072f329ae9f095c7b49ce5af1011c787f56b` (deploy tx
`0xa1bdbe63cdb1ac096ff43568616c6ea082db88c6b67d02226cac88dcdb40dd8a`).

Agent ran headless (Telegram bot out of scope this phase — token pending) and
executed **4 real sells** (all receipts status 1), arbing the pool from the
demo displacement (~$0.0949) back toward the peg (~$0.0918 after 4 sells):
`0xd7e5d756…` (0.000358 WHSK, +1804bps), `0x4c718a33…` (0.000362, +1680bps),
`0x2d75bd96…` (0.000366, +1543bps), `0x007781f3…` (0.000370, +1419bps).
On-chain `tradeCount` = 4, NAV = 1,707. `agent/state.json` holds all 4 trades.
Agent STOPPED after verification to preserve the 0.00526 tHSK balance;
restart with `npm start` in `agent/`.

## 7. Phase-2 fixes (bugs found live, all fixed + tested)

1. **`DeployVenue` broadcast placement**: `deployCode` was called BEFORE
   `vm.startBroadcast`, so the venue contracts would only exist in the local
   simulation, never on-chain. Moved inside the broadcast block; verified all
   4 contracts have code on-chain after deploy.
2. **`SeedPool` "stack too deep"**: solc refused to compile the script (too many
   live locals at the `addLiquidity` call). Split the work into `_seed()`.
3. **Dust guards env-configurable**: hardcoded 0.1 mUSDC / 0.001 WHSK guards
   would block every trade on a $0.011 pool. Added `minBuyAmount` /
   `minSellAmount` to `StrategyParams` + `MIN_BUY_AMOUNT` / `MIN_SELL_AMOUNT`
   env vars (demo values 10 / 10^13); defaults keep the phase-1 values.
4. **`moveBps` fractional crash**: `moveBps = dev * gapCloseBps / 10000` is
   fractional for odd deviations (e.g. 1543bps → 771.5) and `BigInt(771.5)`
   throws, killing the tick. Now floored (in both the computation and
   `gapAmount`); regression test added (vitest now 12/12).

## 8. Remaining steps

1. **Telegram bot**: create via BotFather, set `TELEGRAM_BOT_TOKEN`, verify commands.
2. **HSKSwap**: keep trying to discover its testnet router (X/Telegram/Discord,
   DoraHacks faucet page, explorer UI via browser). If found, the agent can point
   the vault at it with one `setRouter` call — the strategy is venue-agnostic.
3. **Demo + submit**: record a demo video of the Telegram PnL + a live arb trade;
   Submit Build before 3 Dec 11:00 WIB. Mainnet deploy (cheap, ~$0.01–0.08 gas)
   is a separate step needing CEX-bought HSK — decide with Sandi when the
   testnet build is proven.
4. **Faucet top-up**: next claim ~24h after the 00:40 WIB claim, if more tHSK
   is needed for further demo runs (0.00526 tHSK left ≈ 17 agent trades).
