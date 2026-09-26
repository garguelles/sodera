import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { platinum } from '@/constants/theme';
import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';
import {
  createLauncherPreferencesRepository,
  MAX_FAVORITE_APPS,
  type LauncherPreferencesStorage,
} from '@/launcher/launcher-preferences';

type LauncherSettingsScreenProps = {
  client: LauncherClient;
  preferencesStorage: LauncherPreferencesStorage;
};

const { colors, radius, spacing, typography } = platinum;

export function LauncherSettingsScreen({ client, preferencesStorage }: LauncherSettingsScreenProps) {
  const [preferencesRepository] = useState(() => createLauncherPreferencesRepository(preferencesStorage));
  const [favoritePackageNames, setFavoritePackageNames] = useState<string[]>([]);
  const favoritePackageNamesRef = useRef<string[]>([]);
  const latestPreferenceChange = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<LauncherApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    const loadPreferences = () => {
      void preferencesRepository.load().then((preferences) => {
        if (!active) return;
        favoritePackageNamesRef.current = preferences.favoritePackageNames;
        setFavoritePackageNames(preferences.favoritePackageNames);
        setLoaded(true);
        setError(null);
      }).catch((loadError) => {
        if (!active) return;
        setError(getErrorMessage(loadError));
        setLoaded(true);
      });
    };
    loadPreferences();
    const unsubscribe = preferencesStorage.subscribe?.(loadPreferences);
    return () => { active = false; unsubscribe?.(); };
  }, [preferencesRepository, preferencesStorage]);

  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const loadApps = async () => {
      const request = ++latestRequest;
      try {
        const discovered = await client.getLaunchableApps();
        if (active && request === latestRequest) {
          setApps(discovered);
          setAppsError(null);
        }
      } catch (loadError) {
        if (active && request === latestRequest) setAppsError(getErrorMessage(loadError));
      } finally {
        if (active && request === latestRequest) setAppsLoading(false);
      }
    };
    void loadApps();
    const unsubscribe = client.subscribeToAppChanges(() => void loadApps());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadApps();
    });
    return () => { active = false; unsubscribe(); subscription.remove(); };
  }, [client]);

  const saveFavorites = (next: string[]) => {
    const previous = favoritePackageNamesRef.current;
    const change = ++latestPreferenceChange.current;
    favoritePackageNamesRef.current = next;
    setFavoritePackageNames(next);
    setError(null);
    void preferencesRepository.save(next).catch((saveError) => {
      if (change !== latestPreferenceChange.current) return;
      favoritePackageNamesRef.current = previous;
      setFavoritePackageNames(previous);
      setError(getErrorMessage(saveError));
    });
  };

  const installedApps = apps.filter((app, index) => apps.findIndex((candidate) => candidate.packageName === app.packageName) === index);
  const installedPackages = new Set(installedApps.map((app) => app.packageName));
  const visiblePinnedCount = favoritePackageNames.filter((name) => installedPackages.has(name)).length;
  const filteredApps = installedApps
    .filter((app) => app.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .map((app, index) => ({ app, index }))
    .sort((left, right) => left.app.label.localeCompare(right.app.label) || left.index - right.index)
    .map(({ app }) => app);

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PERSONALIZE YOUR PHONE</Text>
        <Text style={styles.title}>Pinned apps</Text>
        <Text style={styles.description}>Choose up to four apps for the bottom dock.</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {appsError ? <Text accessibilityRole="alert" style={styles.error}>{appsError}</Text> : null}
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>{visiblePinnedCount} of {MAX_FAVORITE_APPS} pinned</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear favorite apps"
          disabled={!loaded || favoritePackageNames.length === 0}
          onPress={() => saveFavorites([])}
          style={({ pressed }) => [styles.clearButton, (!loaded || favoritePackageNames.length === 0) && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.clearText}>Clear all</Text>
        </Pressable>
      </View>
      <View style={styles.searchContainer}>
        <TextInput
          accessibilityLabel="Search installed apps"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search installed apps"
          placeholderTextColor={colors.faintText}
          style={styles.search}
          value={query}
        />
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={filteredApps}
        keyExtractor={(app) => app.componentName}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            {appsLoading ? <ActivityIndicator color={colors.emerald} /> : null}
            <Text style={styles.secondary}>
              {appsLoading ? 'Loading installed apps...' : query.trim() ? 'No apps match your search' : 'No installed apps available'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const pinned = favoritePackageNames.includes(item.packageName);
          const limitReached = !pinned && visiblePinnedCount >= MAX_FAVORITE_APPS;
          return (
            <View style={styles.appRow}>
              {item.icon ? (
                <Image source={{ uri: item.icon }} style={styles.icon} />
              ) : (
                <View style={[styles.icon, styles.fallbackIcon]}>
                  <Text style={styles.fallbackText}>{item.label.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <Text numberOfLines={1} style={styles.appLabel}>{item.label}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${pinned ? 'Unpin' : limitReached ? 'Pin limit reached for' : 'Pin'} ${item.label}`}
                accessibilityState={{ disabled: !loaded || limitReached, selected: pinned }}
                disabled={!loaded || limitReached}
                onPress={() => {
                  const current = favoritePackageNamesRef.current;
                  saveFavorites(pinned
                    ? current.filter((name) => name !== item.packageName)
                    : [...current.filter((name) => installedPackages.has(name)), item.packageName]);
                }}
                style={({ pressed }) => [styles.pinButton, pinned && styles.pinnedButton, (!loaded || limitReached) && styles.disabled, pressed && styles.pressed]}>
                <Text style={[styles.pinText, pinned && styles.pinnedText]}>{pinned ? 'Unpin' : 'Pin'}</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to update launcher settings';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs },
  eyebrow: { ...typography.micro, color: colors.emerald },
  title: { ...typography.title, color: colors.platinum },
  description: { ...typography.bodySmall, color: colors.mutedText },
  error: { ...typography.bodySmall, color: colors.negative, backgroundColor: colors.negativeWash, marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md },
  summary: { marginHorizontal: spacing.lg, marginTop: spacing.xl, paddingHorizontal: spacing.lg, minHeight: 62, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { ...typography.labelSmall, color: colors.secondaryText },
  clearButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  clearText: { ...typography.bodySmall, color: colors.negative },
  searchContainer: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  search: { ...typography.body, color: colors.platinum, minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  appRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 42, height: 42, borderRadius: radius.md },
  fallbackIcon: { backgroundColor: colors.surfaceHigh, justifyContent: 'center', alignItems: 'center' },
  fallbackText: { ...typography.subheading, color: colors.platinum },
  appLabel: { ...typography.body, color: colors.platinum, flex: 1 },
  pinButton: { minHeight: 44, minWidth: 68, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.glass, justifyContent: 'center', alignItems: 'center' },
  pinnedButton: { backgroundColor: colors.emeraldWash },
  pinText: { ...typography.bodySmall, color: colors.secondaryText },
  pinnedText: { color: colors.emerald },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  secondary: { ...typography.bodySmall, color: colors.mutedText },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.65 },
});
