import type { HomeLayout } from './home-layout';
import {
  createLauncherPreferencesRepository,
  parseHomeLayout,
  parseLauncherPreferences,
  type LauncherPreferencesStorage,
} from './launcher-preferences';
import { defaultHomeLayout } from './widget-registry';

const DEFAULTS = { schemaVersion: 2, favoritePackageNames: [], homeLayout: null, amountsVisible: true };

const layout: HomeLayout = defaultHomeLayout({ agentConfigured: false, account: null });

function createMemoryStorage(initial: string | null = null) {
  let value = initial;
  const storage: LauncherPreferencesStorage = {
    read: jest.fn(async () => value),
    write: jest.fn(async (next: string) => {
      value = next;
    }),
  };
  return { storage, current: () => (value === null ? null : JSON.parse(value)) };
}

describe('launcher preferences', () => {
  it('loads safe defaults when preferences are absent or invalid', () => {
    expect(parseLauncherPreferences(null)).toEqual(DEFAULTS);
    expect(parseLauncherPreferences('{invalid')).toEqual(DEFAULTS);
    expect(parseLauncherPreferences('{"schemaVersion":3,"favoritePackageNames":[]}')).toEqual(DEFAULTS);
    expect(parseLauncherPreferences('{"schemaVersion":2}')).toEqual(DEFAULTS);
  });

  it('upgrades v1 preferences to v2 defaults', () => {
    expect(parseLauncherPreferences(JSON.stringify({ schemaVersion: 1, favoritePackageNames: ['com.example.app'] }))).toEqual({
      schemaVersion: 2,
      favoritePackageNames: ['com.example.app'],
      homeLayout: null,
      amountsVisible: true,
    });
  });

  it('parses a v2 layout and balance visibility', () => {
    expect(
      parseLauncherPreferences(
        JSON.stringify({ schemaVersion: 2, favoritePackageNames: [], homeLayout: layout, amountsVisible: false }),
      ),
    ).toEqual({ schemaVersion: 2, favoritePackageNames: [], homeLayout: layout, amountsVisible: false });
  });

  it('drops a corrupt layout but keeps favourites', () => {
    const overlapping = {
      columns: 4,
      items: [
        { id: 'wallet', x: 0, y: 0, w: 2, h: 2 },
        { id: 'phone', x: 1, y: 0, w: 2, h: 2 },
      ],
    };
    const parsed = parseLauncherPreferences(
      JSON.stringify({ schemaVersion: 2, favoritePackageNames: ['com.example.app'], homeLayout: overlapping }),
    );
    expect(parsed.homeLayout).toBeNull();
    expect(parsed.favoritePackageNames).toEqual(['com.example.app']);
  });

  describe('parseHomeLayout', () => {
    const withItems = (...items: unknown[]) => ({ columns: 4, items });

    it('accepts valid layouts, including an empty one', () => {
      expect(parseHomeLayout(layout)).toEqual(layout);
      expect(parseHomeLayout(withItems())).toEqual({ columns: 4, items: [] });
    });

    it('rejects the whole layout for any invalid item', () => {
      const wallet = { id: 'wallet', x: 0, y: 0, w: 2, h: 2 };
      expect(parseHomeLayout(null)).toBeNull();
      expect(parseHomeLayout({ columns: 3, items: [] })).toBeNull();
      expect(parseHomeLayout(withItems(wallet, { id: 'calendar', x: 2, y: 0, w: 2, h: 2 }))).toBeNull();
      expect(parseHomeLayout(withItems({ id: 'wallet', x: 0, y: 0, w: 3, h: 1 }))).toBeNull();
      expect(parseHomeLayout(withItems({ id: 'wallet', x: 3, y: 0, w: 2, h: 2 }))).toBeNull();
      expect(parseHomeLayout(withItems(wallet, { ...wallet, y: 4 }))).toBeNull();
      expect(parseHomeLayout(withItems({ ...wallet, x: '0' }))).toBeNull();
    });
  });

  it('normalizes persisted package identities', () => {
    expect(
      parseLauncherPreferences(
        JSON.stringify({
          schemaVersion: 1,
          favoritePackageNames: ['com.example.app', '', 'com.example.app', 42],
        }),
      ).favoritePackageNames,
    ).toEqual(['com.example.app']);
  });

  it('limits persisted favorites to four apps', () => {
    expect(
      parseLauncherPreferences(
        JSON.stringify({
          schemaVersion: 1,
          favoritePackageNames: ['one', 'two', 'three', 'four', 'five'],
        }),
      ).favoritePackageNames,
    ).toEqual(['one', 'two', 'three', 'four']);
  });

  it('saving a layout keeps favourites and saving favourites keeps the layout', async () => {
    const { storage, current } = createMemoryStorage(
      JSON.stringify({ schemaVersion: 1, favoritePackageNames: ['com.example.app'] }),
    );
    const repository = createLauncherPreferencesRepository(storage);

    await repository.save({ homeLayout: layout });
    expect(current()).toEqual({
      schemaVersion: 2,
      favoritePackageNames: ['com.example.app'],
      homeLayout: layout,
      amountsVisible: true,
    });

    await repository.save({ favoritePackageNames: ['one', 'two', 'three', 'four', 'five'] });
    expect(current().homeLayout).toEqual(layout);
    expect(current().favoritePackageNames).toEqual(['one', 'two', 'three', 'four']);

    await repository.save({ amountsVisible: false });
    expect(current().amountsVisible).toBe(false);
    expect(current().homeLayout).toEqual(layout);

    await repository.save({ homeLayout: null });
    expect(current().homeLayout).toBeNull();
  });

  it('concurrent patches from different callers do not overwrite each other', async () => {
    const { storage, current } = createMemoryStorage();
    const repository = createLauncherPreferencesRepository(storage);

    await Promise.all([
      repository.save({ favoritePackageNames: ['com.example.app'] }),
      repository.save({ homeLayout: layout }),
    ]);

    expect(current().favoritePackageNames).toEqual(['com.example.app']);
    expect(current().homeLayout).toEqual(layout);
  });

  it('serializes writes so rapid updates cannot persist stale preferences', async () => {
    let finishFirstWrite: () => void = () => undefined;
    const writes: string[] = [];
    const storage: LauncherPreferencesStorage = {
      read: jest.fn().mockResolvedValue(null),
      write: jest
        .fn()
        .mockImplementationOnce(
          (value: string) =>
            new Promise<void>((resolve) => {
              writes.push(value);
              finishFirstWrite = resolve;
            }),
        )
        .mockImplementationOnce(async (value: string) => {
          writes.push(value);
        }),
    };
    const repository = createLauncherPreferencesRepository(storage);

    const first = repository.save({ favoritePackageNames: ['com.example.first'] });
    const second = repository.save({ favoritePackageNames: ['com.example.second'] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writes).toHaveLength(1);
    finishFirstWrite();
    await Promise.all([first, second]);

    expect(writes.map((value) => JSON.parse(value).favoritePackageNames)).toEqual([
      ['com.example.first'],
      ['com.example.second'],
    ]);
  });

  it('keeps accepting writes after a failed one', async () => {
    const { storage, current } = createMemoryStorage();
    (storage.write as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    const repository = createLauncherPreferencesRepository(storage);

    await expect(repository.save({ amountsVisible: false })).rejects.toThrow('disk full');
    await repository.save({ favoritePackageNames: ['com.example.app'] });
    expect(current()).toEqual({ ...DEFAULTS, favoritePackageNames: ['com.example.app'] });
  });
});
