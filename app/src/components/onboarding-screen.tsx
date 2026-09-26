import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Address } from 'viem';

import { platinum } from '@/constants/theme';
import { createEnsClaimClient } from '@/ens/claim-client';
import { createEnsIdentityReader, type EnsIdentityReader } from '@/ens/identity-client';
import { parseSoderaUsername } from '@/ens/username';
import {
  persistCompletedOnboarding,
  persistPendingEnsClaim,
  resolveOnboardingAccess,
  type OnboardingProfile,
  type OnboardingProfileStorage,
  type PendingEnsClaim,
  type UsernameClaimClient,
} from '@/onboarding/onboarding';
import { onboardingNativeStorage } from '@/onboarding/onboarding-native-storage';
import { defaultHomeClient, type DefaultHomeClient } from '@/launcher/default-home';
import { createKernelPasskeyExecutionClient, type KernelOperationReview, type KernelPasskeyExecutionClient } from '@/wallet/kernel-passkey-execution';
import { createPasskeyCeremonyClient } from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import {
  createWalletIdentityClient,
  inspectPersistedWalletIdentity,
  readPersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';
import { waitForAppForeground } from '@/wallet/wait-for-app-foreground';

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

type Stage = 'loading' | 'welcome' | 'wallet' | 'username' | 'claimPending' | 'home' | 'recovery' | 'blocked';

export function OnboardingScreen({
  client = defaultCeremonyClient,
  createExecutionClient = createKernelPasskeyExecutionClient,
  identityStorage = walletIdentityNativeStorage,
  profileStorage = onboardingNativeStorage,
  usernameClaimClient,
  identityReader,
  homeClient = defaultHomeClient,
  onComplete,
  onRetry,
  initialError,
}: {
  client?: ReturnType<typeof createPasskeyCeremonyClient>;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  identityStorage?: WalletIdentityStorage;
  profileStorage?: OnboardingProfileStorage;
  usernameClaimClient?: UsernameClaimClient;
  identityReader?: EnsIdentityReader;
  homeClient?: DefaultHomeClient;
  onComplete(profile: OnboardingProfile): void;
  onRetry?: () => void;
  initialError?: string;
}) {
  const [stage, setStage] = useState<Stage>(initialError ? 'blocked' : 'loading');
  const [account, setAccount] = useState<Address | null>(null);
  const [executionClient, setExecutionClient] = useState<KernelPasskeyExecutionClient | null>(null);
  const [activationReview, setActivationReview] = useState<KernelOperationReview | null>(null);
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState<PendingEnsClaim | null>(null);
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

  const recoverClaim = async (wallet: Address) => {
    const existing = await (usernameClaimClient ?? createEnsClaimClient({ ceremonyClient: client })).forAccount(wallet);
    if (!existing) return false;
    const saved = await persistPendingEnsClaim(profileStorage, {
      account: wallet, username: existing.name, claimId: existing.id,
    });
    setPending(saved);
    setStage('claimPending');
    return true;
  };

  useEffect(() => {
    if (initialError) return;
    let active = true;
    const bootstrap = async () => {
      try {
        const access = await resolveOnboardingAccess({ identityStorage, profileStorage, homeClient });
        if (!active) return;
        if (access.status === 'blocked') {
          setMessage(access.message);
          setStage('blocked');
          return;
        }
        if (access.status === 'incomplete') {
          const resumable = access.wallet === 'resumable';
          setResumeWallet(resumable);
          if (access.pending) {
            setAccount(access.pending.account);
            setLabel(access.pending.username.replace(/\.sodera\.eth$/, ''));
            setPending(access.pending);
            setStage('claimPending');
            return;
          }
          setStage(resumable ? 'wallet' : 'welcome');
          return;
        }
        setProfile(access.profile);
        setAccount(access.profile.account);
        setStage('home');
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
  }, [client, homeClient, identityStorage, initialError, profileStorage]);

  useEffect(() => {
    if (stage !== 'home' || !profile) return;
    let active = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void homeClient.isDefaultHome().then((isHome) => {
        if (active && isHome) onComplete(profile);
      }).catch((error) => {
        if (active) setMessage(getErrorMessage(error));
      });
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [homeClient, onComplete, profile, stage]);

  const selectDefaultHome = async () => {
    if (!profile || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (await homeClient.isDefaultHome()) {
        onComplete(profile);
        return;
      }
      await homeClient.requestDefaultHome();
      if (await homeClient.isDefaultHome()) onComplete(profile);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const confirmDefaultHome = async () => {
    if (!profile || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (await homeClient.isDefaultHome()) {
        onComplete(profile);
      } else {
        setMessage('Select Sodera in the Android Home app prompt to finish setup.');
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

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
      setExecutionClient(result.executionClient ?? null);
      if (result.deployed && await recoverClaim(result.account)) return;
      if (result.deployed) {
        setStage('username');
      } else if (result.executionClient) {
        setActivationReview(await result.executionClient.prepare());
      } else {
        throw new Error('Wallet activation is unavailable. Reopen the existing wallet to retry.');
      }
    } catch (error) {
      if (currentInvocation === invocation.current) setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const activateWallet = async () => {
    if (!executionClient || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (!activationReview) {
        setActivationReview(await executionClient.prepare());
      } else {
        const receipt = await executionClient.execute(activationReview.userOperationHash);
        await walletIdentityClient.markDeployed(receipt.account);
        setActivationReview(null);
        setStage('username');
      }
    } catch (error) {
      setActivationReview(null);
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const claimUsername = async () => {
    if (!account || !label || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setMessage('');
    try {
      if (await recoverClaim(account)) return;
      const username = parseSoderaUsername(label);
      if (!(await (identityReader ?? createEnsIdentityReader()).availability(username.label))) {
        throw new Error('This name is unavailable or the parent expires too soon');
      }
      const identity = await readPersistedWalletIdentity(identityStorage);
      if (!identity.deployed || identity.account.toLowerCase() !== account.toLowerCase()) {
        throw new Error('Activate this wallet before claiming a name');
      }
      const claim = await (usernameClaimClient ?? createEnsClaimClient({ ceremonyClient: client })).submit({
        account, credential: identity.credential, label: username.label,
      });
      if (currentInvocation !== invocation.current) return;
      const saved = await persistPendingEnsClaim(profileStorage, {
        account, username: claim.name, claimId: claim.id,
      });
      setPending(saved);
      setStage('claimPending');
      if (claim.status === 'confirmed') void refreshClaim(saved);
    } catch (error) {
      if (currentInvocation === invocation.current) setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const refreshClaim = useCallback(async (claim: PendingEnsClaim) => {
    if (!claim || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    try {
      const result = await (usernameClaimClient ?? createEnsClaimClient({ ceremonyClient: client })).status({
        id: claim.claimId, account: claim.account, label: claim.username.replace(/\.sodera\.eth$/, ''),
      });
      if (result.status === 'needs_attention' || result.status === 'detached') {
        setMessage('Issuance needs attention. Your wallet is safe; retry status later or contact Sodera support.');
      } else if (result.status === 'confirmed') {
        const verified = await (identityReader ?? createEnsIdentityReader()).verify(claim.username, claim.account);
        if (!verified) throw new Error('The name is not currently owned by and resolving to this wallet');
        const completed = await persistCompletedOnboarding({
          storage: profileStorage, account: claim.account, name: claim.username, claimId: claim.claimId,
        });
        setProfile(completed);
        setPending(null);
        setMessage('');
        setStage('home');
      } else {
        setMessage('');
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }, [client, identityReader, profileStorage, usernameClaimClient]);

  useEffect(() => {
    if (stage !== 'claimPending' || !pending) return;
    void refreshClaim(pending);
    const interval = setInterval(() => void refreshClaim(pending), 5_000);
    return () => clearInterval(interval);
  }, [stage, pending, refreshClaim]);

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
              <ActivityIndicator color={platinum.colors.emerald} />
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
                <Text style={styles.title}>{executionClient ? 'Activate your wallet.' : resumeWallet ? 'Finish your wallet.' : 'Create your wallet.'}</Text>
                <Text style={styles.description}>
                  {executionClient
                    ? 'One passkey confirmation deploys your smart account and sends a zero-value Sepolia operation.'
                    : 'Android will ask you to create a passkey. It directly controls your testnet smart account.'}
                </Text>
              </View>
              <View style={styles.detailCard}>
                {executionClient ? (
                  <>
                    <Text style={styles.detailTitle}>Wallet activation</Text>
                    <Text style={styles.detailBody}>Deploy wallet + 0 ETH operation on Sepolia</Text>
                    <Text style={styles.detailBody}>Network fee: {activationReview?.sponsored ? 'Sponsored' : 'Requires Sepolia ETH if not sponsored'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.detailTitle}>No password. No seed phrase.</Text>
                    <Text style={styles.detailBody}>This testnet wallet is tied to your passkey. Recovery is not available in this build.</Text>
                  </>
                )}
              </View>
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton
                  busy={busy}
                  disabled={busy}
                  label={executionClient ? activationReview ? 'Activate wallet' : 'Retry activation' : resumeWallet ? 'Continue wallet setup' : 'Create with passkey'}
                  onPress={executionClient ? activateWallet : createOrResumeWallet}
                />
                {!resumeWallet && !executionClient ? (
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
                  Pick an available name owned by your passkey-controlled wallet. Registration lasts one year on Sepolia.
                </Text>
              </View>
              <View style={styles.nameCard}>
                <TextInput
                  accessibilityLabel="Choose your Sodera name"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  maxLength={20}
                  onChangeText={(value) => { setLabel(value); setMessage(''); }}
                  placeholder="yourname"
                  placeholderTextColor={colors.faintText}
                  selectionColor={colors.emerald}
                  style={styles.nameInput}
                  testID="ens-username"
                  value={label}
                />
                <Text style={styles.name}>.sodera.eth</Text>
              </View>
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton
                  busy={busy}
                  disabled={busy || !label}
                  label="Claim"
                  onPress={claimUsername}
                />
              </View>
            </>
          ) : null}

          {stage === 'claimPending' && pending ? (
            <View accessibilityLabel="Registering Sodera name" style={styles.pendingMask}>
              <ActivityIndicator color={colors.emerald} size="large" />
              <Text style={styles.pendingTitle}>Making it official.</Text>
              <InlineError message={message} />
            </View>
          ) : null}

          {stage === 'home' && account && profile ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>ONE LAST STEP</Text>
                <Text style={styles.title}>Make Sodera your Home.</Text>
                <Text style={styles.description}>
                  Choose Sodera as your default Home app in the Android prompt. Your Home button will then open Sodera.
                </Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{profile.claimMode === 'ens' ? 'VERIFIED SODERA NAME' : 'LEGACY DEMO NAME (UNVERIFIED)'}</Text>
                <Text selectable style={styles.summaryValue}>
                  {profile.username}
                </Text>
                <View style={styles.divider} />
                <Text style={styles.summaryLabel}>WALLET ADDRESS</Text>
                <Text selectable style={styles.address}>
                  {account}
                </Text>
              </View>
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton label="Set Sodera as Home" busy={busy} disabled={busy} onPress={selectDefaultHome} />
                <ActionButton label="I've selected Sodera" disabled={busy} onPress={confirmDefaultHome} secondary />
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
      {busy ? <ActivityIndicator color={secondary ? platinum.colors.platinum : platinum.colors.onPlatinum} /> : <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>}
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
  if (stage === 'welcome') return '1 / 4';
  if (stage === 'wallet') return '2 / 4';
  if (stage === 'username' || stage === 'claimPending') return '3 / 4';
  return '4 / 4';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Setup could not continue';
}

const { colors, spacing, radius, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.borderLit,
    backgroundColor: colors.glassRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markCore: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.platinum },
  wordmark: { ...typography.label, color: colors.platinum, letterSpacing: 2, paddingLeft: spacing.md },
  progress: { ...typography.labelSmall, marginLeft: 'auto', color: colors.mutedText },
  body: { flex: 1, justifyContent: 'space-between', paddingTop: spacing.xxl, paddingBottom: spacing.lg, gap: spacing.xxl },
  centered: { flex: 1, minHeight: 400, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  pendingMask: { flex: 1, minHeight: 400, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  pendingTitle: { ...typography.heading, color: colors.platinum, textAlign: 'center' },
  hero: { gap: spacing.md },
  eyebrow: { ...typography.labelSmall, color: colors.emerald },
  title: { ...typography.display, color: colors.platinum, maxWidth: 520 },
  description: { ...typography.body, color: colors.mutedText, maxWidth: 560 },
  muted: { ...typography.bodySmall, color: colors.mutedText },
  actions: { gap: spacing.md, paddingTop: spacing.xl },
  button: {
    minHeight: 56,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.platinum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  secondaryButton: { backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
  buttonPressed: { opacity: 0.65 },
  buttonText: { ...typography.body, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum },
  secondaryButtonText: { color: colors.platinum },
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    padding: spacing.xl,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailTitle: { ...typography.subheading, color: colors.platinum },
  detailBody: { ...typography.bodySmall, color: colors.mutedText },
  nameCard: {
    minHeight: 170,
    backgroundColor: colors.platinum,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  name: { ...typography.title, color: colors.onPlatinum },
  nameInput: {
    ...typography.title,
    color: colors.onPlatinum,
    minHeight: 64,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.faintText,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    padding: spacing.xl,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: { ...typography.labelSmall, color: colors.mutedText },
  summaryValue: { ...typography.heading, color: colors.platinum },
  address: { ...typography.label, color: colors.secondaryText },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  errorCard: { backgroundColor: colors.negativeWash, borderRadius: radius.lg, borderCurve: 'continuous', padding: spacing.lg },
  errorText: { ...typography.bodySmall, color: colors.negative },
});
