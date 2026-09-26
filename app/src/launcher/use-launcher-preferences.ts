import { useCallback, useEffect, useState } from 'react';

import {
  createLauncherPreferencesRepository,
  type LauncherPreferences,
  type LauncherPreferencesPatch,
  type LauncherPreferencesStorage,
} from './launcher-preferences';

/**
 * Loads launcher preferences once, reloads whenever storage reports a change, and saves partial updates.
 * `preferences` is `null` until the first load finishes. `save` applies the patch locally before persisting it.
 */
export function useLauncherPreferences(storage: LauncherPreferencesStorage) {
  const [repository] = useState(() => createLauncherPreferencesRepository(storage));
  const [preferences, setPreferences] = useState<LauncherPreferences | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      void repository
        .load()
        .then((next) => {
          if (active) setPreferences(next);
        })
        .catch(() => undefined);
    };

    load();
    const unsubscribe = storage.subscribe?.(load);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [repository, storage]);

  const save = useCallback(
    (patch: LauncherPreferencesPatch) => {
      setPreferences((current) => (current ? { ...current, ...patch } : current));
      return repository.save(patch);
    },
    [repository],
  );

  return { preferences, save };
}
