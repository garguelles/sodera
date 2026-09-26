import { fetch as expoFetch } from 'expo/fetch';
import type { Address } from 'viem';

import { createEnsClaimAuthClient, readSoderaApiUrl } from './claim-auth-client';
import { parseSoderaUsername } from './username';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';

type ClaimStatus = 'queued' | 'resolver_submitted' | 'resolver_ready' |
  'registration_submitted' | 'confirmed' | 'needs_attention' | 'detached';

function parseClaim(value: unknown, account: Address, name: string) {
  const data = value as { id?: unknown; chainId?: unknown; account?: unknown; name?: unknown;
    status?: unknown; resolverTx?: unknown; registrationTx?: unknown; expiresAt?: unknown };
  if (!data || typeof data.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id) ||
    data.chainId !== 11155111 || typeof data.account !== 'string' ||
    data.account.toLowerCase() !== account.toLowerCase() || data.name !== name ||
    !(['queued', 'resolver_submitted', 'resolver_ready', 'registration_submitted', 'confirmed',
      'needs_attention', 'detached'] as unknown[]).includes(data.status)) {
    throw new Error('ENS service returned a mismatched claim');
  }
  return { id: data.id, name, status: data.status as ClaimStatus,
    resolverTx: typeof data.resolverTx === 'string' ? data.resolverTx : null,
    registrationTx: typeof data.registrationTx === 'string' ? data.registrationTx : null,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null };
}

export function createEnsClaimClient({
  ceremonyClient,
  request = expoFetch,
  baseUrl,
}: {
  ceremonyClient: PasskeyCeremonyClient;
  request?: typeof expoFetch;
  baseUrl?: string;
}) {
  const url = readSoderaApiUrl(baseUrl);
  const authClient = createEnsClaimAuthClient({ ceremonyClient, request, baseUrl });

  return {
    async submit({ account, credential, label }: {
      account: Address; credential: RegisteredPrimaryPasskey; label: string;
    }) {
      const username = parseSoderaUsername(label);
      const proof = await authClient.prove({ account, credential, label: username.label });
      const response = await request(`${url}/ens/claims`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account, label: username.label, claimToken: proof.claimToken }),
      });
      if (!response.ok) throw new Error(`ENS claim request failed (${response.status})`);
      return parseClaim(await response.json(), account, username.name);
    },
    async status({ id, account, label }: { id: string; account: Address; label: string }) {
      const username = parseSoderaUsername(label);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('Invalid ENS claim ID');
      }
      const response = await request(`${url}/ens/claims/${id}`);
      if (!response.ok) throw new Error(`ENS claim status unavailable (${response.status})`);
      return parseClaim(await response.json(), account, username.name);
    },
  };
}
