import { ChainId, Ether, Token } from '@uniswap/sdk-core';
import { Pool } from '@uniswap/v4-sdk';
import { zeroAddress, type Address, type Hex } from 'viem';

import { SEPOLIA_USDC_ADDRESS } from './sepolia';

export const SWAP_ETH = Ether.onChain(ChainId.SEPOLIA);
export const SWAP_USDC = new Token(ChainId.SEPOLIA, SEPOLIA_USDC_ADDRESS, 6, 'USDC', 'USD Coin');

// Pinned in docs/research/PRA-212-uniswap-v4-sepolia-route.md.
const SWAP_POOL_FEE = 20;
const SWAP_POOL_TICK_SPACING = 1;
const SWAP_POOL_HOOKS = zeroAddress;

const poolKey = Pool.getPoolKey(
  SWAP_ETH,
  SWAP_USDC,
  SWAP_POOL_FEE,
  SWAP_POOL_TICK_SPACING,
  SWAP_POOL_HOOKS,
);

export const SWAP_POOL_KEY = {
  currency0: poolKey.currency0 as Address,
  currency1: poolKey.currency1 as Address,
  fee: poolKey.fee,
  tickSpacing: poolKey.tickSpacing,
  hooks: poolKey.hooks as Address,
};
export const SWAP_POOL_ID = Pool.getPoolId(
  SWAP_ETH,
  SWAP_USDC,
  SWAP_POOL_FEE,
  SWAP_POOL_TICK_SPACING,
  SWAP_POOL_HOOKS,
) as Hex;
