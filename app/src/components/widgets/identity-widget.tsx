import * as Clipboard from 'expo-clipboard';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { platinum } from '@/constants/theme';
import type { WidgetSize } from '@/launcher/home-layout';
import { shortenAddress } from '@/wallet/sepolia';

type IdentityWidgetProps = {
  size: WidgetSize;
  accountAddress?: string | null;
  username?: string | null;
  onOpenWallet: () => void;
};

const { colors, radius, spacing, typography } = platinum;

/** 4×2 identity card: username, copyable address, presence dot, and profile links. */
export function IdentityWidget({ accountAddress, username, onOpenWallet }: IdentityWidgetProps) {
  return (
    <View style={styles.identity}>
      <View style={styles.identityTop}>
        <View style={styles.identityMark}>
          <View style={styles.identityAvatar}>
            <SymbolView name={{ ios: 'person.fill', android: 'person', web: 'person' }} size={22} tintColor={colors.platinum} />
          </View>
          {accountAddress ? <View style={styles.presenceDot} /> : null}
        </View>
        <View style={styles.identityCopy}>
          <Text numberOfLines={1} style={styles.identityTitle}>{username ?? 'Your smart account'}</Text>
          {accountAddress ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy account address"
              onPress={() => void Clipboard.setStringAsync(accountAddress)}
              style={styles.addressRow}>
              <Text style={styles.identityAddress}>{shortenAddress(accountAddress)}</Text>
              <SymbolView name={{ ios: 'square.on.square', android: 'content_copy', web: 'content_copy' }} size={12} tintColor={colors.faintText} />
            </Pressable>
          ) : (
            <Text style={styles.identityAddress}>Sepolia smart wallet</Text>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="View smart account" onPress={onOpenWallet} style={styles.identityArrow}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.identityFooter}>
        <Text style={styles.identityChip}>𝕏 @anon_builder</Text>
        <Text style={styles.identityChip}>github/anon</Text>
        <Text style={styles.identityChipActive}>sodera.xyz</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open profile wallet" onPress={onOpenWallet} style={styles.identityFooterArrow}>
          <Text style={styles.footerArrowText}>›</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between', overflow: 'hidden' },
  identityTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityMark: { width: 42, height: 42, borderRadius: radius.full, backgroundColor: colors.cyan, padding: 3, alignItems: 'center', justifyContent: 'center' },
  identityAvatar: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  presenceDot: { position: 'absolute', width: 11, height: 11, borderRadius: radius.full, backgroundColor: colors.emerald, borderWidth: 2, borderColor: colors.canvas, bottom: -1, right: -1 },
  identityCopy: { flex: 1, gap: spacing.xs },
  identityTitle: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 20 },
  identityAddress: { ...typography.micro, color: colors.mutedText },
  identityArrow: { width: 30, height: 30, borderRadius: radius.full, backgroundColor: colors.glassRaised, alignItems: 'center', justifyContent: 'center' },
  arrowText: { ...typography.subheading, color: colors.mutedText },
  identityFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  identityChip: { ...typography.micro, color: colors.mutedText, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  identityChipActive: { ...typography.micro, color: colors.emerald, backgroundColor: colors.emeraldWash, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  identityFooterArrow: { marginLeft: 'auto', minWidth: 20, alignItems: 'flex-end' },
  footerArrowText: { ...typography.subheading, color: colors.mutedText },
});
