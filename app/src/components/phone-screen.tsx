import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { platinum } from '@/constants/theme';
import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';
import {
  createLauncherPreferencesRepository,
  type LauncherPreferencesStorage,
} from '@/launcher/launcher-preferences';

type PhoneScreenProps = {
  client: LauncherClient;
  preferencesStorage: LauncherPreferencesStorage;
};

export function PhoneScreen({
  client,
  preferencesStorage,
}: PhoneScreenProps) {
  const [apps, setApps] = useState<LauncherApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [favoritePackageNames, setFavoritePackageNames] = useState<string[]>([]);
  const [preferencesRepository] = useState(() =>
    createLauncherPreferencesRepository(preferencesStorage),
  );
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const [retryCount, setRetryCount] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadPreferences = () => {
      void preferencesRepository
        .load()
        .then((preferences) => {
          if (!active) return;
          setFavoritePackageNames(preferences.favoritePackageNames);
          setPreferencesError(null);
        })
        .catch((loadError) => {
          if (!active) return;
          setPreferencesError(getErrorMessage(loadError));
        });
    };

    loadPreferences();
    const unsubscribe = preferencesStorage.subscribe?.(loadPreferences);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [preferencesRepository, preferencesStorage]);

  useEffect(() => {
    let active = true;
    let latestRequest = 0;

    const loadApps = async () => {
      const request = ++latestRequest;
      try {
        const nextApps = await client.getLaunchableApps();
        if (active && request === latestRequest) {
          setApps(nextApps);
          setError(null);
        }
      } catch (loadError) {
        if (active && request === latestRequest) setError(getErrorMessage(loadError));
      } finally {
        if (active && request === latestRequest) setLoading(false);
      }
    };

    void loadApps();
    const unsubscribe = client.subscribeToAppChanges(() => void loadApps());
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadApps();
    });
    return () => {
      active = false;
      unsubscribe();
      appStateSubscription.remove();
    };
  }, [client, retryCount]);

  const openApp = async (app: LauncherApp) => {
    try {
      setError(null);
      await client.launchApp(app.componentName);
    } catch (launchError) {
      setApps((currentApps) =>
        currentApps.filter((currentApp) => currentApp.componentName !== app.componentName),
      );
      setError(getErrorMessage(launchError));
    }
  };

  const favoritePackages = new Set(favoritePackageNames);
  const drawerApps = apps
    .filter((app) => app.label.toLocaleLowerCase().includes(normalizedQuery))
    .map((app, index) => ({ app, index }))
    .sort((left, right) => left.app.label.localeCompare(right.app.label) || left.index - right.index)
    .map(({ app }) => app);
  const pinnedApps = apps.filter((app) => favoritePackages.has(app.packageName));

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>YOUR PHONE</Text>
          <Text style={styles.title}>All your apps.</Text>
        </View>
      </View>
      {error ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
          {apps.length === 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLoading(true);
                setRetryCount((count) => count + 1);
              }}>
              <Text style={styles.retry}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {preferencesError ? (
        <View accessibilityRole="alert" style={styles.preferenceError}>
          <Text style={styles.preferenceErrorText}>{preferencesError}</Text>
          <Text style={styles.preferenceErrorText}>Installed apps remain available.</Text>
        </View>
      ) : null}
      <View style={styles.searchContainer}>
        <TextInput
          accessibilityLabel="Search apps"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search apps"
          placeholderTextColor={platinum.colors.faintText}
          returnKeyType="search"
          style={styles.search}
          value={query}
        />
      </View>
      <FlatList
        style={styles.launcherContent}
        contentContainerStyle={styles.list}
        data={loading ? [] : drawerApps}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(app) => app.componentName}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={platinum.colors.platinum} />
              <Text style={styles.secondary}>Loading apps...</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {normalizedQuery
                  ? `No apps match "${query.trim()}"`
                  : 'No launchable apps found'}
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <View style={styles.drawerMeta}>
            <Text style={styles.count}>
              {normalizedQuery ? `${drawerApps.length} of ${apps.length} apps` : `${apps.length} apps`}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.label}`}
            onPress={() => openApp(item)}
            style={({ pressed }) => [styles.appRow, pressed && styles.pressed]}>
            {item.icon ? (
              <Image source={{ uri: item.icon }} style={styles.icon} />
            ) : (
              <View style={[styles.icon, styles.fallbackIcon]}>
                <Text style={styles.fallbackText}>{item.label.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <Text numberOfLines={1} style={styles.label}>{item.label}</Text>
          </Pressable>
        )}
      />
      {!loading && !normalizedQuery && !keyboardVisible ? (
        <View style={styles.favorites}>
          {pinnedApps.length > 0 ? (
            <View style={styles.favoriteRow}>
              {pinnedApps.map((app) => (
                <Pressable
                  key={app.packageName}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${app.label}`}
                  onPress={() => openApp(app)}
                  style={({ pressed }) => [styles.favoriteLaunch, pressed && styles.pressed]}>
                  {app.icon ? (
                    <Image source={{ uri: app.icon }} style={styles.favoriteIcon} />
                  ) : (
                    <View style={[styles.favoriteIcon, styles.fallbackIcon]}>
                      <Text style={styles.fallbackText}>{app.label.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text numberOfLines={1} style={styles.favoriteAppLabel}>{app.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.favoritesHint}>Pin apps in Settings for quick access.</Text>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to open app';
}

const { colors, spacing, radius, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  launcherContent: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  eyebrow: { ...typography.micro, color: colors.emerald },
  title: { ...typography.title, color: colors.platinum, paddingTop: spacing.xs },
  count: { ...typography.labelSmall, color: colors.mutedText },
  searchContainer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  search: {
    minHeight: 48,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.platinum,
    paddingHorizontal: spacing.lg,
    ...typography.body,
  },
  drawerMeta: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  emptyState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  emptyText: { ...typography.bodySmall, color: colors.mutedText, textAlign: 'center' },
  appRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { opacity: 0.6 },
  icon: { width: 42, height: 42, borderRadius: radius.md },
  fallbackIcon: { backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  fallbackText: { ...typography.subheading, color: colors.platinum },
  label: { ...typography.body, color: colors.platinum, flex: 1 },
  favorites: { borderTopWidth: 1, borderTopColor: colors.borderLit, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  favoritesHint: { ...typography.bodySmall, color: colors.mutedText, paddingBottom: spacing.lg },
  favoriteRow: { flexDirection: 'row', alignItems: 'flex-start' },
  favoriteLaunch: { alignItems: 'center', width: '25%', minHeight: 68, gap: spacing.xs },
  favoriteIcon: { width: 40, height: 40, borderRadius: radius.md },
  favoriteAppLabel: { ...typography.micro, color: colors.secondaryText, textAlign: 'center' },
  center: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  secondary: { ...typography.bodySmall, color: colors.mutedText },
  error: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, backgroundColor: colors.negativeWash, borderRadius: radius.md },
  errorText: { ...typography.bodySmall, color: colors.negative },
  preferenceError: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceHigh, borderRadius: radius.md },
  preferenceErrorText: { ...typography.bodySmall, color: colors.warning },
  retry: { ...typography.bodySmall, color: colors.platinum, paddingTop: spacing.sm },
});
