import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Address } from 'viem';

import {
  mockUsernameClaimClient,
  persistCompletedOnboarding,
  readOnboardingProfile,
  SODERA_FIXTURE_USERNAME,
  type OnboardingProfile,
  type OnboardingProfileStorage,
  type UsernameClaimClient,
} from '@/onboarding/onboarding';
import { onboardingNativeStorage } from '@/onboarding/onboarding-native-storage';
import { createKernelPasskeyExecutionClient } from '@/wallet/kernel-passkey-execution';
import { createPasskeyCeremonyClient } from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import {
  createWalletIdentityClient,
  inspectPersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';
import { waitForAppForeground } from '@/wallet/wait-for-app-foreground';

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

type Stage = 'loading' | 'welcome' | 'wallet' | 'username' | 'ready' | 'recovery' | 'blocked';

export function OnboardingScreen({
  client = defaultCeremonyClient,
  createExecutionClient = createKernelPasskeyExecutionClient,
  identityStorage = walletIdentityNativeStorage,
  profileStorage = onboardingNativeStorage,
  usernameClaimClient = mockUsernameClaimClient,
  onComplete,
  onRetry,
  initialError,
}: {
  client?: ReturnType<typeof createPasskeyCeremonyClient>;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  identityStorage?: WalletIdentityStorage;
  profileStorage?: OnboardingProfileStorage;
  usernameClaimClient?: UsernameClaimClient;
  onComplete(profile: OnboardingProfile): void;
  onRetry?: () => void;
  initialError?: string;
}) {
  const [stage, setStage] = useState<Stage>(initialError ? 'blocked' : 'loading');
  const [account, setAccount] = useState<Address | null>(null);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [resumeWallet, setResumeWallet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError ?? '');
  const invocation = useRef(0);
  const operationInFlight = useRef(false);

  const walletIdentityClient = createWalletIdentityClient({
    storage: identityStorage,
    ceremonyClient: client,
    async deriveAccount(primaryCredential) {
      const executionClient = await createExecutionClient({
        ceremonyClient: client,
        credential: primaryCredential,
      });
      return {
        address: executionClient.account,
        deployed: executionClient.deployed,
        executionClient,
      };
    },
  });

  useEffect(() => {
    if (initialError) return;
    let active = true;
    const bootstrap = async () => {
      try {
        const [identityState, existingProfile] = await Promise.all([
          inspectPersistedWalletIdentity(identityStorage),
          readOnboardingProfile(profileStorage),
        ]);
        if (!active) return;
        if (identityState.status === 'missing') {
          if (existingProfile) {
            setMessage('An onboarding profile exists without its Wallet Identity');
            setStage('blocked');
            return;
          }
          setStage('welcome');
          return;
        }
        if (identityState.status === 'blocked') {
          setMessage(identityState.message);
          setStage('blocked');
          return;
        }
        if (identityState.status === 'incomplete') {
          if (existingProfile) {
            setMessage('An onboarding profile exists without its complete Wallet Identity');
            setStage('blocked');
            return;
          }
          setResumeWallet(true);
          setStage('wallet');
          return;
        }

        if (existingProfile) {
          if (existingProfile.account.toLowerCase() !== identityState.identity.account.toLowerCase()) {
            setMessage('The onboarding profile belongs to a different Smart Account');
            setStage('blocked');
            return;
          }
          setProfile(existingProfile);
          setAccount(identityState.identity.account);
          setStage('ready');
          return;
        }
        setResumeWallet(true);
        setStage('wallet');
      } catch (error) {
        if (!active) return;
        setMessage(getErrorMessage(error));
        setStage('blocked');
      }
    };
    void bootstrap();
    return () => {
      active = false;
      invocation.current += 1;
      client.cancelPending();
    };
  }, [client, identityStorage, initialError, profileStorage]);

  useEffect(() => {
    if (stage !== 'recovery' && (stage !== 'wallet' || resumeWallet)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setStage('welcome');
      return true;
    });
    return () => subscription.remove();
  }, [resumeWallet, stage]);

  const createOrResumeWallet = async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setMessage('');
    try {
      const result = resumeWallet
        ? await walletIdentityClient.reopen()
        : await walletIdentityClient.create();
      if (currentInvocation !== invocation.current) return;
      if (result.status === 'blocked') {
        setMessage(result.message);
        const identityState = await inspectPersistedWalletIdentity(identityStorage);
        if (currentInvocation === invocation.current) {
          setResumeWallet(identityState.status !== 'missing');
        }
        return;
      }
      setAccount(result.account);
      setStage('username');
    } catch (error) {
      if (currentInvocation === invocation.current) setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const claimUsername = async () => {
    if (!account || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setMessage('');
    try {
      await usernameClaimClient.claim({ account, username: SODERA_FIXTURE_USERNAME });
      if (currentInvocation !== invocation.current) return;
      const completedProfile = await persistCompletedOnboarding({
        storage: profileStorage,
        account,
      });
      if (currentInvocation !== invocation.current) return;
      setProfile(completedProfile);
      setStage('ready');
    } catch (error) {
      if (currentInvocation === invocation.current) setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <View style={styles.mark}>
            <View style={styles.markCore} />
          </View>
          <Text style={styles.wordmark}>SODERA</Text>
          {stage !== 'loading' && stage !== 'blocked' && stage !== 'recovery' ? (
            <Text style={styles.progress}>{progressLabel(stage)}</Text>
          ) : null}
        </View>

        <View style={styles.body}>
          {stage === 'loading' ? (
            <View style={styles.centered}>
              <ActivityIndicator color="#d4f06a" />
              <Text style={styles.muted}>Checking this installation...</Text>
            </View>
          ) : null}

          {stage === 'welcome' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>WALLET MEETS HOME</Text>
                <Text style={styles.title}>Your wallet, right at home.</Text>
                <Text style={styles.description}>
                  Create a passkey-controlled Sepolia wallet, then make it yours with a Sodera name.
                </Text>
              </View>
              <View style={styles.actions}>
                <ActionButton label="Create wallet" onPress={() => setStage('wallet')} />
                <ActionButton
                  label="Recover wallet"
                  onPress={() => setStage('recovery')}
                  secondary
                />
              </View>
            </>
          ) : null}

          {stage === 'wallet' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>YOUR PRIMARY PASSKEY</Text>
                <Text style={styles.title}>{resumeWallet ? 'Finish your wallet.' : 'Create your wallet.'}</Text>
                <Text style={styles.description}>
                  Android will ask you to create a passkey. It directly controls your testnet smart account.
                </Text>
              </View>
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>No password. No seed phrase.</Text>
                <Text style={styles.detailBody}>
                  This testnet wallet is tied to your passkey. Recovery is not available in this build.
                </Text>
              </View>
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton
                  busy={busy}
                  disabled={busy}
                  label={resumeWallet ? 'Continue wallet setup' : 'Create with passkey'}
                  onPress={createOrResumeWallet}
                />
                {!resumeWallet ? (
                  <ActionButton label="Back" onPress={() => setStage('welcome')} secondary />
                ) : null}
              </View>
            </>
          ) : null}

          {stage === 'username' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>YOUR SODERA NAME</Text>
                <Text style={styles.title}>Claim your place.</Text>
                <Text style={styles.description}>
                  Your name is how Sodera identifies this wallet throughout the launcher.
                </Text>
              </View>
              <View style={styles.nameCard}>
                <Text style={styles.name}>{SODERA_FIXTURE_USERNAME}</Text>
                <View style={styles.availablePill}>
                  <View style={styles.availableDot} />
                  <Text style={styles.availableText}>Reserved for this demo</Text>
                </View>
              </View>
              <Text style={styles.disclaimer}>
                Demo claim only. No ENS transaction is submitted and this name does not resolve onchain.
              </Text>
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton
                  busy={busy}
                  disabled={busy}
                  label="Claim anon.sodera.eth"
                  onPress={claimUsername}
                />
              </View>
            </>
          ) : null}

          {stage === 'ready' && account && profile ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>SETUP COMPLETE</Text>
                <Text style={styles.title}>{"You're ready."}</Text>
                <Text style={styles.description}>
                  Your wallet and demo identity are ready in the Sodera launcher.
                </Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>SODERA NAME</Text>
                <Text selectable style={styles.summaryValue}>
                  {profile.username}
                </Text>
                <View style={styles.divider} />
                <Text style={styles.summaryLabel}>WALLET ADDRESS</Text>
                <Text selectable style={styles.address}>
                  {account}
                </Text>
              </View>
              <View style={styles.actions}>
                <ActionButton label="Open Sodera" onPress={() => onComplete(profile)} />
              </View>
            </>
          ) : null}

          {stage === 'recovery' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>RECOVER WALLET</Text>
                <Text style={styles.title}>Recovery is coming later.</Text>
                <Text style={styles.description}>
                  Recovery is not available in this testnet build. No existing wallet has been changed.
                </Text>
              </View>
              <View style={styles.actions}>
                <ActionButton label="Back to welcome" onPress={() => setStage('welcome')} />
              </View>
            </>
          ) : null}

          {stage === 'blocked' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>SETUP NEEDS ATTENTION</Text>
                <Text style={styles.title}>{"We couldn't continue."}</Text>
                <Text selectable style={styles.description}>
                  {message}
                </Text>
              </View>
              {onRetry ? (
                <View style={styles.actions}>
                  <ActionButton label="Retry setup" onPress={onRetry} />
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (pressed || disabled) && styles.buttonPressed,
      ]}
    >
      {busy ? <ActivityIndicator color="#171713" /> : <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>}
    </Pressable>
  );
}

