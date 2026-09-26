import { fetch as expoFetch } from 'expo/fetch';

import { createEnsClaimAuthClient } from './claim-auth-client';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

const account = '0x1111111111111111111111111111111111111111';
const credential = { id: 'primary-passkey' } as RegisteredPrimaryPasskey;
const id = '11111111-1111-4111-8111-111111111111';
const challenge = 'A'.repeat(43);

function reply(value: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => value } as Awaited<ReturnType<typeof expoFetch>>;
}

describe('Android ENS passkey claim proof', () => {
  const ceremonyClient = {
    authenticatePrimaryPasskey: jest.fn().mockResolvedValue({
      ok: true,
      assertion: { authenticatorData: 'signed-authenticator', clientDataJSON: 'signed-client', signature: 'signed-der' },
    }),
  } as unknown as PasskeyCeremonyClient;
  const request = jest.fn() as jest.MockedFunction<typeof expoFetch>;

  beforeEach(() => {
    request.mockReset();
    jest.mocked(ceremonyClient.authenticatePrimaryPasskey).mockClear();
  });

  it('runs a server challenge through the native Primary Passkey and returns a scoped proof token', async () => {
    request
      .mockResolvedValueOnce(reply({ id, challenge, name: 'gargs.sodera.eth', chainId: 11155111, expiresAt: '2027-01-01T00:05:00Z' }, 201))
      .mockResolvedValueOnce(reply({ claimToken: 'B'.repeat(43), account, label: 'gargs', expiresAt: '2027-01-01T00:10:00Z' }));
    const result = await createEnsClaimAuthClient({ ceremonyClient, request, baseUrl: 'https://ens.example' })
      .prove({ account, credential, label: 'gargs' });
    expect(result).toMatchObject({ name: 'gargs.sodera.eth', claimToken: 'B'.repeat(43) });
    expect(ceremonyClient.authenticatePrimaryPasskey).toHaveBeenCalledWith({ challenge, credential });
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ account, label: 'gargs' });
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({
      account, label: 'gargs', proof: {
        authenticatorData: 'signed-authenticator', clientDataJSON: 'signed-client', signature: 'signed-der',
      },
    });
  });

  it('rejects a mismatched challenge before invoking the passkey provider', async () => {
    request.mockResolvedValueOnce(reply({ id, challenge, name: 'different.sodera.eth', chainId: 11155111, expiresAt: '2027-01-01T00:05:00Z' }));
    await expect(createEnsClaimAuthClient({ ceremonyClient, request, baseUrl: 'https://ens.example' })
      .prove({ account, credential, label: 'gargs' })).rejects.toThrow('invalid account challenge');
    expect(ceremonyClient.authenticatePrimaryPasskey).not.toHaveBeenCalled();
  });

  it('does not send an assertion after a canceled ceremony', async () => {
    request.mockResolvedValueOnce(reply({ id, challenge, name: 'gargs.sodera.eth', chainId: 11155111, expiresAt: '2027-01-01T00:05:00Z' }));
    jest.mocked(ceremonyClient.authenticatePrimaryPasskey).mockResolvedValueOnce({ ok: false, error: { kind: 'canceled' } });
    await expect(createEnsClaimAuthClient({ ceremonyClient, request, baseUrl: 'https://ens.example' })
      .prove({ account, credential, label: 'gargs' })).rejects.toThrow('not completed');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows only loopback HTTP in development and rejects cleartext remote endpoints', () => {
    expect(() => createEnsClaimAuthClient({ ceremonyClient, request, baseUrl: 'http://127.0.0.1:8082' })).not.toThrow();
    expect(() => createEnsClaimAuthClient({ ceremonyClient, request, baseUrl: 'http://192.168.1.50:8082' })).toThrow('HTTPS');
  });
});
