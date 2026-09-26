# Home widgets plan

Status: approved scope. Sections 1 to 4 implemented; section 5 not yet implemented. Branch: `feat/home-widgets`. No Linear ticket; commits use `{type}: {description}`.

This document is one large ticket split into sub-tickets numbered 1 to 5. Each section is written so that a fresh model can implement it without the conversation that produced this plan. Read "Scope decisions" and "Shared context" before any section. Section 2 depends on section 1. Section 3 depends on section 2. Section 4 depends on section 3. Section 5 depends on sections 3 and 4.

Priority: sections 1 to 4 are the deliverable: the home becomes a grid of widgets with an edit mode that matches the mockup. Section 5 adds dragging and is last because it is the riskiest gesture work; tap-to-add from section 4 already covers adding widgets without it.

Reference: the "Edit mode (redesign)" Claude Design mock, section 4a, supplied as a screenshot, and `docs/screenshots/sodera-home-redesign.png` for the normal home (mock 3a). The mock's caption: the selected widget gets a blue outline, resize handles, and a size tag; the other widgets fade back; empty grid cells show a dashed "+" drop target; each item in the list shows the grid sizes it supports, and those numbers are the spec to build to.

## Scope decisions

- The home is a 4-column grid. Each widget occupies a rectangle of whole cells. Widgets fill the cell rectangle they are given; they do not size themselves.
- Widgetizing must not change the home. The default layout reproduces the pre-widget home (`sodera-home-redesign.png`) in the same order and arrangement: Identity; Wallet and Phone side by side; Swap and Earn side by side across the full width; the full-width Pulse with price cards and sparklines; Activity. Other sizes exist only as edit-mode options.
- Six widgets, with the sizes from the mock. `phone` is not in the mock's sheet because it is the launcher's app-drawer entry and cannot be removed; it is still a grid item that can be moved and resized.

  | Widget id | Title | Subtitle | Sizes (w×h) | Default | Removable | Data |
  | --- | --- | --- | --- | --- | --- | --- |
  | `identity` | Identity | ENS name, address, links | 4×2 | 4×2 | yes | onboarding profile |
  | `wallet` | Wallet | Balance, opens wallet | 2×2, 4×1 | 2×2 | yes | `walletHomeLiveProvider` |
  | `phone` | Phone | All your apps | 2×2, 4×1 | 2×2 | no | none; opens `/phone` |
  | `market-pulse` | Market pulse | BTC, ETH · 24h | 4×2, 2×2 | 4×2 | yes | `loadMarketPrices`, `loadMarketTrends` |
  | `swap-earn` | Swap / Earn | Quick entry points | 4×1, 2×2, 2×1 | 4×1 | yes | none; opens `/swap`, `/earn` |
  | `activity` | Activity | Latest transaction | 4×1 | 4×1 | yes | `multiBaasTransactionActivityProvider` |

  `swap-earn` 4×1 is not in the mock's sheet. It is added so the default layout can keep Swap and Earn side by side across the full width, as on the pre-widget home.

- One instance of each widget. The sheet dims a widget that is already on the home.
- No intent bar widget. The mock's intent bar is a reference only; Dera stays the header button that opens `/assistant`, and its chat composer stays inside the assistant. Every widget is always available, so there is no availability context.
- No auto-compaction. Empty cells stay empty, as on Android's home. Row count is derived from the lowest item, so trailing empty rows disappear on their own.
- Layout is persisted in the existing launcher preferences JSON. No Kotlin change. `homeLayout: null` means "use the default layout for the current widget availability"; the layout is persisted only after the first edit.
- The balance-visibility toggle moves from `WalletHome` local state into the same preferences, so the home widget and the wallet screen agree.
- Entering edit mode uses one gesture-handler long-press on the whole grid, hit-tested against the cells. A `Pressable.onLongPress` per cell never fires, because each widget's own buttons take the touch first; when the grid long-press activates, gesture handler cancels the widget's touch, so the tile does not also open. Settings gets an "Edit home" row because long-press is undiscoverable.
- Adding a widget is tap-to-add in section 4; dragging from the sheet is section 5.
- Out of scope: Android app widgets (`AppWidgetHost`), duplicates, folders, wallpaper, per-widget settings, and animations beyond drag follow and the fade.

## Shared context

### Repository facts

