import { fetch as expoFetch } from 'expo/fetch';
import type { Address } from 'viem';

import { parseSoderaUsername } from './username';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';

type ApiRequest = typeof expoFetch;

export function createEnsClaimAuthClient({
  ceremonyClient,
  request = expoFetch,
  baseUrl = process.env.EXPO_PUBLIC_API_URL,
}: {
  ceremonyClient: PasskeyCeremonyClient;
  request?: ApiRequest;
  baseUrl?: string;
}) {
  if (!baseUrl) throw new Error('EXPO_PUBLIC_API_URL must be a configured HTTPS endpoint');
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a configured HTTPS endpoint');
  }
  const localDebug = __DEV__ && endpoint.protocol === 'http:' &&
    (endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost');
  if ((endpoint.protocol !== 'https:' && !localDebug) || endpoint.username || endpoint.password) {
    throw new Error('EXPO_PUBLIC_API_URL must use HTTPS (or loopback HTTP in development)');
  }
  const url = baseUrl.replace(/\/+$/, '');

  return {
    async prove({ account, credential, label }: {
      account: Address;
      credential: RegisteredPrimaryPasskey;
      label: string;
    }) {
      const name = parseSoderaUsername(label);
      const issued = await request(`${url}/ens/challenges`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account, label: name.label }),
      });
      if (!issued.ok) throw new Error(`ENS challenge request failed (${issued.status})`);
      const challenge = await issued.json() as {
        id?: unknown; challenge?: unknown; name?: unknown; chainId?: unknown; expiresAt?: unknown;
      };
      if (typeof challenge.id !== 'string' || typeof challenge.challenge !== 'string' ||
        typeof challenge.expiresAt !== 'string' || challenge.name !== name.name ||
        challenge.chainId !== 11155111 || !/^[A-Za-z0-9_-]{43}$/.test(challenge.challenge) ||
        !Number.isFinite(Date.parse(challenge.expiresAt))) {
        throw new Error('ENS service returned an invalid account challenge');
      }
      const result = await ceremonyClient.authenticatePrimaryPasskey({
        challenge: challenge.challenge,
        credential,
      });
      if (!result.ok) throw new Error('Primary Passkey authorization was not completed');
      const verified = await request(`${url}/ens/challenges/${encodeURIComponent(challenge.id)}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account,
          label: name.label,
          proof: {
            authenticatorData: result.assertion.authenticatorData,
            clientDataJSON: result.assertion.clientDataJSON,
            signature: result.assertion.signature,
          },
        }),
      });
      if (!verified.ok) throw new Error(`ENS passkey verification failed (${verified.status})`);
      const proof = await verified.json() as {
        claimToken?: unknown; account?: unknown; label?: unknown; expiresAt?: unknown;
      };
      if (typeof proof.claimToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof.claimToken) ||
        typeof proof.account !== 'string' || proof.account.toLowerCase() !== account.toLowerCase() ||
        proof.label !== name.label || typeof proof.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(proof.expiresAt))) {
        throw new Error('ENS service returned an invalid proof receipt');
      }
      return { name: name.name, claimToken: proof.claimToken, expiresAt: proof.expiresAt };
    },
  };
}
