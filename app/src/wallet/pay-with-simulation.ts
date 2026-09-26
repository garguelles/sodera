import { isAddressEqual, keccak256, toHex, type Address, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';

import type { PayQuoteRequest } from '../agent/agent-client';
import type { KernelExecutionCall } from './kernel-passkey-execution';
import { sepoliaClient } from './send-transfer';
import { SEPOLIA_USDC_ADDRESS } from './sepolia';

// The bundler's simulation only proves the batch does not revert. This one runs the same calls from
// the account on current Sepolia state with transfer tracing, and checks where the money goes.

/** eth_simulateV1 reports native transfers as ERC-20 style logs from this address. */
const NATIVE_TRANSFER_LOG_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));

type Asset = PayQuoteRequest['payAsset'];
export type PayWithSimulationClient = Pick<PublicClient, 'getChainId' | 'simulateBlocks'>;

/** Net balance changes per asset and lowercase address. */
export type PayWithDeltas = Record<Asset, Record<string, bigint>>;

export async function simulatePayWith({
  account,
  recipient,
  request,
  maxAmountIn,
  calls,
  client = sepoliaClient(),
}: {
  account: Address;
  recipient: Address;
  request: PayQuoteRequest;
  maxAmountIn: bigint;
  calls: readonly KernelExecutionCall[];
  client?: PayWithSimulationClient;
}): Promise<{ spent: bigint }> {
  if ((await client.getChainId()) !== sepolia.id) throw new Error('Send RPC is not Ethereum Sepolia');
  const [block] = await client.simulateBlocks({
    blocks: [{ calls: calls.map((call) => ({ account, to: call.to, value: call.value, data: call.data })) }],
    traceTransfers: true,
  });
  const failed = block.calls.findIndex((result) => result.status !== 'success');
  if (failed !== -1) throw new Error(`The payment would fail on Sepolia at step ${failed + 1} of ${calls.length}`);

  const deltas = transferDeltas(block.calls.flatMap((result) => result.logs ?? []));
  const net = (asset: Asset, address: Address) => deltas[asset][address.toLowerCase()] ?? 0n;
  if (net(request.receiveAsset, recipient) !== BigInt(request.amountOut)) {
    throw new Error('The simulated payment does not give the recipient the exact amount');
  }
  if (net(request.receiveAsset, account) < 0n) {
    throw new Error(`The simulated payment spends your own ${request.receiveAsset}`);
  }
  const spent = -net(request.payAsset, account);
  if (spent > maxAmountIn) throw new Error(`The simulated payment spends more ${request.payAsset} than the quoted maximum`);
  return { spent };
}

export function transferDeltas(
  logs: readonly { address: Address; topics: readonly (string | null)[]; data: string }[],
): PayWithDeltas {
  const deltas: PayWithDeltas = { ETH: {}, USDC: {} };
  for (const log of logs) {
    const asset = log.address.toLowerCase() === NATIVE_TRANSFER_LOG_ADDRESS
      ? 'ETH'
      : isAddressEqual(log.address, SEPOLIA_USDC_ADDRESS)
        ? 'USDC'
        : null;
    const [topic, fromTopic, toTopic] = log.topics;
    if (!asset || topic !== TRANSFER_TOPIC || !fromTopic || !toTopic) continue;
    const from = `0x${fromTopic.slice(26)}`.toLowerCase();
    const to = `0x${toTopic.slice(26)}`.toLowerCase();
    const amount = BigInt(log.data);
    deltas[asset][from] = (deltas[asset][from] ?? 0n) - amount;
    deltas[asset][to] = (deltas[asset][to] ?? 0n) + amount;
  }
  return deltas;
}
