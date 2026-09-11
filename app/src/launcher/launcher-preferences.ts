export type LauncherPreferences = {
  schemaVersion: 1;
  favoritePackageNames: string[];
};

export type LauncherPreferencesStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
};

export type LauncherPreferencesRepository = {
  load(): Promise<LauncherPreferences>;
  save(favoritePackageNames: string[]): Promise<void>;
};

const DEFAULT_PREFERENCES: LauncherPreferences = {
  schemaVersion: 1,
  favoritePackageNames: [],
};

export function createLauncherPreferencesRepository(
  storage: LauncherPreferencesStorage,
): LauncherPreferencesRepository {
  let writes: Promise<void> = Promise.resolve();

  return {
    async load() {
      return parseLauncherPreferences(await storage.read());
    },
    save(favoritePackageNames) {
      const value = JSON.stringify({
        schemaVersion: 1,
        favoritePackageNames: normalizePackageNames(favoritePackageNames),
      } satisfies LauncherPreferences);
      const write = writes.then(() => storage.write(value));
      writes = write.catch(() => undefined);
      return write;
    },
  };
}

export function parseLauncherPreferences(value: string | null): LauncherPreferences {
  if (!value) return DEFAULT_PREFERENCES;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('schemaVersion' in parsed) ||
      parsed.schemaVersion !== 1 ||
      !('favoritePackageNames' in parsed) ||
      !Array.isArray(parsed.favoritePackageNames)
    ) {
      return DEFAULT_PREFERENCES;
    }

    return {
      schemaVersion: 1,
      favoritePackageNames: normalizePackageNames(parsed.favoritePackageNames),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function normalizePackageNames(values: unknown[]) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}
