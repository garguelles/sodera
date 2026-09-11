import { useEffect, useRef, useState } from 'react';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sha256, toBytes, type Hash } from 'viem';

import {
  createKernelPasskeyExecutionClient,
  type KernelOperationEvidence,
  type KernelOperationReview,
  type KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import {
  createPasskeyCeremonyClient,
  PASSKEY_RP_ID,
  type RegisteredPrimaryPasskey,
} from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import {
  createWalletIdentityClient,
  type WalletIdentityResult,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

function waitForAppForeground(): Promise<boolean> {
  if (AppState.currentState === 'active') return Promise.resolve(true);

  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    let subscription: ReturnType<typeof AppState.addEventListener>;
    const finish = (isForeground: boolean) => {
      clearTimeout(timeout);
      subscription.remove();
      resolve(isForeground);
    };

    subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish(true);
    });
    timeout = setTimeout(() => finish(false), 1000);

    if (AppState.currentState === 'active') finish(true);
  });
}

export function PasskeyProofScreen({
  client = defaultCeremonyClient,
  createExecutionClient = createKernelPasskeyExecutionClient,
  storage = walletIdentityNativeStorage,
}: {
  client?: ReturnType<typeof createPasskeyCeremonyClient>;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  storage?: WalletIdentityStorage;
} = {}) {
  const [credential, setCredential] = useState<RegisteredPrimaryPasskey | null>(null);
  const [executionClient, setExecutionClient] = useState<KernelPasskeyExecutionClient | null>(null);
  const [review, setReview] = useState<KernelOperationReview | null>(null);
  const [confirmedHash, setConfirmedHash] = useState<Hash | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Create a new Wallet Identity or reopen the existing one.');
  const [executionState, setExecutionState] = useState<'idle' | 'pending' | 'confirmed' | 'failed'>(
    'idle',
  );
  const [showRecovery, setShowRecovery] = useState(false);
  const [evidence, setEvidence] = useState<KernelOperationEvidence | Record<string, unknown> | null>(
    null,
  );
  const invocation = useRef(0);
  const walletIdentityClient = createWalletIdentityClient({
    storage,
    ceremonyClient: client,
    async deriveAccount(primaryCredential) {
      const kernelClient = await createExecutionClient({
        ceremonyClient: client,
        credential: primaryCredential,
      });
      return {
        address: kernelClient.account,
        deployed: kernelClient.deployed,
        executionClient: kernelClient,
      };
    },
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setConfirmedHash(null);
    });
    return () => {
      invocation.current += 1;
      client.cancelPending();
      subscription.remove();
    };
  }, [client]);

  const register = async () => {
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setConfirmedHash(null);
    setReview(null);
    setExecutionClient(null);
    setExecutionState('idle');
    setShowRecovery(false);
    setStatus('Waiting for Credential Manager registration...');
    try {
      const result = await walletIdentityClient.create();
      if (currentInvocation !== invocation.current) return;
      if (!applyWalletIdentityResult(result)) {
        return;
      }
      setEvidence({
        walletIdentity: 'persisted',
        rpId: PASSKEY_RP_ID,
        account: result.account,
        deployed: result.deployed,
        credentialIdHash: sha256(toBytes(result.credential.id)),
        publicKeyX: result.credential.publicKeyX,
        publicKeyY: result.credential.publicKeyY,
        aaguid: result.credential.aaguid,
        origin: result.credential.origin,
        authenticatorAttachment: result.credential.authenticatorAttachment,
        privateKeyExported: false,
      });
      setStatus('Kernel account derived. Prepare the bounded Sepolia operation for review.');
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setExecutionState('failed');
        setStatus(describeExecutionError(error));
      }
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const reopen = async () => {
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setConfirmedHash(null);
    setReview(null);
    setExecutionClient(null);
    setExecutionState('idle');
    setShowRecovery(false);
    setStatus('Reopening the persisted Wallet Identity with the Primary Passkey...');
    try {
      const result = await walletIdentityClient.reopen();
      if (currentInvocation !== invocation.current || !applyWalletIdentityResult(result)) return;
      setEvidence({
        walletIdentity: 'reopened',
        account: result.account,
        deployed: result.deployed,
        credentialIdHash: sha256(toBytes(result.credential.id)),
        pinsVerified: true,
        samePrimaryCredentialVerified: true,
        credentialAvailabilitySource: 'provider-not-reported',
        independentRecoveryUsed: false,
      });
      setStatus('Existing Wallet Identity reopened. The account address and pinned metadata match.');
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setExecutionState('failed');
        setStatus(describeExecutionError(error));
      }
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const applyWalletIdentityResult = (
    result: WalletIdentityResult,
  ): result is Extract<WalletIdentityResult, { status: 'ready' }> => {
    if (result.status === 'blocked') {
      setExecutionState('failed');
      setShowRecovery(result.recoverWallet);
      setStatus(result.message);
      setEvidence({ walletIdentityError: result.reason, silentReplacementPrevented: true });
      return false;
    }
    setCredential(result.credential);
    setExecutionClient(result.executionClient ?? null);
    return true;
  };

  const prepare = async () => {
    if (!executionClient) return;
    const currentInvocation = ++invocation.current;
    setConfirmedHash(null);
    setReview(null);
    setBusy(true);
    setExecutionState('pending');
    setStatus('Preparing and sponsoring the complete UserOperation...');
    try {
      const nextReview = await executionClient.prepare();
      if (currentInvocation !== invocation.current) return;
      setReview(nextReview);
      setExecutionState('idle');
      setStatus('Operation prepared. Review every field before confirming.');
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setExecutionState('failed');
        setStatus(describeExecutionError(error));
      }
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const execute = async () => {
    if (!executionClient || !review || confirmedHash !== review.userOperationHash) return;
    const currentInvocation = ++invocation.current;
    const approvedHash = confirmedHash;
    setConfirmedHash(null);
    setBusy(true);
    setExecutionState('pending');
    setStatus('Pending user verification. No operation has been submitted yet.');
    try {
      const result = await executionClient.execute(approvedHash);
      if (currentInvocation !== invocation.current) return;
      let deploymentPersisted = true;
      try {
        await walletIdentityClient.markDeployed(result.account);
      } catch {
        deploymentPersisted = false;
      }
      if (currentInvocation !== invocation.current) return;
      setEvidence({
        ...result,
        capturedAt: new Date().toISOString(),
        rpId: PASSKEY_RP_ID,
        supportedDevice: {
          isPhysicalDevice: Device.isDevice,
          manufacturer: Device.manufacturer,
          modelName: Device.modelName,
          osName: Device.osName,
          osVersion: Device.osVersion,
          platformApiLevel: Device.platformApiLevel,
        },
        googleFreeGrapheneOsAccepted: false,
        deploymentPersisted,
      });
      setReview(null);
      setExecutionState('confirmed');
      setStatus(
        deploymentPersisted
          ? 'Confirmed: the UserOperation and independent Sepolia state checks succeeded.'
          : 'Confirmed on Sepolia, but the local deployment marker could not be persisted. Reopen the existing wallet before another operation.',
      );
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setExecutionState('failed');
        setStatus(describeExecutionError(error));
      }
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text style={styles.back}>Back to Home</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>PRA-188 WALLET CONTINUITY</Text>
          <Text style={styles.title}>Passkey-controlled Kernel</Text>
          <Text style={styles.body}>
            Create or reopen one persisted Wallet Identity, then authorize its exact UserOperation
            hash through Android Credential Manager.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.step}>1. Create or reopen</Text>
          <Text style={styles.body}>
            Creation persists public credential and exact Kernel metadata. Reopening verifies the
            same Primary Passkey, pinned configuration, and Smart Account address.
          </Text>
          <Text style={styles.warning}>
            Until an independent Recovery Passkey is enrolled, losing access to the Primary Passkey
            can permanently lose access to this wallet.
          </Text>
          <ActionButton disabled={busy} label="Create Wallet" onPress={register} />
          <ActionButton
            disabled={busy}
            label="Reopen existing wallet"
            onPress={reopen}
            secondary
          />
          {showRecovery ? (
            <ActionButton
              disabled={busy}
              label="Recover Wallet"
              onPress={() => {
                setStatus(
                  'Recover Wallet preserves this address through an independent Recovery Passkey. Recovery implementation is handled by PRA-180.',
                );
              }}
              secondary
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.step}>2. Prepare</Text>
          <Text style={styles.body}>
            Obtains final nonce, call, gas, fee, deployment, and paymaster fields before any
            passkey prompt appears.
          </Text>
          <ActionButton
            disabled={busy || !credential || !executionClient}
            label="Prepare Sepolia operation"
            onPress={prepare}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.step}>3. Review and confirm</Text>
          {review ? (
            <OperationReview review={review} />
          ) : (
            <Text style={styles.body}>Prepare an operation first.</Text>
          )}
          <ActionButton
            disabled={busy || !review}
            label={confirmedHash ? 'Exact operation confirmed' : 'Confirm exact operation'}
            onPress={() => {
              if (review) setConfirmedHash(review.userOperationHash);
            }}
            secondary
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.step}>4. Verify and execute</Text>
          <Text style={styles.body}>
            Credential Manager requests the registered passkey with user verification. Submission
            occurs only if its locally validated assertion matches the confirmed hash.
          </Text>
          <ActionButton
            disabled={busy || !review || confirmedHash !== review.userOperationHash}
            label="Authorize and submit"
            onPress={execute}
          />
        </View>

        <View accessibilityRole="alert" style={[styles.status, styles[executionState]]}>
          <Text style={styles.statusLabel}>STATUS</Text>
          <Text selectable style={styles.body}>
            {status}
          </Text>
        </View>

        {evidence ? (
          <View style={styles.evidence}>
            <Text style={styles.statusLabel}>PUBLIC EXECUTION EVIDENCE</Text>
            <Text selectable style={styles.mono}>
              {JSON.stringify(evidence, null, 2)}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function OperationReview({ review }: { review: KernelOperationReview }) {
  return (
    <View style={styles.review}>
      <ReviewRow label="Account" value={review.account} />
      <ReviewRow label="Chain" value={`${review.chain} (${review.chainId})`} />
      <ReviewRow label="EntryPoint" value={review.entryPoint} />
      <ReviewRow label="Validator" value={review.validator} />
      <ReviewRow label="Deploy account" value={review.deploymentRequired ? 'Yes' : 'No'} />
      <ReviewRow label="Recipient" value={review.calls[0].to} />
      <ReviewRow label="Value" value="0 wei" />
      <ReviewRow label="Call data" value={review.calls[0].data} />
      <ReviewRow label="Sponsored" value={review.sponsored ? 'Yes' : 'No'} />
      <ReviewRow label="Paymaster" value={review.paymaster ?? 'None'} />
      <ReviewRow label="Maximum network fee" value={`${review.maximumNetworkFeeWei} wei`} />
      <ReviewRow label="UserOperation hash" value={review.userOperationHash} />
      <Text selectable style={styles.mono}>
        {JSON.stringify(review.userOperation, null, 2)}
      </Text>
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text selectable style={styles.reviewValue}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({
  disabled,
  label,
  onPress,
  secondary = false,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void | Promise<void>;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

function describeExecutionError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Kernel execution failed';
  return message.replace(/https?:\/\/\S+/g, '[redacted RPC URL]');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  back: { color: '#8cc8ff', fontSize: 15, fontWeight: '600', paddingVertical: 8 },
  heading: { gap: 8, paddingVertical: 12 },
  eyebrow: { color: '#929188', fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: '#f3f0e8', fontSize: 32, fontWeight: '700', letterSpacing: -1.2 },
  body: { color: '#c8c5bb', fontSize: 15, lineHeight: 22 },
  warning: { color: '#f2c879', fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: '#262620', borderRadius: 16, padding: 18, gap: 12 },
  step: { color: '#f3f0e8', fontSize: 19, fontWeight: '700' },
  button: {
    backgroundColor: '#f3f0e8',
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButton: { backgroundColor: '#34342d', borderWidth: 1, borderColor: '#5b5a50' },
  buttonText: { color: '#171713', fontSize: 15, fontWeight: '700' },
  secondaryButtonText: { color: '#f3f0e8' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  status: { backgroundColor: '#1d3448', borderRadius: 14, padding: 16, gap: 6 },
  idle: {},
  pending: { backgroundColor: '#483b1d' },
  confirmed: { backgroundColor: '#1d4830' },
  failed: { backgroundColor: '#481d25' },
  statusLabel: { color: '#8cc8ff', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  evidence: { backgroundColor: '#10100d', borderRadius: 14, padding: 16, gap: 10 },
  mono: { color: '#d8d4c8', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  review: { gap: 10 },
  reviewRow: { gap: 3 },
  reviewLabel: { color: '#929188', fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  reviewValue: { color: '#f3f0e8', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
