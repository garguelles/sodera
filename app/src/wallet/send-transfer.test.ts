import { createPublicClient, decodeFunctionData } from 'viem';
import { sepolia } from 'viem/chains';

import { parseSendTransfer, resolveSepoliaRecipient } from './send-transfer';
import { SEPOLIA_USDC_ADDRESS } from './sepolia';

jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  createPublicClient: jest.fn(),
}));

const recipient = '0x2222222222222222222222222222222222222222' as const;
const getEnsAddress = jest.fn();
const mockedClient = jest.mocked(createPublicClient);

beforeEach(() => {
  process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL = 'https://sepolia.example';
  getEnsAddress.mockReset();
  mockedClient.mockReturnValue({ getChainId: async () => sepolia.id, getEnsAddress } as never);
});

describe('Sepolia recipients', () => {
  it.each(['gargs.eth', 'gargs.sodera.eth'])('resolves the complete name %s on Sepolia', async (name) => {
    getEnsAddress.mockResolvedValue(recipient);
    expect(await resolveSepoliaRecipient(name)).toEqual({ address: recipient, name });
    expect(mockedClient).toHaveBeenCalledWith(expect.objectContaining({ chain: sepolia }));
    expect(getEnsAddress).toHaveBeenCalledWith({ name });
  });

  it('rejects an unresolvable subdomain rather than sending to its parent', async () => {
    getEnsAddress.mockResolvedValue(null);
    await expect(resolveSepoliaRecipient('missing.sodera.eth')).rejects.toThrow('has no address on Sepolia ENS');
    expect(getEnsAddress).toHaveBeenCalledWith({ name: 'missing.sodera.eth' });
  });

  it('rejects malformed names and accepts addresses without ENS lookup', async () => {
    await expect(resolveSepoliaRecipient('gargs..eth')).rejects.toThrow('valid Ethereum address or ENS name');
    expect(await resolveSepoliaRecipient(recipient)).toEqual({ address: recipient, name: null });
    expect(getEnsAddress).not.toHaveBeenCalled();
  });
});

describe('send amounts and calls', () => {
  it('encodes ETH as a value transfer and USDC as an ERC-20 transfer', () => {
    expect(parseSendTransfer({ recipient, asset: 'ETH', amount: '0.1', balance: 10n ** 18n }).call).toEqual({
      to: recipient, value: 100_000_000_000_000_000n, data: '0x',
    });
    const usdc = parseSendTransfer({ recipient, asset: 'USDC', amount: '1.234567', balance: 2_000_000n });
    expect(usdc.call.to).toBe(SEPOLIA_USDC_ADDRESS);
    expect(usdc.call.value).toBe(0n);
    expect(decodeFunctionData({
      abi: [{ type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] }],
      data: usdc.call.data,
    })).toMatchObject({ functionName: 'transfer', args: [recipient, 1_234_567n] });
  });

  it('enforces precision and the selected asset balance', () => {
    expect(() => parseSendTransfer({ recipient, asset: 'USDC', amount: '0.0000001', balance: 2_000_000n })).toThrow('no more than 6 decimals');
    expect(() => parseSendTransfer({ recipient, asset: 'USDC', amount: '0', balance: 2_000_000n })).toThrow('greater than zero');
    expect(() => parseSendTransfer({ recipient, asset: 'ETH', amount: '2', balance: 10n ** 18n })).toThrow('available ETH balance');
  });
});
