import { fits, HOME_GRID, type HomeLayout, type HomeLayoutItem } from './home-layout';
import { getWidgetDefinition, isWidgetId, supportsSize } from './widget-registry';

export type LauncherPreferences = {
  schemaVersion: 2;
  favoritePackageNames: string[];
  /** `null` means "use the default layout for the current widget availability". */
  homeLayout: HomeLayout | null;
  amountsVisible: boolean;
};

export type LauncherPreferencesPatch = Partial<Omit<LauncherPreferences, 'schemaVersion'>>;

export type LauncherPreferencesStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  subscribe?(listener: () => void): () => void;
};

export type LauncherPreferencesRepository = {
  load(): Promise<LauncherPreferences>;
  /** Merges the patch into the stored preferences; writes are serialised so concurrent callers never overwrite each other. */
  save(patch: LauncherPreferencesPatch): Promise<void>;
};

export const MAX_FAVORITE_APPS = 4;

const DEFAULT_PREFERENCES: LauncherPreferences = {
  schemaVersion: 2,
  favoritePackageNames: [],
  homeLayout: null,
  amountsVisible: true,
};

export function createLauncherPreferencesRepository(
  storage: LauncherPreferencesStorage,
): LauncherPreferencesRepository {
  let writes: Promise<void> = Promise.resolve();

  return {
    async load() {
      return parseLauncherPreferences(await storage.read());
    },
    save(patch) {
      const write = writes.then(async () => {
        const current = parseLauncherPreferences(await storage.read());
        const next: LauncherPreferences = {
          schemaVersion: 2,
          favoritePackageNames: normalizePackageNames(patch.favoritePackageNames ?? current.favoritePackageNames),
          homeLayout: patch.homeLayout === undefined ? current.homeLayout : patch.homeLayout,
          amountsVisible: patch.amountsVisible ?? current.amountsVisible,
        };
        await storage.write(JSON.stringify(next));
      });
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
      !isRecord(parsed) ||
      (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) ||
      !Array.isArray(parsed.favoritePackageNames)
    ) {
      return DEFAULT_PREFERENCES;
    }

    return {
      schemaVersion: 2,
      favoritePackageNames: normalizePackageNames(parsed.favoritePackageNames),
      homeLayout: parseHomeLayout(parsed.homeLayout),
      amountsVisible: typeof parsed.amountsVisible === 'boolean' ? parsed.amountsVisible : true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Returns the whole layout or `null`; never a partial layout. */
export function parseHomeLayout(value: unknown): HomeLayout | null {
  if (!isRecord(value) || value.columns !== HOME_GRID.columns || !Array.isArray(value.items)) return null;

  const layout: HomeLayout = { columns: HOME_GRID.columns, items: [] };
  for (const entry of value.items) {
    const item = parseLayoutItem(entry);
    if (!item) return null;
    if (layout.items.some((placed) => placed.id === item.id)) return null;
    if (!supportsSize(getWidgetDefinition(item.id), item)) return null;
    if (!fits(layout, item)) return null;
    layout.items.push(item);
  }

  return layout;
}

function parseLayoutItem(value: unknown): HomeLayoutItem | null {
  if (!isRecord(value) || !isWidgetId(value.id)) return null;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every(Number.isInteger)) return null;
  return { id: value.id, x: x as number, y: y as number, w: w as number, h: h as number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePackageNames(values: unknown[]) {
  return [
    ...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)),
  ].slice(0, MAX_FAVORITE_APPS);
}
