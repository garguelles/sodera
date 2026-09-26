import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
} from 'viem';
import { normalize } from 'viem/ens';
import { sepolia } from 'viem/chains';

import { SEPOLIA_USDC_ADDRESS } from './sepolia';
import type { KernelExecutionCall } from './kernel-passkey-execution';

export type SendAsset = 'ETH' | 'USDC';

const usdcAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

export function sepoliaClient() {
  const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error('Ethereum RPC URL is required to send');
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

export async function resolveSepoliaRecipient(input: string): Promise<{ address: Address; name: string | null }> {
  const recipient = input.trim();
  if (isAddress(recipient)) return { address: recipient, name: null };
  let name: string;
  try {
    if (!recipient.includes('.')) throw new Error('Invalid ENS name');
    name = normalize(recipient);
  } catch {
    throw new Error('Enter a valid Ethereum address or ENS name');
  }
  const client = sepoliaClient();
  if (await client.getChainId() !== sepolia.id) throw new Error('ENS RPC is connected to the wrong network');
  const address = await client.getEnsAddress({ name });
  if (!address || !isAddress(address)) throw new Error(`${name} has no Ethereum address`);
  return { address, name };
}

export async function readSendBalances(account: Address) {
  const client = sepoliaClient();
  const [chainId, ETH, USDC] = await Promise.all([
    client.getChainId(),
    client.getBalance({ address: account }),
    client.readContract({ address: SEPOLIA_USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [account] }),
  ]);
  if (chainId !== sepolia.id) throw new Error('Send RPC is connected to the wrong network');
  return { ETH, USDC };
}

/** The exact amount in base units, before any balance check. */
export function parseSendAmount({ amount, asset }: { amount: string; asset: SendAsset }): bigint {
  const precision = asset === 'ETH' ? 18 : 6;
  const trimmed = amount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed) || (trimmed.split('.')[1]?.length ?? 0) > precision) {
    throw new Error(`Enter a valid ${asset} amount with no more than ${precision} decimals`);
  }
  let value: bigint;
  try {
    value = asset === 'ETH' ? parseEther(trimmed) : parseUnits(trimmed, 6);
  } catch {
    throw new Error(`Enter a valid ${asset} amount with no more than ${asset === 'ETH' ? 18 : 6} decimals`);
  }
  if (value <= 0n) throw new Error('Amount must be greater than zero');
  return value;
}

export function parseSendTransfer({ recipient, amount, asset, balance }: {
  recipient: Address;
  amount: string;
  asset: SendAsset;
  balance: bigint;
}): { value: bigint; call: KernelExecutionCall } {
  const value = parseSendAmount({ amount, asset });
  if (value > balance) throw new Error(`Amount exceeds the available ${asset} balance`);
  return {
    value,
    call: asset === 'ETH'
      ? { to: recipient, value, data: '0x' }
      : {
          to: SEPOLIA_USDC_ADDRESS,
          value: 0n,
          data: encodeFunctionData({ abi: usdcAbi, functionName: 'transfer', args: [recipient, value] }),
        },
  };
}
