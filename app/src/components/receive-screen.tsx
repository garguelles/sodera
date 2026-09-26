import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Address } from 'viem';

import { platinum } from '@/constants/theme';
import { readPersistedWalletIdentity, type WalletIdentityStorage } from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';

type ReceiveState =
  | { status: 'loading' }
  | { status: 'ready'; address: Address }
  | { status: 'error'; message: string };

export function ReceiveScreen({
  storage = walletIdentityNativeStorage,
  copyAddress = async (address) => {
    await Clipboard.setStringAsync(address);
  },
  onBack = () => router.back(),
}: {
  storage?: WalletIdentityStorage;
  copyAddress?: (address: string) => Promise<void>;
  onBack?: () => void;
} = {}) {
  const { width } = useWindowDimensions();
  const [state, setState] = useState<ReceiveState>({ status: 'loading' });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void readPersistedWalletIdentity(storage)
      .then((identity) => {
        if (active) setState({ status: 'ready', address: identity.account });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not load wallet address',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [retryCount, storage]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copy = async (address: Address) => {
    setCopyError('');
    try {
      await copyAddress(address);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setCopied(false);
      setCopyError(error instanceof Error ? error.message : 'Could not copy wallet address');
    }
  };

  const qrSize = Math.min(264, width - 96);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.networkPill}>
            <View style={styles.networkDot} />
            <Text style={styles.networkText}>Sepolia</Text>
          </View>
        </View>

        <View style={styles.heading}>
          <Text style={styles.eyebrow}>RECEIVE ASSETS</Text>
          <Text style={styles.title}>Your wallet address.</Text>
          <Text style={styles.description}>
            Scan this code or copy the address to receive ETH and USDC on Ethereum Sepolia.
          </Text>
        </View>

        {state.status === 'loading' ? (
          <View accessibilityLabel="Loading wallet address" style={styles.stateCard}>
            <ActivityIndicator color={platinum.colors.emerald} />
            <Text style={styles.stateText}>Loading address...</Text>
          </View>
        ) : null}

        {state.status === 'error' ? (
          <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorCard}>
            <Text style={styles.errorTitle}>Wallet address unavailable</Text>
            <Text selectable style={styles.errorText}>
              {state.message}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setState({ status: 'loading' });
                setRetryCount((count) => count + 1);
              }}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {state.status === 'ready' ? (
          <View style={styles.receiveCard}>
            <View
              accessibilityLabel={`QR code for wallet address ${state.address}`}
              style={styles.qrFrame}
            >
              <QRCode
                backgroundColor={platinum.colors.qrBackground}
                color={platinum.colors.onPlatinum}
                ecl="M"
                quietZone={12}
                size={qrSize}
                value={state.address}
              />
            </View>

            <View style={styles.addressBlock}>
              <Text style={styles.addressLabel}>WALLET ADDRESS</Text>
              <Text selectable style={styles.address}>
                {state.address}
              </Text>
            </View>

            <Pressable
              accessibilityLabel="Copy wallet address"
              accessibilityRole="button"
              onPress={() => void copy(state.address)}
              style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
            >
              <CopyIcon />
              <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy address'}</Text>
            </Pressable>

            {copyError ? (
              <Text accessibilityLiveRegion="assertive" selectable style={styles.copyError}>
                {copyError}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.warning}>
          Only send Ethereum Sepolia assets to this address. Assets sent on another network may not
          appear here.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function CopyIcon() {
  return (
    <View importantForAccessibility="no-hide-descendants" style={styles.copyIcon}>
      <View style={styles.copyIconBack} />
      <View style={styles.copyIconFront} />
    </View>
  );
}

const { colors, spacing, radius, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, gap: spacing.xl },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { minHeight: 44, justifyContent: 'center', paddingRight: spacing.xl },
  backText: { ...typography.bodySmall, color: colors.secondaryText },
  networkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.emeraldWash,
  },
  networkDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.emerald },
  networkText: { ...typography.labelSmall, color: colors.emerald },
  heading: { gap: spacing.md },
  eyebrow: { ...typography.labelSmall, color: colors.emerald },
  title: { ...typography.display, color: colors.platinum },
  description: { ...typography.body, color: colors.mutedText },
  stateCard: { minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.bodySmall, color: colors.mutedText },
  receiveCard: {
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qrFrame: {
    padding: spacing.sm,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.qrBackground,
  },
  addressBlock: { alignSelf: 'stretch', gap: spacing.sm },
  addressLabel: { ...typography.labelSmall, color: colors.mutedText },
  address: {
    ...typography.label,
    color: colors.platinum,
  },
  copyButton: {
    minHeight: 52,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.platinum,
  },
  copyText: { ...typography.body, color: colors.onPlatinum },
  copyIcon: { width: 20, height: 20 },
  copyIconBack: {
    position: 'absolute',
    left: 2,
    top: 2,
    width: 12,
    height: 13,
    borderWidth: 2,
    borderColor: colors.onPlatinum,
    borderRadius: radius.sm,
  },
  copyIconFront: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 12,
    height: 13,
    borderWidth: 2,
    borderColor: colors.onPlatinum,
    borderRadius: radius.sm,
    backgroundColor: colors.platinum,
  },
  copyError: { ...typography.bodySmall, color: colors.negative },
  warning: { ...typography.bodySmall, color: colors.mutedText, paddingHorizontal: spacing.xs },
  errorCard: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.negativeWash,
  },
  errorTitle: { ...typography.subheading, color: colors.platinum },
  errorText: { ...typography.bodySmall, color: colors.negative },
  retryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.platinum,
  },
  retryText: { ...typography.bodySmall, color: colors.onPlatinum },
  pressed: { opacity: 0.65 },
});
