import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sha256, toBytes } from 'viem';

import {
  createPasskeyCeremonyClient,
  type RegisteredPrimaryPasskey,
} from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import { passkeyProofUserOperation } from '@/wallet/passkey-proof-operation';
import { createPasskeyChallenge } from '@/wallet/kernel-webauthn';

const client = createPasskeyCeremonyClient(passkeyNativeAdapter);
const proofOperation = createPasskeyChallenge(passkeyProofUserOperation);

export function PasskeyProofScreen() {
  const [credential, setCredential] = useState<RegisteredPrimaryPasskey | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready to register a Primary Passkey.');
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const invocation = useRef(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setConfirmed(false);
    });
    return () => {
      invocation.current += 1;
      client.cancelPending();
      subscription.remove();
    };
  }, []);

  const register = async () => {
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setConfirmed(false);
    setStatus('Waiting for Credential Manager registration...');
    let result;
    try {
      result = await client.registerPrimaryPasskey({
        userName: 'sodera-device-proof',
        userDisplayName: 'Sodera Device Proof',
      });
    } catch {
      if (currentInvocation === invocation.current) {
        setStatus('unknown / Credential Manager request failed unexpectedly');
      }
      return;
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
    if (currentInvocation !== invocation.current) return;

    if (!result.ok) {
      setStatus(describeError(result.error));
      return;
    }

    setCredential(result.credential);
    setStatus('Primary Passkey registered. Confirm the proof operation before authenticating.');
    setEvidence({
      ceremony: 'registration',
      rpId: 'sodera.xyz',
      credentialIdHash: sha256(toBytes(result.credential.id)),
      publicKeyX: result.credential.publicKeyX,
      publicKeyY: result.credential.publicKeyY,
      aaguid: result.credential.aaguid,
      origin: result.credential.origin,
      authenticatorAttachment: result.credential.authenticatorAttachment,
      privateKeyExported: false,
    });
  };

  const authenticate = async () => {
    if (!credential || !confirmed) return;
    const currentInvocation = ++invocation.current;
    setConfirmed(false);
    setBusy(true);
    setStatus('Waiting for Credential Manager user verification...');
    let result;
    try {
      result = await client.authenticatePrimaryPasskey({
        challenge: proofOperation.challenge,
        credential,
      });
    } catch {
      if (currentInvocation === invocation.current) {
        setStatus('unknown / Credential Manager request failed unexpectedly');
      }
      return;
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
    if (currentInvocation !== invocation.current) return;

    if (!result.ok) {
      setStatus(describeError(result.error));
      return;
    }

    setStatus('Assertion signature validated locally and encoded for the released ZeroDev validator.');
    setEvidence({
      ceremony: 'authentication',
      rpId: 'sodera.xyz',
      userOperationHash: proofOperation.userOperationHash,
      credentialIdHash: sha256(toBytes(result.assertion.credentialId)),
      origin: result.assertion.origin,
      userPresent: result.assertion.userPresent,
      userVerified: result.assertion.userVerified,
      signCount: result.assertion.signCount,
      authenticatorData: result.assertion.authenticatorData,
      clientDataJSON: result.assertion.clientDataJSON,
      signature: result.assertion.signature,
      validatorEnvelope: result.assertion.validatorEnvelope,
      privateKeyExported: false,
    });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text style={styles.back}>Back to Home</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>PRA-185 DEVICE PROOF</Text>
          <Text style={styles.title}>Native passkey ceremony</Text>
          <Text style={styles.body}>
            Credential Manager owns key generation and signing. Sodera receives only public
            registration data and signed WebAuthn responses.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.step}>1. Register</Text>
          <Text style={styles.body}>
            Creates an ES256 resident credential for sodera.xyz with user verification required.
          </Text>
          <ActionButton disabled={busy} label="Register Primary Passkey" onPress={register} />
        </View>

        <View style={styles.card}>
          <Text style={styles.step}>2. Review and confirm</Text>
          <Text style={styles.mono}>Operation hash: {proofOperation.userOperationHash}</Text>
          <Text style={styles.body}>
            Synthetic proof only. This does not submit a transaction or move assets.
          </Text>
          <ActionButton
            disabled={busy || !credential}
            label={confirmed ? 'Operation confirmed' : 'Confirm proof operation'}
            onPress={() => setConfirmed(true)}
            secondary
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.step}>3. Authenticate</Text>
          <Text style={styles.body}>
            Requests only the registered credential and requires user presence and verification.
          </Text>
          <ActionButton
            disabled={busy || !credential || !confirmed}
            label="Authenticate confirmed operation"
            onPress={authenticate}
          />
        </View>

        <View accessibilityRole="alert" style={styles.status}>
          <Text style={styles.statusLabel}>STATUS</Text>
          <Text style={styles.body}>{status}</Text>
        </View>

        {evidence ? (
          <View style={styles.evidence}>
            <Text style={styles.statusLabel}>PUBLIC CEREMONY EVIDENCE</Text>
            <Text selectable style={styles.mono}>
              {JSON.stringify(evidence, null, 2)}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
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

function describeError(error: { kind: string; type?: string; domError?: string; message?: string }) {
  return [error.kind, error.domError, error.type, error.message].filter(Boolean).join(' / ');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  back: { color: '#8cc8ff', fontSize: 15, fontWeight: '600', paddingVertical: 8 },
  heading: { gap: 8, paddingVertical: 12 },
  eyebrow: { color: '#929188', fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: '#f3f0e8', fontSize: 32, fontWeight: '700', letterSpacing: -1.2 },
  body: { color: '#c8c5bb', fontSize: 15, lineHeight: 22 },
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
  statusLabel: { color: '#8cc8ff', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  evidence: { backgroundColor: '#10100d', borderRadius: 14, padding: 16, gap: 10 },
  mono: { color: '#d8d4c8', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