- `app/` is the Expo SDK 57 app, React Native 0.86, React 19, TypeScript 6. Run `pnpm test`, `pnpm lint`, and `npx tsc --noEmit` from `app/`. Tests use `jest-expo` and `@testing-library/react-native`; component tests mock data modules with `jest.mock('@/launcher/market-prices', ...)` and select by accessibility role and label. There is no `babel.config.js`; `babel-preset-expo` applies the worklets plugin.
- `react-native-gesture-handler` 2.32 and `react-native-reanimated` 4.5 are installed. Reanimated is used in `app/src/components/animated-icon.tsx`, which calls `scheduleOnRN` from `react-native-worklets` instead of `runOnJS`. Nothing renders `GestureHandlerRootView` yet; `app/src/app/_layout.tsx` must wrap the navigator in it before any `GestureDetector` is used.
- The home route is `app/src/app/index.tsx`. It renders `LauncherScreen` (`app/src/components/launcher-screen.tsx`: header with brand, Dera and settings buttons; a `ScrollView`; the identity card; the Wallet and Phone tiles; a `homeContent` slot; the "swipe up for phone" area) and passes `LauncherHome` (`app/src/components/launcher-home.tsx`: Swap and Earn tiles, `MarketPulse` with `Price` and `Sparkline`, the Activity row) as `homeContent`. `launcher-home.test.tsx` covers the market states.
- The onboarding profile comes from `useOnboarding()`: `access.status === 'complete'` gives `access.profile` with `account: Address` and `username`.
- Launcher preferences: `app/src/launcher/launcher-preferences.ts` defines `LauncherPreferences`, `parseLauncherPreferences`, and `createLauncherPreferencesRepository(storage)` with `load()` and `save(...)`, which serialises writes through a promise chain. Before section 1 the schema was `schemaVersion: 1` with only `favoritePackageNames` and `save(favoritePackageNames)`; section 1 moves it to v2 (see 1.3). Storage is `launcherPreferencesNativeStorage` (`launcher-preferences-native-storage.ts`): `read`, `write`, and `subscribe`, backed by `SoderaLauncher.readLauncherPreferencesAsync` / `writeLauncherPreferencesAsync` (Kotlin `SharedPreferences`, one opaque JSON string) and `localStorage` on web. The only `save` caller is `launcher-settings-screen.tsx`; `phone-screen.tsx` also creates a repository but only calls `load()` for the dock favourites.
- Wallet data: `walletHomeLiveProvider` (`app/src/wallet/wallet-home-live.ts`) exposes `load()` returning `WalletHomeResult` (`ready`, `indexing`, `empty`) and `subscribeToChanges`. `getPortfolioTotalUsdCents(snapshot)` in `wallet-home.ts` returns cents or `null`. `WalletHome` (`components/wallet-home.tsx`) keeps `amountsVisible` in `useState` and renders hidden amounts as `$••••••` through `FinancialAmount`.
- Activity data: `multiBaasTransactionActivityProvider` (`app/src/wallet/transaction-activity-multibaas.ts`) returns `TransactionActivityResult` (`ready`, `partial`, `empty`) with items sorted newest first; `TransactionActivityTransfer` has `direction`, `asset`, `amount`, `counterparty`, `timestamp`; `TransactionActivityOperation` has `success`, `sponsored`. `transactions-screen.tsx` has `formatTimestamp` and `describeOperation` helpers worth reusing.
- Market data: `loadMarketPrices(signal)` and `loadMarketTrends(signal)` in `app/src/launcher/market-prices.ts`. `MarketPulse` in `launcher-home.tsx` owns the refresh-on-foreground, stale, error, and retry logic.
- Design tokens: `platinum` in `app/src/constants/theme.ts`. Selection accent is `colors.cyan` (`#38bdf8`). Mono labels use `typography.micro` / `typography.label` (JetBrains Mono). Tiles use `radius.xl`, `colors.surfaceLowest`, `colors.border`; the Wallet tile is `colors.platinum` with `platinum.shadow.raised`.

### Grid facts

- `columns = 4`, `gap = spacing.md` (12). Column width is `(gridWidth − 3 × gap) / 4`. Positions and sizes are whole cells, but rows are not a fixed height: each row takes its height from the widgets in it, so every widget keeps its pre-widget height and there is no empty space inside or between tiles. A fixed row height cannot do this, because today's heights (Identity 106, Wallet and Phone 148, Swap / Earn 110, Pulse 194, Activity 66) share no common unit.
- Every size in the registry declares its natural height in dp (`heights`, keyed `${w}x${h}`). `rowHeights(items, heightOf, rows)` sets each single-row item's row to at least its height, then spreads any missing height of each multi-row item evenly over its rows. Rows nothing occupies, including the extra edit-mode row, use `HOME_GRID.rowHeight` (72).
- Cell rectangle for `{ x, y, w, h }`: `left = x × (columnWidth + gap)`, `top = rowTop(y)` (the sum of the heights of rows above plus one gap each), `width = w × columnWidth + (w − 1) × gap`, `height = rowTop(y + h) − rowTop(y) − gap`.
- Default layout:

  | Item | x | y | w | h |
  | --- | --- | --- | --- | --- |
  | `identity` | 0 | 0 | 4 | 2 |
  | `wallet` | 0 | 2 | 2 | 2 |
  | `phone` | 2 | 2 | 2 | 2 |
  | `swap-earn` | 0 | 4 | 4 | 1 |
  | `market-pulse` | 0 | 5 | 4 | 2 |
  | `activity` | 0 | 7 | 4 | 1 |

## Section 1: Layout engine, widget registry, preferences v2

### Goal

Pure TypeScript for the grid: a layout model with collision-checked mutations, a registry describing every widget, and a preferences schema that persists the layout and the balance-visibility flag.