function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorCard}>
      <Text selectable style={styles.errorText}>
        {message}
      </Text>
    </View>
  );
}

function progressLabel(stage: Stage) {
  if (stage === 'welcome') return '1 / 3';
  if (stage === 'wallet') return '2 / 3';
  if (stage === 'username') return '3 / 3';
  return 'READY';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Setup could not continue';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 20 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#d4f06a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4f06a' },
  wordmark: { color: '#f3f0e8', fontSize: 13, fontWeight: '800', letterSpacing: 2, paddingLeft: 10 },
  progress: { marginLeft: 'auto', color: '#929188', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  body: { flex: 1, justifyContent: 'space-between', paddingTop: 48, paddingBottom: 16, gap: 32 },
  centered: { flex: 1, minHeight: 400, alignItems: 'center', justifyContent: 'center', gap: 16 },
  hero: { gap: 14 },
  eyebrow: { color: '#d4f06a', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#f3f0e8', fontSize: 48, lineHeight: 50, fontWeight: '800', letterSpacing: -1.8, maxWidth: 520 },
  description: { color: '#aaa89f', fontSize: 18, lineHeight: 27, maxWidth: 560 },
  muted: { color: '#929188', fontSize: 15 },
  actions: { gap: 12, paddingTop: 24 },
  button: {
    minHeight: 56,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: '#d4f06a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondaryButton: { backgroundColor: '#292923', borderWidth: 1, borderColor: '#3c3c34' },
  buttonPressed: { opacity: 0.65 },
  buttonText: { color: '#171713', fontSize: 16, fontWeight: '800' },
  secondaryButtonText: { color: '#f3f0e8' },
  detailCard: {
    backgroundColor: '#24241f',
    borderRadius: 22,
    borderCurve: 'continuous',
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#34342d',
  },
  detailTitle: { color: '#f3f0e8', fontSize: 17, fontWeight: '700' },
  detailBody: { color: '#929188', fontSize: 15, lineHeight: 22 },
  nameCard: {
    minHeight: 170,
    backgroundColor: '#d4f06a',
    borderRadius: 28,
    borderCurve: 'continuous',
    padding: 24,
    justifyContent: 'space-between',
  },
  name: { color: '#171713', fontSize: 29, fontWeight: '900', letterSpacing: -0.8 },
  availablePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#171713', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  availableDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#d4f06a' },
  availableText: { color: '#f3f0e8', fontSize: 12, fontWeight: '700' },
  disclaimer: { color: '#77766f', fontSize: 13, lineHeight: 19 },
  summaryCard: {
    backgroundColor: '#24241f',
    borderRadius: 24,
    borderCurve: 'continuous',
    padding: 22,
    gap: 10,
    borderWidth: 1,
    borderColor: '#34342d',
  },
  summaryLabel: { color: '#77766f', fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  summaryValue: { color: '#d4f06a', fontSize: 22, fontWeight: '800' },
  address: { color: '#f3f0e8', fontSize: 13, lineHeight: 20 },
  divider: { height: 1, backgroundColor: '#3a3a33', marginVertical: 8 },
  errorCard: { backgroundColor: '#4b2724', borderRadius: 16, borderCurve: 'continuous', padding: 16 },
  errorText: { color: '#ffd9d4', fontSize: 14, lineHeight: 20 },
});
