import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  createLauncherPreferencesRepository,
  MAX_FAVORITE_APPS,
  type LauncherPreferencesStorage,
} from '@/launcher/launcher-preferences';

type LauncherSettingsScreenProps = {
  preferencesStorage: LauncherPreferencesStorage;
};

export function LauncherSettingsScreen({ preferencesStorage }: LauncherSettingsScreenProps) {
  const [preferencesRepository] = useState(() =>
    createLauncherPreferencesRepository(preferencesStorage),
  );
  const [favoritePackageNames, setFavoritePackageNames] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    preferencesRepository
      .load()
      .then((preferences) => {
        if (!active) return;
        setFavoritePackageNames(preferences.favoritePackageNames);
        setLoaded(true);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(getErrorMessage(loadError));
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [preferencesRepository]);

  const clearFavorites = async () => {
    try {
      setError(null);
      await preferencesRepository.save([]);
      setFavoritePackageNames([]);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.description}>
        Favorites are stored on this device and stay available offline.
      </Text>
      {error ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <View style={styles.settingRow}>
        <View style={styles.settingCopy}>
          <Text style={styles.settingLabel}>Favorite apps</Text>
          <Text style={styles.secondary}>
            {favoritePackageNames.length} of {MAX_FAVORITE_APPS} pinned
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear favorite apps"
          disabled={!loaded || favoritePackageNames.length === 0}
          onPress={clearFavorites}
          style={({ pressed }) => [
            styles.clearButton,
            (!loaded || favoritePackageNames.length === 0) && styles.disabled,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.clearButtonText}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to update launcher settings';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713', paddingHorizontal: 24, paddingTop: 24, gap: 18 },
  description: { color: '#929188', fontSize: 14, lineHeight: 20 },
  secondary: { color: '#929188', fontSize: 14 },
  settingRow: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#292923',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  settingCopy: { flex: 1, gap: 4 },
  settingLabel: { color: '#f3f0e8', fontSize: 16, fontWeight: '600' },
  clearButton: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: '#4b2724',
    paddingHorizontal: 15,
    justifyContent: 'center',
  },
  clearButtonText: { color: '#ffd9d4', fontSize: 13, fontWeight: '700' },
  error: { padding: 12, backgroundColor: '#443a24' },
  errorText: { color: '#f7e2ad', fontSize: 13 },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.55, transform: [{ scale: 0.96 }] },
});