### Outcome

`home-layout.ts` and `widget-registry.ts` exist with full unit tests. Preferences parse v1 and v2 payloads to the v2 shape, `save` takes a partial update, and the settings screen still saves favourites unchanged.

### Dependencies

None.

### Files

Create:
- `app/src/launcher/home-layout.ts` — types, geometry, and mutations.
- `app/src/launcher/home-layout.test.ts`
- `app/src/launcher/widget-registry.ts` — widget definitions and the default layout.
- `app/src/launcher/widget-registry.test.ts`

Modify:
- `app/src/launcher/launcher-preferences.ts` — schema v2, `parseHomeLayout`, partial `save`.
- `app/src/launcher/launcher-preferences.test.ts`
- `app/src/components/launcher-settings-screen.tsx` — `save({ favoritePackageNames: next })`.

### Steps

**1.1 Layout model.**

`app/src/launcher/home-layout.ts` exports:

```ts
export type WidgetId = 'identity' | 'wallet' | 'phone' | 'market-pulse' | 'swap-earn' | 'activity';
export type WidgetSize = { w: number; h: number };
export type HomeLayoutItem = { id: WidgetId; x: number; y: number; w: number; h: number };
export type HomeLayout = { columns: 4; items: HomeLayoutItem[] };
export const HOME_GRID = { columns: 4, rowHeight: 72, gap: 12 } as const; // rowHeight: empty rows only
export type GridMetrics = { columnWidth: number; gap: number; rowHeights: readonly number[] }; // rows past the end use HOME_GRID.rowHeight

export function rowCount(layout: HomeLayout): number;                   // max(y + h), 0 when empty
export function fits(layout: HomeLayout, rect: HomeLayoutItem): boolean; // in bounds and no overlap with items other than rect.id
export function placeWidget(layout: HomeLayout, id: WidgetId, size: WidgetSize): HomeLayout; // first free slot row-major, else appended below
export function moveWidget(layout: HomeLayout, id: WidgetId, x: number, y: number): HomeLayout | null;
export function resizeWidget(layout: HomeLayout, id: WidgetId, size: WidgetSize): HomeLayout | null;
export function removeWidget(layout: HomeLayout, id: WidgetId): HomeLayout;
export function cellRect(item: HomeLayoutItem, metrics: GridMetrics): { left: number; top: number; width: number; height: number };
export function slotAt(point: { x: number; y: number }, size: WidgetSize, metrics: GridMetrics): { x: number; y: number }; // nearest slot, clamped to columns
export function columnWidth(gridWidth: number): number;
export function rowHeights(items: readonly HomeLayoutItem[], heightOf: (item: HomeLayoutItem) => number, rows: number, gap?: number): number[];
export function rowTop(metrics: GridMetrics, y: number): number;
export function gridHeight(metrics: GridMetrics, rows: number): number;
```

Every function is pure and returns a new layout. `moveWidget` and `resizeWidget` return `null` when the result would not fit; callers revert. `placeWidget` removes an existing item with the same id first. `x` may not exceed `columns − w`; `y` has no upper bound.

**1.2 Registry.**

`app/src/launcher/widget-registry.ts` exports:

```ts
export type WidgetDefinition = {
  id: WidgetId;
  title: string;
  subtitle: string;
  icon: { ios: string; android: string; web: string }; // SymbolView names
  sizes: readonly WidgetSize[];
  heights: Readonly<Record<string, number>>; // natural height in dp per size, keyed `${w}x${h}`
  defaultSize: WidgetSize;
  removable: boolean;
};
export const WIDGET_REGISTRY: readonly WidgetDefinition[];
export function getWidgetDefinition(id: WidgetId): WidgetDefinition;
export function isWidgetId(value: unknown): value is WidgetId;
export function supportsSize(definition: WidgetDefinition, size: WidgetSize): boolean;
export function widgetHeight(definition: WidgetDefinition, size: WidgetSize): number;
export function defaultHomeLayout(): HomeLayout; // the table in Grid facts
```

Titles, subtitles, sizes, and defaults come from the Scope decisions table. Icons reuse those already on the home: person, wallet, apps, `trending_up`, `swap_horiz`, history.

**1.3 Preferences v2.**

```ts
export type LauncherPreferences = {
  schemaVersion: 2;
  favoritePackageNames: string[];
  homeLayout: HomeLayout | null;
  amountsVisible: boolean;
};
export type LauncherPreferencesPatch = Partial<Omit<LauncherPreferences, 'schemaVersion'>>;
export type LauncherPreferencesRepository = {
  load(): Promise<LauncherPreferences>;
  save(patch: LauncherPreferencesPatch): Promise<void>; // read-modify-write, serialised through the existing write chain
};
export function parseHomeLayout(value: unknown): HomeLayout | null;
```

`parseLauncherPreferences` accepts `schemaVersion` 1 or 2. Missing `homeLayout` parses to `null`; missing `amountsVisible` parses to `true`. `parseHomeLayout` returns `null`, not a partial layout, when any item has an unknown id, a size the registry does not support, is out of bounds, overlaps another, or duplicates an id. `save` reads the current stored value inside the chain so two callers (settings favourites, home layout) never overwrite each other. Update the one caller in `launcher-settings-screen.tsx`.

