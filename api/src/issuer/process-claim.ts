import { keccak256, stringToHex, type Address } from 'viem';

import type { ClaimStatus } from '../ens/claim-store.ts';
import { ENSV2 } from '../ens/contracts.ts';
import { parseUsername } from '../ens/username.ts';
import type { IssuerChain } from './chain.ts';
import type { ClaimCheckpoint, LeasedClaim, WorkQueue } from './postgres-work-queue.ts';

export async function processClaim(
  lease: LeasedClaim,
  queue: Pick<WorkQueue, 'proof' | 'checkpoint' | 'retry'>,
  chain: Pick<IssuerChain, 'verifyClaimProof' | 'namespace' | 'resolver' | 'resolverReady' | 'pendingNonce' | 'receipt' | 'deployResolver' | 'register' | 'confirmed'>,
  allowedAccount?: Address,
) {
  const { claim } = lease;
  const advance = (expected: ClaimStatus, next: ClaimCheckpoint) => queue.checkpoint(lease, expected, next);
  try {
    if (claim.account.toLowerCase() === ENSV2.publicTestKernel.toLowerCase()) {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'public_test_wallet' });
      return;
    }
    if (allowedAccount && claim.account.toLowerCase() !== allowedAccount.toLowerCase()) {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'wallet_not_approved_for_controlled_issuance' });
      return;
    }
    let canonical;
    try {
      canonical = parseUsername(claim.label);
    } catch {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'invalid_or_reserved_label' });
      return;
    }
    if (canonical.reserved || canonical.name !== claim.name) {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'invalid_or_reserved_label' });
      return;
    }
    if (claim.labelhash.toLowerCase() !== keccak256(stringToHex(claim.label)).toLowerCase()) {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'claim_identity_mismatch' });
      return;
    }
    const proof = await queue.proof(claim);
    if (!proof) {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'proof_missing' });
      return;
    }
    try {
      await chain.verifyClaimProof(claim, proof);
    } catch (error) {
      if (error instanceof Error && /Invalid passkey|Passkey ceremony|Malformed passkey/.test(error.message)) {
        await advance(claim.status, { status: 'needs_attention', errorCode: 'proof_invalid' });
        return;
      }
      throw error;
    }
    const namespace = await chain.namespace(claim);
    const deployment = await chain.resolver(claim);
    if (claim.resolver && claim.resolver.toLowerCase() !== deployment.resolver.toLowerCase()) {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'resolver_address_changed' });
      return;
    }
    const resolver = deployment.resolver as Address;
    if (namespace.name.status === 2) {
      try {
        const expiresAt = await chain.confirmed(claim, resolver);
        if (!expiresAt || !(await chain.resolverReady(claim, resolver))) {
          throw new Error('Claimed name has an incomplete resolver');
        }
        await advance(claim.status, { status: 'confirmed', resolver, expiresAt });
      } catch {
        await advance(claim.status, { status: 'needs_attention', errorCode: 'registered_state_mismatch' });
      }
      return;
    }
    if (namespace.name.status !== 0) {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'name_unavailable' });
      return;
    }
    if (namespace.issuerRoles !== 1n) {
      await queue.retry(lease, 'issuer_not_authorized');
      return;
    }

    let ready: boolean;
    try {
      ready = await chain.resolverReady(claim, resolver);
    } catch {
      await advance(claim.status, { status: 'needs_attention', errorCode: 'resolver_authority_mismatch' });
      return;
    }
    if (!ready) {
      if (claim.status === 'registration_submitted' || claim.status === 'resolver_ready') {
        await advance(claim.status, { status: 'needs_attention', errorCode: 'resolver_disappeared' });
        return;
      }
      if (claim.resolverTx) {
        const receipt = await chain.receipt(claim.resolverTx);
        if (receipt === 'pending') {
          await queue.retry(lease, 'resolver_pending');
          return;
        }
        if (receipt !== 'success') {
          await advance(claim.status, { status: 'needs_attention', errorCode: 'resolver_tx_failed' });
          return;
        }
        await advance(claim.status, { status: 'needs_attention', errorCode: 'resolver_tx_missing_state' });
        return;
      }
      if (await chain.pendingNonce()) {
        await queue.retry(lease, 'issuer_nonce_pending');
        return;
      }
      const hash = await chain.deployResolver(deployment.data);
      await advance(claim.status, { status: 'resolver_submitted', resolver, resolverTx: hash });
      return;
    }
    if (claim.status === 'queued' || claim.status === 'resolver_submitted') {
      await advance(claim.status, { status: 'resolver_ready', resolver });
      return;
    }
    if (claim.status === 'registration_submitted') {
      if (!claim.registrationTx) {
        await advance(claim.status, { status: 'needs_attention', errorCode: 'registration_hash_missing' });
        return;
      }
      const receipt = await chain.receipt(claim.registrationTx);
      if (receipt === 'pending') {
        await queue.retry(lease, 'registration_pending');
        return;
      }
      await advance(claim.status, { status: 'needs_attention', errorCode: receipt === 'success'
        ? 'registration_tx_missing_state' : 'registration_tx_failed' });
      return;
    }
    if (claim.status !== 'resolver_ready') throw new Error('Unexpected claim status');
    if (await chain.pendingNonce()) {
      await queue.retry(lease, 'issuer_nonce_pending');
      return;
    }
    const hash = await chain.register(claim, resolver, namespace.parentExpiry);
    await advance(claim.status, { status: 'registration_submitted', resolver, registrationTx: hash });
  } catch {
    await queue.retry(lease, 'issuer_or_chain_unavailable');
  }
}
