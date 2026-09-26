import { formatEther, formatUnits, type Address } from 'viem';

import { SEPOLIA_USDC_ADDRESS } from '@/wallet/sepolia';
import { readEthUsdPrice, SEPOLIA_READ_ABI, type SepoliaBalanceClient } from '@/wallet/wallet-home-live';

import type { AgentContext } from './schema';

/** Actions the phone can encode today; the vault waits on its seam (PRA-216). */
export const AGENT_CAPABILITIES: AgentContext['capabilities'] = {
  send_eth: true,
  send_usdc: true,
  swap: true,
  vault_deposit: false,
  vault_withdraw: false,
};

/** The wallet snapshot sent with every request. The app is the authority on its own state. */
export async function loadAgentContext({
  account,
  balanceClient,
  now = Date.now,
}: {
  account: Address;
  balanceClient: SepoliaBalanceClient;
  now?: () => number;
}): Promise<AgentContext> {
  const [chainId, ethWei, usdcMicro, price] = await Promise.all([
    balanceClient.getChainId(),
    balanceClient.getBalance({ address: account }),
    balanceClient.readContract({
      address: SEPOLIA_USDC_ADDRESS,
      abi: SEPOLIA_READ_ABI,
      functionName: 'balanceOf',
      args: [account],
    }),
    readEthUsdPrice(balanceClient, now),
  ]);
  if (chainId !== 11155111) throw new Error('Wallet data is connected to the wrong network');
  if (typeof usdcMicro !== 'bigint') throw new Error('Invalid USDC balance');

  return {
    chainId: 11155111,
    now: new Date(now()).toISOString(),
    balances: { eth: formatEther(ethWei), usdc: formatUnits(usdcMicro, 6) },
    prices: { ethUsd: price ? formatUnits(price.answer, price.decimals) : null },
    vaultPosition: null,
    sponsorship: null,
    // Reserved for a future phonebook; recipients resolve through ENS.
    addressBook: [],
    capabilities: AGENT_CAPABILITIES,
  };
}
