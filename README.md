# HSK Agent — AI Agent Trading (HSK Chain Horizon Hackathon, Track 1)

Solo entry by Sandi ("jepee"). Submit build before **3 Dec 2026, 11:00 WIB**.

Strategy: **reference-peg mean reversion** — the agent trades the WHSK–mUSDC pool
toward the real HSK price (CoinGecko/MEXC), with strict on-chain risk limits
in `HskAgentVault`. Conversational UI via Telegram. Full design: [DESIGN.md](DESIGN.md).

## Status (23 Nov 2026, phase 2 — DEPLOYED + trading on testnet)

- Contracts: `forge test` **11/11 pass** (`contracts/`); agent `vitest` **12/12 pass** (incl. odd-deviation regression test).
- **Live on HSK Chain testnet (chain 133)** — all deployed by agent wallet
  `0x83291a838d361a2cB73869EB26ED9Fa140F0256D` (testnet only), explorer
  `https://testnet-explorer.hskchain.net`:
  - WHSK (WETH9): `0x47800f60e6b135813Ff3fa68fe3cD3AF50C6264f`
  - V2 Factory: `0x018Bb6ee03813F4C5c8e9bc182851EDfB3852876`
  - V2 Router02: `0xf1854df26d6bCcEA96C14457c93B4CdF99A74E65`
  - mUSDC (MockUSDC, 6 dec): `0xB314885fBF45BE45b47A18fBdAcCD4c952f98A59`
  - WHSK–mUSDC pair: `0x2e28906B86A0d1857f08ebe84C733DF3D112f654`
  - HskAgentVault: `0xedf7072f329ae9f095c7b49ce5af1011c787f56b`
    (deploy tx `0xa1bdbe63cdb1ac096ff43568616c6ea082db88c6b67d02226cac88dcdb40dd8a`)
- **Pool seeded 0.07 tHSK + 5,600 mUSDC base units @ $0.08 peg** (seed txs
  `0x8a8b4918…`, `0xe35a7c2c…`, `0xb8c7d346…`, `0x28f0b3e6…`, `0xcd40e2ef…`).
- **Vault funded 0.01 WHSK + 800 mUSDC** (NAV 1,600 at baseline, `resetSessionNav` done).
- **Agent ran headless and traded 4× on testnet** (all receipts status 1):
  - sell 0.000358 WHSK `0xd7e5d756731754634499fbc7ba4dd876fc86c6c43ea523d4cb973e0f31b668e6` (pool +1804bps)
  - sell 0.000362 WHSK `0x4c718a33405431c677615051b6d4d325ed2d8925284586730bf012813f0ebaca` (pool +1680bps)
  - sell 0.000366 WHSK `0x2d75bd96627b39d4ae4c89c94f9ec96a65305a2962171d8bfb40eb0a0e14afa9` (pool +1543bps)
  - sell 0.000370 WHSK `0x007781f398c9cf47b59524451237d12b13baf3bc0c9df53761d7b39982c4ccca` (pool +1419bps)
  - The pool was displaced to ~$0.0949 by a demo mUSDC→WHSK swap
    (`0x304636da90e518402a13a3029e533b13c72d488a9049dc5f4a946b5167d2f75a`);
    the agent arbed it back toward the peg (pool $0.0949 → ~$0.0918 after 4 sells).
    On-chain `tradeCount` = 4, NAV = 1,707. `state.json` holds all 4 trades.
- **Budget**: faucet sent 0.1 tHSK (advertised 1 HSK/24h, actually 0.1; claim tx
  `0x61e9de06373e475403faaef8ce24d7f12048d16f063595cec7abb0b0d277984a`).
  Spent ~0.095 tHSK (deploys ~0.009, seed 0.07, vault fund 0.01, gas ~0.006).
  **Remaining: 0.00526 tHSK.** Next faucet claim available ~24h after the first.
  Agent is STOPPED to preserve the balance; restart with `npm start` in `agent/`.
- **Phase-2 fixes** (see DESIGN.md §7): `DeployVenue` now broadcasts `deployCode`
  inside `startBroadcast` (before, venue contracts would only exist locally);
  `SeedPool` split to dodge solc "stack too deep"; dust guards made env-configurable
  (`MIN_BUY_AMOUNT`/`MIN_SELL_AMOUNT`, tiny-pool demo values 10 / 10^13);
  `moveBps` fractional-BigInt crash fixed (odd deviations e.g. 1543bps) + regression test.

## Still to do

- Telegram bot token (parent step via BotFather) — `bot.ts` is ready, token unset.
- Demo video (Telegram PnL + a live arb trade) + Submit Build before **3 Dec 11:00 WIB**.
- Mainnet deploy (gas ~$0.01–0.08) needs CEX-bought HSK + bridge — decide with Sandi.

## Quickstart (after the faucet claim)

```bash
# 1. Contracts — deploy venue, seed pool, deploy vault (chain 133)
cd contracts
export PRIVATE_KEY=<agent testnet key>   # testnet ONLY, never mainnet
forge script script/DeployVenue.s.sol --rpc-url https://testnet.hsk.xyz --broadcast
# -> note WHSK / FACTORY / ROUTER / MUSDC addresses
export ROUTER=<...> WHSK=<...> MUSDC=<...>
# Small-scale seed (0.1 tHSK faucet budget): 0.07 tHSK + 5600 mUSDC units @ $0.08 peg
export TSHK_AMOUNT=70000000000000000 MUSDC_AMOUNT=5600
forge script script/SeedPool.s.sol --rpc-url https://testnet.hsk.xyz --broadcast
export PAIR=<factory.getPair(WHSK, MUSDC)> AGENT=<agent address>
forge script script/DeployVault.s.sol --rpc-url https://testnet.hsk.xyz --broadcast

# 2. Agent — fill agent/.env from .env.example, then run
cd ../agent
npm install
npm test        # strategy unit tests
npm start       # loop (30s) + Telegram bot
```

## Layout

- `contracts/src/HskAgentVault.sol` — vault + on-chain risk limits
- `contracts/src/MockUSDC.sol` — testnet-only mock USDC (6 dec)
- `contracts/script/` — DeployVenue / SeedPool / DeployVault
- `contracts/test/HskAgentVault.t.sol` — 11 forge tests
- `agent/src/strategy.ts` — pure decision engine
- `agent/src/price.ts` — CoinGecko -> MEXC reference price
- `agent/src/chain.ts` — viem (chain 133) reads + vault execution
- `agent/src/agent.ts` — 30s loop, writes `state.json`
- `agent/src/bot.ts` — Telegram: /status /pnl /trades /set /pause /resume
