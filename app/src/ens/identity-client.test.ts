import { fetch as expoFetch } from 'expo/fetch';

import { createEnsIdentityReader } from './identity-client';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

const account = '0x1111111111111111111111111111111111111111' as const;
const request = jest.fn() as jest.MockedFunction<typeof expoFetch>;
const resolver = jest.fn();
const name = 'gargs.sodera.eth';

function reply(status: string, owner: string | null = null, expiresAt: string | null = null) {
  return { ok: true, json: async () => ({ chainId: 11155111, name, status,
    claimable: status === 'available', owner, expiresAt }) } as Awaited<ReturnType<typeof expoFetch>>;
}

beforeEach(() => { request.mockReset(); resolver.mockReset(); });

describe('ENS identity reader', () => {
  const reader = () => createEnsIdentityReader({ request, baseUrl: 'https://api.sodera.xyz', resolveAddress: resolver });

  it('checks live availability before claiming', async () => {
    request.mockResolvedValueOnce(reply('available'));
    await expect(reader().availability('gargs')).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith('https://api.sodera.xyz/ens/availability/gargs');
  });

  it('only verifies an unexpired owner whose universal resolution matches the wallet', async () => {
    request.mockResolvedValueOnce(reply('registered', account, '2099-01-01T00:00:00.000Z'));
    resolver.mockResolvedValueOnce(account);
    await expect(reader().verify(name, account)).resolves.toBe(true);
    request.mockResolvedValueOnce(reply('registered', account, '2099-01-01T00:00:00.000Z'));
    resolver.mockResolvedValueOnce('0x2222222222222222222222222222222222222222');
    await expect(reader().verify(name, account)).resolves.toBe(false);
    request.mockResolvedValueOnce(reply('registered', account, '2020-01-01T00:00:00.000Z'));
    await expect(reader().verify(name, account)).resolves.toBe(false);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