### Tests

- `home-layout.test.ts`: `fits` rejects overlap and `x + w > 4`; `placeWidget` fills row-major, skips occupied cells, appends below when full, and replaces an existing instance; `moveWidget` and `resizeWidget` return `null` on collision and succeed when the only overlap is the item itself; `removeWidget` lowers `rowCount`; `cellRect` and `slotAt` round-trip for every cell.
- `widget-registry.test.ts`: `defaultHomeLayout` passes `fits` for every item and keeps the pre-widget arrangement; every definition's `defaultSize` is in `sizes`.
- `launcher-preferences.test.ts`: v1 JSON parses to v2 with `homeLayout: null` and `amountsVisible: true`; a corrupt or overlapping `homeLayout` parses to `null` while favourites survive; `save({ homeLayout })` keeps favourites and `save({ favoritePackageNames })` keeps the layout; the four-favourite cap still applies.

### Acceptance criteria

- `pnpm test`, `pnpm lint`, and `npx tsc --noEmit` pass.
- The settings screen pins and unpins apps exactly as before.

### Implementation notes

Implemented as specified. Additions beyond the spec that later sections can rely on:

- `home-layout.ts` also exports `GridCell` (`{ x, y }`, the type of `slotAt`'s result and of section 3's empty cells) and `CellRect` (`cellRect`'s result). `cellRect` accepts any `{ x, y, w, h }`, so empty cells and drop candidates can use it without an id.
- `fits` also rejects non-integer coordinates and `w` or `h` below 1.
- `placeWidget` scans rows `0..rowCount` inclusive, so the "append below" case falls out of the scan; a size wider than the grid, which the registry never produces, is placed at `x = 0` below everything.
- `parseLauncherPreferences` still requires `favoritePackageNames` to be an array for v1 and v2; anything else, including `schemaVersion: 3`, falls back to defaults.
- `save` normalises favourites (dedupe, four-app cap) but writes `homeLayout` as given; invalid layouts are caught by `parseHomeLayout` on the next load. A failed write rejects that `save` without blocking later ones.
- Known unrelated failure: `app/plugins/with-sodera-launcher.test.js` fails on `main` as well; `pnpm test` is otherwise green.

## Section 2: Home as a widget grid

### Goal

Render the home from a layout instead of fixed JSX: every tile becomes a widget component with one variant per supported size, positioned by a grid component.

### Outcome

With no persisted layout the home looks like `sodera-home-redesign.png`. `launcher-home.tsx` is gone. Balances hidden in the wallet screen are hidden on the home.

### Dependencies

Section 1.

### Files

Create:
- `app/src/launcher/use-launcher-preferences.ts` — `useLauncherPreferences(storage)` returning `{ preferences, save }`; loads once, subscribes to `storage.subscribe`, exposes `save(patch)`.
- `app/src/launcher/use-market-pulse.ts` — the state and refresh logic lifted out of `MarketPulse`.
- `app/src/components/home-grid.tsx` — measures width with `onLayout`, positions cells absolutely, renders widgets.
- `app/src/components/widgets/identity-widget.tsx` (4×2)
- `app/src/components/widgets/wallet-widget.tsx` (2×2, 4×1)
- `app/src/components/widgets/phone-widget.tsx` (2×2, 4×1)
- `app/src/components/widgets/swap-earn-widget.tsx` (4×1, 2×2, 2×1)
- `app/src/components/widgets/market-pulse-widget.tsx` (4×2, 2×2) with `Price` and `Sparkline` moved from `launcher-home.tsx`
- `app/src/components/widgets/activity-widget.tsx` (4×1)
- `app/src/components/widgets/*.test.tsx` — moved and new tests.

Modify:
- `app/src/components/launcher-screen.tsx` — remove the identity card and the Wallet and Phone tiles; keep the header, `ScrollView`, `homeContent`, and the swipe-up area.
- `app/src/app/index.tsx` — load preferences, render `HomeGrid` as `homeContent`.
- `app/src/app/_layout.tsx` — wrap the navigator in `GestureHandlerRootView` with `style={{ flex: 1 }}`.
- `app/src/components/wallet-home.tsx` and `app/src/app/wallet.tsx` — `amountsVisible` and `onToggleAmounts` become props fed from preferences.

Delete:
- `app/src/components/launcher-home.tsx`, `launcher-home.test.tsx` (tests move to the widget tests).

### Steps

**2.1 Widget contract.** Every widget is `function XWidget(props: { size: WidgetSize } & deps)`. Route callbacks and providers are props, as in `LauncherHome` and `WalletHome` today, so tests keep mocking the same modules. A widget switches on `size.w`/`size.h` and renders a variant; it never reads the layout or preferences.

**2.2 Grid.**

```ts
type HomeGridProps = {
  layout: HomeLayout;
  renderWidget(item: HomeLayoutItem): ReactNode;
  extraRows?: number;                    // section 3 renders +1 in edit mode
  renderEmptyCell?(cell: { x: number; y: number }): ReactNode; // section 3
  onLayoutMetrics?(metrics: GridMetrics): void;                // section 5
};
```

`HomeGrid` reads its width from `onLayout`, computes `columnWidth`, computes `rowHeights` from the items' `widgetHeight`, sets its own height to `gridHeight`, and renders each item in an absolutely positioned `View` from `cellRect`.

**2.3 Widgets.**
- `identity`: the current identity card verbatim, including the copy-address action, the presence dot, the placeholder social chips, and the arrow to `/wallet`.
- `wallet` 2×2: platinum tile with the icon, "Wallet", the portfolio total from `walletHomeLiveProvider` and `getPortfolioTotalUsdCents`, and an eye button toggling `amountsVisible`; hidden renders `$••••••`. Loading shows an `ActivityIndicator`; `empty`/`null` total shows "—"; a load error shows the previous subtitle "Your onchain life, one tap away". 4×1: a row with icon, "Wallet", the total, chevron.
- `phone` 2×2: the current Phone tile. 4×1: a row with icon, "Phone", "All your apps", chevron.
- `swap-earn` 4×1 (default): two side-by-side tiles (Swap, Earn), each with icon, title, and description, as on the pre-widget home. 2×2: the same two tiles stacked. 2×1: two side-by-side icon buttons with the title only.
- `market-pulse` 4×2 (default): today's heading, status pill, two price cards with sparklines, and the footnote. 2×2: the heading and two compact rows (ticker, price, change) with no sparkline or footnote. Both use `useMarketPulse()` and show the unavailable state with retry inside the cell.
- `activity`: the newest item from the provider as one row: icon, "Activity", then "Sent 0.01 ETH to 0x12…34 · 2h ago" or "Received …" or "Account operation · Sponsored"; "No activity yet" when empty; the previous subtitle on error; chevron to `/transactions`.

**2.4 Home route.** `index.tsx` calls `useLauncherPreferences(launcherPreferencesNativeStorage)`, uses `preferences.homeLayout ?? defaultHomeLayout()`, and maps widget ids to components with the same callbacks it passes today. Until preferences load, render the default layout.

### Tests

- Move the two market tests to `market-pulse-widget.test.tsx` and add a 2×2 render.
- `wallet-widget.test.tsx`: total shown, hidden as `$••••••` when `amountsVisible` is false, toggle calls back, empty result shows "—".
- `activity-widget.test.tsx`: newest transfer formatted, empty copy, error copy.
- `home-grid.test.tsx`: given a fixed width via `onLayout`, each item gets the `cellRect` position and its natural height.

### Acceptance criteria

- Fresh install: the home keeps the pre-widget arrangement of `sodera-home-redesign.png`: Swap and Earn side by side, then the full-width Pulse, then Activity. Cell heights may differ slightly.
- Existing install with v1 preferences: favourites survive; the home shows the default layout.
- Hide amounts in the wallet screen, go home: the wallet widget shows `$••••••`; relaunch keeps it hidden.
- Kill the network: market pulse shows its unavailable state with retry inside the cell; wallet and activity fall back to their subtitles; the grid does not reflow.
- Swipe up for Phone still works.

### Implementation notes

Implemented as specified and checked on an Android device: the default layout renders, and hiding amounts on the home or in the wallet screen syncs both ways. Differences and additions:

- `LauncherScreen` no longer takes `accountAddress`, `username`, or `onOpenWallet`.
- `WalletHome` takes `amountsVisible` and `onToggleAmounts` as optional controlled props and falls back to local state when they are omitted, so its existing tests are unchanged.
- The Activity widget reads `pendingSends.provider`, the same provider as `/transactions`. It wraps `multiBaasTransactionActivityProvider` and also shows sends that are still pending.
- Wallet 2×2: the eye button takes the place of the chevron. The tile's open action and the eye are sibling `Pressable`s rather than nested ones, so screen readers can reach both. The 4×1 row has no toggle but respects the setting.
- Default layout: first built with Swap / Earn and Market pulse as 2×2 tiles side by side, as this plan originally specified. That changed the home, so the defaults were corrected to 4×1 and 4×2, and `swap-earn` gained the 4×1 size.
- Market pulse 4×2: to fit 156 dp, the price cards drop the "24h change" caption, and the error state shows a one-line "Last prices · time" note with the retry link in place of the footnote. The 2×2 variant is a bordered tile; the 4×2 variant keeps today's unboxed look.
- Row heights: first built with a fixed 72 dp row, which made Identity 156 tall (an empty band inside the card) and shrank Swap / Earn and the Pulse. Replaced by content-sized rows (see Grid facts): each size declares its pre-widget height, and on the device every widget now matches `main` in size and position. `swap-earn` 4×1 and `market-pulse` 4×2 use the pre-widget tile and pulse designs, including the "24h change" caption.
- Known difference: the grid uses one 12 dp gap everywhere, where the pre-widget home had 16 dp above and below the Pulse.
- Intent bar removed: the plan originally had an `intent-bar` widget (default row 0, shown only with the agent configured) and a section for it. It was a reference from the mock, not a feature, so the widget, its section, and the availability context (`WidgetContext`, `isAvailable`) are gone. Stored layouts that name `intent-bar` fail `parseHomeLayout` and fall back to the default.
- `@testing-library/react-native` 14 makes `fireEvent` async; new tests `await` it to avoid overlapping `act()` calls.
- Tests added beyond the plan: `identity-widget.test.tsx`, and `swap-earn-widget.test.tsx`, which also covers `PhoneWidget` in both sizes. `launcher-screen.test.tsx` now covers only the header, home content, and swipe-up.

## Section 3: Edit mode with resize and remove

### Goal

Long-press enters an edit mode that matches mock 4a: `EDIT HOME` header with a Done pill, selection outline, size tag, × remove, resize handles, faded siblings, dashed `+` empty cells.

### Outcome

A user can resize any widget through its supported sizes and remove any removable widget; changes persist and survive relaunch.

### Dependencies

Section 2.

### Files

Create:
- `app/src/components/home-edit-chrome.tsx` — outline, size tag, × button, handles, empty cell.
- `app/src/components/home-edit-chrome.test.tsx`

Modify:
- `app/src/components/home-grid.tsx` — `editing`, `selectedId`, `onSelect`, `onRemove`, `onResize` props; wraps widgets in `pointerEvents="none"` while editing; renders `extraRows={1}` and empty cells.
- `app/src/components/launcher-screen.tsx` — `editing` and `onDone` props switch the header to `EDIT HOME` / `Done`; the swipe-up area is disabled while editing.
- `app/src/app/index.tsx` — edit state, `BackHandler` exit, persistence through `save({ homeLayout })`.
- `app/src/components/launcher-settings-screen.tsx` and `app/src/app/settings.tsx` — an "Edit home" row above "Pinned apps" that navigates to `/?edit=1`; `index.tsx` reads the param with `useLocalSearchParams` and enters edit mode.

### Design

- Header: left `EDIT HOME` in `typography.label`, `letterSpacing: 3`, `colors.platinum`; right a `Done` pill (`colors.platinum` background, `colors.onPlatinum` text, `radius.full`, 44 tall). Brand, Dera, and settings buttons are hidden while editing.
- Selected cell: a 2 px `colors.cyan` outline drawn as a sibling `View` 4 px outside the cell with `radius.xl + 4`. Size tag: `w×h` in `typography.labelSmall`, `colors.onPlatinum` on `colors.cyan`, `radius.sm`, anchored top-right and overlapping the outline. Remove button: 36 dp `colors.platinum` circle with a dark ×, anchored top-left, hidden when `removable` is false. Handles: a 6×28 `colors.cyan` pill centred on the right edge and a 28×6 pill centred on the bottom edge, each with a 44 dp hit slop.
- Unselected widgets: `opacity: 0.5`. Empty cells (including the extra row): 1 px dashed `colors.borderLit` border, `radius.xl`, a `+` in `colors.mutedText`; tapping one calls `onAddAt(cell)` (section 4 opens the sheet; until then it is a no-op).
- A long-press anywhere on the grid enters edit mode with the widget under the finger selected, or nothing selected on empty space. In edit mode each cell is a `Pressable` whose `onPress` selects.

### Steps

**3.1 Chrome components** in `home-edit-chrome.tsx`: `SelectionOutline`, `SizeTag`, `RemoveButton`, `ResizeHandle({ edge: 'right' | 'bottom' })`, `EmptyCell`. Pure presentation with callbacks.

**3.2 Resize.** Each handle carries a `Gesture.Pan()` from `react-native-gesture-handler`. On update, translate the handle with a shared value. On end, compute the candidate size: right handle `w = round((width + translationX + gap) / (columnWidth + gap))`; bottom handle: the `h` whose bottom edge `rowTop(y + h) − gap` is nearest to `height + translationY`; snap to the nearest entry in the definition's `sizes` on that axis; call `resizeWidget`; on `null` reset the shared value and do nothing. Use `scheduleOnRN` to reach JS, as `animated-icon.tsx` does. Tapping the size tag cycles through `sizes` in order and applies the first that fits, as a fallback for small targets.

**3.3 Remove.** × calls `removeWidget` and clears the selection.

**3.4 Persistence and exit.** `index.tsx` holds `layout` in state seeded from preferences; every successful mutation sets state and calls `save({ homeLayout })`. `Done`, the Android back button, and navigating away exit edit mode; the layout is already saved.

### Tests

- `home-edit-chrome.test.tsx`: the size tag renders `2×2`; × calls `onRemove`; `RemoveButton` is absent when not removable; tapping the tag calls `onCycleSize`.
- `home-grid.test.tsx`: in edit mode, pressing a cell calls `onSelect`; the extra row renders four empty cells; widgets are wrapped in `pointerEvents="none"`.
- Pan gestures are verified on a device, not in Jest.

### Acceptance criteria

- Long-press Wallet: cyan outline, `2×2` tag, ×, two handles; Phone and the rest fade.
- Drag Market pulse's right handle left: it becomes 2×2; drag it back: 4×2 again. Drag Wallet's right handle: 4×1 would overlap Phone, so it snaps back.
- × on Market pulse removes it; relaunch: still gone.
- Phone shows no ×.
- Done and the back button exit; the "Edit home" row in Settings enters.

### Implementation notes

Implemented and checked on an Android device: long-press on Wallet enters edit mode with the outline, `2×2` tag, ×, and both handles, and the tile does not open; Market pulse's right handle resizes it to 2×2, showing dashed `+` cells in the freed space, and back to 4×2; Wallet's right handle snaps back because 4×1 would overlap Phone; Phone has no ×; the back button and Done exit; the Settings row enters. Removing a widget was not tried on the device, because nothing can put it back until section 4; it is covered by unit tests. Differences and additions:

- Long-press: one `Gesture.LongPress()` (450 ms) on the grid, hit-tested with `cellRect`, replaces the per-cell `Pressable.onLongPress` (see Scope decisions). It is disabled while editing.
- Faded siblings: widgets fade only while one is selected. Entering from Settings selects nothing, and fading everything made the whole home look disabled.
- Handles: shown only on an axis where the widget has more than one supported size. Market pulse gets a right handle only; Activity gets none. Snapping uses `nearestSupportedSize` and the size tag uses `sizesAfter`, both in `widget-registry.ts`.
- Header: the Done pill is 38 tall like the header buttons, with a hit slop to 44, so the header does not change height on entering edit mode. The swipe-up area dims to 0.3 and ignores swipes while editing.
- Edit mode adds 16 dp of top padding to the scroll content so the × and size tag of a top-row widget are not clipped.
- Editing waits for preferences to load, so the first save merges into what is stored. `useLauncherPreferences.save` now reloads the stored preferences if a write fails, so a failed change does not stay on screen.
- Settings: `LauncherSettingsScreen` takes an optional `onEditHome`; `settings.tsx` calls `router.dismissTo({ pathname: '/', params: { edit: '1' } })`, and `index.tsx` clears the param after entering edit mode.
- `onAddAt` on the `+` cells is a no-op until section 4.
- Jest: `app/jest.setup.js` (added to `setupFiles`) loads the gesture-handler jest setup and the reanimated and worklets mocks. The worklets mock runs `scheduleOnRN` callbacks in a microtask, so tests `await Promise.resolve()` after `fireGestureHandler`. Handle drags and the grid long-press are unit-tested with `fireGestureHandler` in addition to the device check.

## Section 4: Sodera widgets sheet with tap to add

### Goal

The bottom sheet from mock 4a listing every available widget with its supported sizes, and adding one with a tap.

### Outcome

Any removed widget can be put back.

### Dependencies

Section 3.

### Files

Create:
- `app/src/components/widget-sheet.tsx`
- `app/src/components/widget-sheet.test.tsx`

Modify:
- `app/src/app/index.tsx` — sheet open state, `onAdd`.
- `app/src/components/home-grid.tsx` — `+` cells call `onAddAt`.

### Design

A plain reanimated `View` anchored to the bottom, no sheet library: 55 % of the window height, `colors.surface` with a top `radius.xl`, a 36×4 grab handle, title "Sodera widgets" in `typography.cardTitle`, and the hint `drag onto home` in `typography.micro` `colors.mutedText` on the right. Rows: 44 dp icon circle (`colors.glassRaised`, the definition's icon), title in `typography.bodySmall` semibold, subtitle in `typography.caption`, and size chips on the right (`2×2 · 4×1` in `typography.labelSmall`, `colors.emerald` on `colors.emeraldWash`, `radius.sm`). A row already on the home renders at 0.5 opacity with the chip text replaced by "On home" and is not pressable. Dragging the handle down or tapping outside collapses it to the handle; tapping the handle or an empty cell opens it. Entering edit mode opens it; leaving closes it.

### Steps

**4.1 Sheet component.** Props: `{ definitions: WidgetDefinition[]; placedIds: Set<WidgetId>; open: boolean; onOpenChange(open): void; onAdd(id): void }`. Definitions are the removable entries of `WIDGET_REGISTRY`; Phone cannot be removed, so it would always read "On home".

**4.2 Tap to add.** `onAdd(id)` calls `placeWidget(layout, id, definition.defaultSize)`, selects the new item, saves, and scrolls the `ScrollView` to the new cell when it is below the fold (`scrollTo` using `cellRect`). `onAddAt(cell)` from an empty cell opens the sheet and remembers the cell; the next `onAdd` tries `{ ...cell, ...defaultSize }` through `fits` first and falls back to `placeWidget`.

### Tests

- `widget-sheet.test.tsx`: available definitions render with their size chips; a placed widget shows "On home" and is disabled; pressing a row calls `onAdd` with its id.

### Acceptance criteria

- Remove Activity, open the sheet, tap Activity: it returns to the first free 4×1 slot and is selected.
- Wallet shows "On home" while placed.
- Tap a `+` cell, then a widget that fits there: it lands in that cell.

### Implementation notes

Implemented as specified. Not yet checked on a device; the acceptance criteria above are the manual test. Differences and additions:

- The sheet lists removable widgets only, so Phone is not in it (see 4.1 and Scope decisions).
- The header hint reads "tap to add" until section 5 adds dragging; section 5 changes it to the mock's "drag onto home".
- Adding a widget collapses the sheet so the new, selected widget is visible, and scrolls the home only when the widget is outside the area above the collapsed sheet.
- `addWidget(layout, id, size, preferred)` in `home-layout.ts` holds the "chosen `+` cell, else first free slot" rule so it is unit-tested; `index.tsx` calls it.
- `LauncherScreen` gained `overlay` (the sheet), `contentInsetBottom` (room for the 32 dp collapsed handle in edit mode), `scrollRef`, and `onScrollMetrics` (offset and viewport height), which section 5 also needs.
- `layoutRowHeights(items, rows)` in `widget-registry.ts` is shared by `HomeGrid` and the scroll-into-view calculation. `WidgetDefinition.icon` is typed as `SymbolViewProps['name']`.
- The sheet's open and collapsed positions animate with a reanimated `withTiming`; the handle follows a drag and snaps at 40 dp. While open, a transparent backdrop over the screen collapses it on tap.

## Section 5: Drag to move and drag from the sheet

### Goal

Move a selected widget by dragging, and drag a sheet row onto the grid.

### Outcome

Both drag paths snap to a free slot or revert, and the layout persists.

### Dependencies

Sections 3 and 4.

### Files

Modify:
- `app/src/components/home-grid.tsx` — `Gesture.Pan` on the selected cell; `onLayoutMetrics`; a highlighted candidate slot.
- `app/src/components/widget-sheet.tsx` — `Gesture.Pan` on rows; collapses while dragging; reports the drop point.
- `app/src/components/launcher-screen.tsx` — `scrollEnabled` driven by drag state; exposes the `ScrollView` ref and scroll offset.

### Steps

**5.1 Move.** `Gesture.Pan().minDistance(8)` on the selected cell body. The cell follows the finger through `translateX/Y` shared values. On end: `slotAt({ x: left + translationX, y: top + translationY }, size, metrics)` then `moveWidget`; on `null` spring back. While active, `scrollEnabled` is false (`scheduleOnRN` to a state setter). The candidate slot is highlighted with a `colors.cyanWash` fill when `fits` succeeds, `colors.negativeWash` otherwise.

**5.2 Drag from the sheet.** On pan start the sheet collapses to its handle so the grid is visible; the row's icon and title float under the finger in a portal-like `View` at the root. The grid measures its window position with `measureInWindow` on drag start and reads the current scroll offset from the `ScrollView`'s `onScroll`. On end, the drop point in grid coordinates is `(absoluteX − gridLeft, absoluteY − gridTop + scrollOffset)`; `slotAt` with the default size, then `fits`; on success `placeWidget`-style insertion at that slot, otherwise revert and reopen the sheet. Auto-scroll while dragging is out of scope.

### Tests

Device only. `react-native-gesture-handler/jest-utils` (`fireGestureHandler`) may be used for `moveWidget` wiring if cheap; do not spend time on it.

### Acceptance criteria

- Move Swap / Earn below Activity; relaunch: it stays.
- Dropping onto an occupied slot springs back.
- Drag Activity from the sheet onto an empty 4×1 row: it lands there and is selected.
- Scrolling still works when nothing is being dragged, on Android and on web.

## Open verifications

| Question | Resolved by | Consumers |
| --- | --- | --- |
| Declared widget heights match the pre-widget home | Section 2 device check: resolved, all widgets match `main` | all |
| The grid long-press does not conflict with tile taps or with the resize pans | Section 3 device check: resolved; long-press is disabled while editing | sections 3, 5 |
| `pointerEvents="none"` on widgets in edit mode still lets the cell `Pressable` receive taps on Android | Section 3 device check: resolved | sections 3, 4 |
| `measureInWindow` plus scroll offset gives correct drop slots on web | Section 5 | section 5 |

## Sources

- Claude Design mock "Edit mode (redesign)", section 4a (screenshot supplied by the user), and `docs/screenshots/sodera-home-redesign.png` (mock 3a).
- `docs/DESIGN.md` for the Platinum Fluid tokens and `app/src/constants/theme.ts` for their values.
- `docs/hackathon-decisions.md`, "Launcher": balances and the portfolio total on the home with a visibility toggle; widgets were deferred there and are un-deferred by this plan.
- react-native-gesture-handler 2.x `Gesture.Pan` and `GestureDetector` API; react-native-reanimated 4 shared values; `scheduleOnRN` from `react-native-worklets` as used in `app/src/components/animated-icon.tsx`.
- `docs/plans/multibaas-integration.md` for the plan structure.
