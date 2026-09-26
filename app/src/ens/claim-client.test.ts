import { fetch as expoFetch } from 'expo/fetch';

import { createEnsClaimAuthClient, readSoderaApiUrl } from './claim-auth-client';
import { createEnsClaimClient } from './claim-client';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('./claim-auth-client', () => ({
  createEnsClaimAuthClient: jest.fn(),
  readSoderaApiUrl: jest.fn((value) => value),
}));

const account = '0x1111111111111111111111111111111111111111';
const id = '11111111-1111-4111-8111-111111111111';
const credential = { id: 'credential' } as RegisteredPrimaryPasskey;
const ceremonyClient = { authenticatePrimaryPasskey: jest.fn() } as unknown as PasskeyCeremonyClient;
const request = jest.fn() as jest.MockedFunction<typeof expoFetch>;

function reply(value: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => value } as Awaited<ReturnType<typeof expoFetch>>;
}

beforeEach(() => {
  request.mockReset();
  jest.mocked(createEnsClaimAuthClient).mockReset();
});

describe('ENS claim client', () => {
  it('hands a fresh scoped proof token to the API and tracks the returned claim ID', async () => {
    const prove = jest.fn().mockResolvedValue({ name: 'gargs.sodera.eth', claimToken: 'A'.repeat(43) });
    jest.mocked(createEnsClaimAuthClient).mockReturnValue({ prove } as never);
    request.mockResolvedValueOnce(reply({ id, account, name: 'gargs.sodera.eth', chainId: 11155111, status: 'queued' }, 202))
      .mockResolvedValueOnce(reply({ id, account, name: 'gargs.sodera.eth', chainId: 11155111, status: 'confirmed' }));
    const client = createEnsClaimClient({ ceremonyClient, request, baseUrl: 'https://api.sodera.xyz' });
    expect(await client.submit({ account, credential, label: 'gargs' })).toMatchObject({ id, status: 'queued' });
    expect(prove).toHaveBeenCalledWith({ account, credential, label: 'gargs' });
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ account, label: 'gargs', claimToken: 'A'.repeat(43) });
    expect(await client.status({ id, account, label: 'gargs' })).toMatchObject({ id, status: 'confirmed' });
    expect(request.mock.calls[1]![0]).toBe('https://api.sodera.xyz/ens/claims/' + id);
    expect(readSoderaApiUrl).toHaveBeenCalled();
  });

  it('rejects a claim response for a different account or name', async () => {
    jest.mocked(createEnsClaimAuthClient).mockReturnValue({ prove: jest.fn().mockResolvedValue({ claimToken: 'A'.repeat(43) }) } as never);
    request.mockResolvedValueOnce(reply({ id, account: '0x2222222222222222222222222222222222222222',
      name: 'gargs.sodera.eth', chainId: 11155111, status: 'confirmed' }));
    await expect(createEnsClaimClient({ ceremonyClient, request, baseUrl: 'https://api.sodera.xyz' })
      .submit({ account, credential, label: 'gargs' })).rejects.toThrow('mismatched claim');
  });
});
