import { SymbolView } from 'expo-symbols';
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { platinum } from '@/constants/theme';

export type IntentBarMode = 'start' | 'planning' | 'follow-up' | 'reply';

const PLACEHOLDERS: Record<IntentBarMode, string> = {
  start: 'Ask Dera',
  planning: '',
  'follow-up': 'Follow up, e.g. "make it 0.02 instead"',
  reply: 'Reply here',
};

type IntentBarProps = {
  mode: IntentBarMode;
  value: string;
  highlighted: boolean;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
};

export const INTENT_MAX_LENGTH = 500;

export const IntentBar = forwardRef<TextInput, IntentBarProps>(function IntentBar(
  { mode, value, highlighted, onChangeText, onSubmit, onFocus, onBlur },
  ref,
) {
  const planning = mode === 'planning';
  const canSubmit = !planning && value.trim().length > 0;
  return (
    <View style={[styles.bar, highlighted && styles.highlighted]}>
      <SymbolView
        importantForAccessibility="no"
        name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
        size={20}
        tintColor={colors.ethereum}
      />
      <TextInput
        ref={ref}
        accessibilityLabel="Wallet intent"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!planning}
        maxLength={INTENT_MAX_LENGTH}
        onBlur={onBlur}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onSubmitEditing={() => canSubmit && onSubmit()}
        placeholder={PLACEHOLDERS[mode]}
        placeholderTextColor={colors.faintText}
        returnKeyType="go"
        style={[styles.input, planning && styles.inputPlanning]}
        value={value}
      />
      <Pressable
        accessibilityLabel={planning ? 'Planning' : 'Plan'}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit, busy: planning }}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={({ pressed }) => [styles.button, canSubmit && styles.buttonReady, pressed && styles.pressed]}>
        <Text style={[styles.buttonText, canSubmit && styles.buttonTextReady]}>{planning ? '…' : 'Plan'}</Text>
      </Pressable>
    </View>
  );
});

const { colors, radius, spacing, typography } = platinum;

const styles = StyleSheet.create({
  bar: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceLowest,
    borderWidth: 1,
    borderColor: colors.border,
  },
  highlighted: {
    borderColor: colors.ethereum,
    boxShadow: '0 0 0 3px rgba(139, 158, 255, 0.16)',
  },
  input: { flex: 1, minWidth: 0, minHeight: 44, ...typography.label, fontSize: 15, color: colors.platinum },
  inputPlanning: { color: colors.text },
  button: {
    minWidth: 64,
    minHeight: 48,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonReady: { backgroundColor: colors.platinum },
  buttonText: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.faintText },
  buttonTextReady: { color: colors.onPlatinum },
  pressed: { opacity: 0.7 },
});
