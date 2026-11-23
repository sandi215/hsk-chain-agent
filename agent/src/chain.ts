import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config.js';

// HSK Chain testnet, chain ID 133.
export const hskTestnet = {
  id: 133,
  name: 'HSK Chain Testnet',
  nativeCurrency: { name: 'tHSK', symbol: 'tHSK', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

const publicClient = createPublicClient({ chain: hskTestnet, transport: http() });

const account = privateKeyToAccount(config.agentPrivateKey as Hex);
const walletClient = createWalletClient({
  account,
  chain: hskTestnet,
  transport: http(),
});

const pairAbi = [
  {
    name: 'getReserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
  {
    name: 'token0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const routerAbi = [
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

const vaultAbi = [
  {
    name: 'poolPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'nav',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'paused',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'tradeCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'executeTrade',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'buyWhsk', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'pause',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'unpause',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;

const erc20Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface PoolSnapshot {
  reserveWhsk: bigint;
  reserveMusdc: bigint;
  poolPrice6: bigint;
}

export async function readPool(): Promise<PoolSnapshot> {
  const [r0, r1] = (await publicClient.readContract({
    address: config.pairAddress,
    abi: pairAbi,
    functionName: 'getReserves',
  })) as [bigint, bigint, number];
  const token0 = (await publicClient.readContract({
    address: config.pairAddress,
    abi: pairAbi,
    functionName: 'token0',
  })) as Address;
  const reserveWhsk = token0.toLowerCase() === config.whskAddress.toLowerCase() ? r0 : r1;
  const reserveMusdc = token0.toLowerCase() === config.whskAddress.toLowerCase() ? r1 : r0;
  const poolPrice6 = reserveWhsk === 0n ? 0n : (reserveMusdc * 10n ** 18n) / reserveWhsk;
  return { reserveWhsk, reserveMusdc, poolPrice6 };
}

export interface VaultSnapshot {
  nav6: bigint;
  poolPrice6: bigint;
  paused: boolean;
  tradeCount: bigint;
  whskBalance: bigint;
  musdcBalance: bigint;
}

export async function readVault(): Promise<VaultSnapshot> {
  const [nav6, poolPrice6, paused, tradeCount, whskBalance, musdcBalance] =
    await Promise.all([
      publicClient.readContract({ address: config.vaultAddress, abi: vaultAbi, functionName: 'nav' }),
      publicClient.readContract({ address: config.vaultAddress, abi: vaultAbi, functionName: 'poolPrice' }),
      publicClient.readContract({ address: config.vaultAddress, abi: vaultAbi, functionName: 'paused' }),
      publicClient.readContract({ address: config.vaultAddress, abi: vaultAbi, functionName: 'tradeCount' }),
      publicClient.readContract({ address: config.whskAddress, abi: erc20Abi, functionName: 'balanceOf', args: [config.vaultAddress] }),
      publicClient.readContract({ address: config.musdcAddress, abi: erc20Abi, functionName: 'balanceOf', args: [config.vaultAddress] }),
    ]);
  return {
    nav6: nav6 as bigint,
    poolPrice6: poolPrice6 as bigint,
    paused: paused as boolean,
    tradeCount: tradeCount as bigint,
    whskBalance: whskBalance as bigint,
    musdcBalance: musdcBalance as bigint,
  };
}

/** Quote the router and apply the max-slippage guard to get minOut. */
export async function quoteMinOut(
  buyWhsk: boolean,
  amountIn: bigint,
  maxSlippageBps: number,
): Promise<bigint> {
  const path: [Address, Address] = buyWhsk
    ? [config.musdcAddress, config.whskAddress]
    : [config.whskAddress, config.musdcAddress];
  const amounts = (await publicClient.readContract({
    address: config.routerAddress,
    abi: routerAbi,
    functionName: 'getAmountsOut',
    args: [amountIn, path],
  })) as bigint[];
  const quoted = amounts[1];
  return (quoted * BigInt(10_000 - maxSlippageBps)) / 10_000n;
}

export async function executeVaultTrade(
  buyWhsk: boolean,
  amountIn: bigint,
  minOut: bigint,
): Promise<`0x${string}`> {
  return walletClient.writeContract({
    address: config.vaultAddress,
    abi: vaultAbi,
    functionName: 'executeTrade',
    args: [buyWhsk, amountIn, minOut],
  });
}

export async function setVaultPaused(paused: boolean): Promise<`0x${string}`> {
  return walletClient.writeContract({
    address: config.vaultAddress,
    abi: vaultAbi,
    functionName: paused ? 'pause' : 'unpause',
  });
}

export function agentAddress(): Address {
  return account.address;
}
