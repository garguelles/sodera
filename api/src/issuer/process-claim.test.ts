import { describe, expect, it, vi } from 'vitest';
import { keccak256, stringToHex, zeroAddress } from 'viem';

import type { ClaimRecord } from '../ens/claim-store.ts';
import { ENSV2 } from '../ens/contracts.ts';
import type { IssuerChain } from './chain.ts';
import type { LeasedClaim, WorkQueue } from './postgres-work-queue.ts';
import { processClaim } from './process-claim.ts';

const resolver = '0x3333333333333333333333333333333333333333';
const tx = `0x${'ab'.repeat(32)}` as const;
const expiry = new Date('2027-09-27T00:00:00Z');

function claim(status: ClaimRecord['status'] = 'queued'): ClaimRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    chainId: 11155111,
    registry: '0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7',
    label: 'gargs', name: 'gargs.sodera.eth', labelhash: keccak256(stringToHex('gargs')),
    account: '0x1111111111111111111111111111111111111111',
    status, resolver: null, resolverTx: null, registrationTx: null,
    expiresAt: null, errorCode: null,
  };
}

function queue(record: ClaimRecord) {
  const checkpoint = vi.fn(async (_lease, expected, next) => {
    expect(record.status).toBe(expected);
    record = { ...record, ...next };
    return record;
  });
  const retry = vi.fn(async () => {});
  const proof = vi.fn(async () => ({ challenge: 'A'.repeat(43), assertion: {
    authenticatorData: 'auth', clientDataJSON: 'client', signature: 'signature',
  } }));
  return { get current() { return record; }, checkpoint, retry, proof } as unknown as WorkQueue & { current: ClaimRecord };
}

function chain() {
  let registered = false;
  let resolverExists = false;
  const methods = {
    verifyClaimProof: vi.fn(async () => {}),
    namespace: vi.fn(async () => ({ parentExpiry: 1_900_000_000n, issuerRoles: 1n,
      name: { status: registered ? 2 : 0, latestOwner: '0x1111111111111111111111111111111111111111' },
      resolver: registered ? resolver : zeroAddress })),
    resolver: vi.fn(async () => ({ resolver, data: '0x01' })),
    resolverReady: vi.fn(async () => resolverExists),
    pendingNonce: vi.fn(async () => false),
    receipt: vi.fn(async () => 'pending' as 'pending' | 'success' | 'reverted'),
    deployResolver: vi.fn(async () => tx),
    register: vi.fn(async () => tx),
    confirmed: vi.fn(async () => registered ? expiry : null),
    setResolverExists(value: boolean) { resolverExists = value; },
    setRegistered(value: boolean) { registered = value; },
  };
  return methods as unknown as IssuerChain & typeof methods;
}

function lease(record: ClaimRecord): LeasedClaim {
  return { claim: record, leaseId: '22222222-2222-4222-8222-222222222222' };
}

describe('crash-safe ENS issuer', () => {
  it('persists each transaction hash, waits for chain state, and confirms only on owner/resolver verification', async () => {
    const work = queue(claim());
    const client = chain();
    await processClaim(lease(work.current), work, client);
    expect(work.current).toMatchObject({ status: 'resolver_submitted', resolver, resolverTx: tx });
    expect(client.deployResolver).toHaveBeenCalledOnce();

    await processClaim(lease(work.current), work, client);
    expect(work.retry).toHaveBeenCalledWith(expect.anything(), 'resolver_pending');
    expect(client.deployResolver).toHaveBeenCalledOnce();

    client.setResolverExists(true);
    await processClaim(lease(work.current), work, client);
    expect(work.current.status).toBe('resolver_ready');
    await processClaim(lease(work.current), work, client);
    expect(work.current).toMatchObject({ status: 'registration_submitted', registrationTx: tx });
    expect(client.register).toHaveBeenCalledOnce();

    client.setRegistered(true);
    await processClaim(lease(work.current), work, client);
    expect(work.current).toMatchObject({ status: 'confirmed', expiresAt: expiry });
  });

  it('recovers an already deployed resolver after a lost submission response without redeploying', async () => {
    const work = queue(claim());
    const client = chain();
    client.setResolverExists(true);
    await processClaim(lease(work.current), work, client);
    expect(work.current.status).toBe('resolver_ready');
    expect(client.deployResolver).not.toHaveBeenCalled();
  });

  it('stops rather than treating another owner’s name as a successful claim', async () => {
    const work = queue(claim('registration_submitted'));
    const client = chain();
    client.setRegistered(true);
    client.confirmed.mockRejectedValueOnce(new Error('Different owner'));
    await processClaim(lease(work.current), work, client);
    expect(work.current).toMatchObject({ status: 'needs_attention', errorCode: 'registered_state_mismatch' });
    expect(client.register).not.toHaveBeenCalled();
  });

  it('never submits a public synthetic test wallet to the issuer', async () => {
    const work = queue({ ...claim(), account: ENSV2.publicTestKernel });
    const client = chain();
    await processClaim(lease(work.current), work, client);
    expect(work.current).toMatchObject({ status: 'needs_attention', errorCode: 'public_test_wallet' });
    expect(client.namespace).not.toHaveBeenCalled();
    expect(client.deployResolver).not.toHaveBeenCalled();
  });

  it('rejects a reserved label even if a database row claims it was verified', async () => {
    const work = queue({ ...claim(), label: 'admin', name: 'admin.sodera.eth',
      labelhash: keccak256(stringToHex('admin')) });
    const client = chain();
    await processClaim(lease(work.current), work, client);
    expect(work.current).toMatchObject({ status: 'needs_attention', errorCode: 'invalid_or_reserved_label' });
    expect(client.namespace).not.toHaveBeenCalled();
  });

  it('limits the first issuer deployment to the specifically approved Kernel', async () => {
    const work = queue(claim());
    const client = chain();
    await processClaim(lease(work.current), work, client,
      '0x4444444444444444444444444444444444444444');
    expect(work.current).toMatchObject({ status: 'needs_attention',
      errorCode: 'wallet_not_approved_for_controlled_issuance' });
    expect(client.deployResolver).not.toHaveBeenCalled();
  });

  it('submits no transaction without registrar authority but can reconcile a name after revocation', async () => {
    const work = queue(claim());
    const client = chain();
    client.namespace.mockResolvedValueOnce({ parentExpiry: 1_900_000_000n, issuerRoles: 0n,
      name: { status: 0, latestOwner: work.current.account }, resolver: zeroAddress });
    await processClaim(lease(work.current), work, client);
    expect(work.retry).toHaveBeenCalledWith(expect.anything(), 'issuer_not_authorized');
    expect(client.deployResolver).not.toHaveBeenCalled();

    client.setRegistered(true);
    client.setResolverExists(true);
    client.namespace.mockResolvedValueOnce({ parentExpiry: 1_900_000_000n, issuerRoles: 0n,
      name: { status: 2, latestOwner: work.current.account }, resolver });
    await processClaim(lease(work.current), work, client);
    expect(work.current.status).toBe('confirmed');
  });

  it('rejects a malformed signed proof before any on-chain action', async () => {
    const work = queue(claim());
    const client = chain();
    client.verifyClaimProof.mockRejectedValueOnce(new Error('Invalid passkey signature'));
    await processClaim(lease(work.current), work, client);
    expect(work.current).toMatchObject({ status: 'needs_attention', errorCode: 'proof_invalid' });
    expect(client.namespace).not.toHaveBeenCalled();
    expect(client.deployResolver).not.toHaveBeenCalled();
  });
});
