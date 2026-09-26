---
name: Platinum Fluid
colors:
  surface: '#121318'
  surface-dim: '#121318'
  surface-bright: '#38393f'
  surface-container-lowest: '#0d0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e1f25'
  surface-container-high: '#292a2f'
  surface-container-highest: '#34343a'
  on-surface: '#e3e1e9'
  on-surface-variant: '#c4c7c9'
  inverse-surface: '#e3e1e9'
  inverse-on-surface: '#2f3036'
  outline: '#8e9193'
  outline-variant: '#444749'
  surface-tint: '#c5c6c8'
  primary: '#ffffff'
  on-primary: '#2e3132'
  primary-container: '#e1e2e4'
  on-primary-container: '#626566'
  inverse-primary: '#5c5f60'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffffff'
  on-tertiary: '#00354a'
  tertiary-container: '#c4e7ff'
  on-tertiary-container: '#006c93'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e2e4'
  primary-fixed-dim: '#c5c6c8'
  on-primary-fixed: '#191c1e'
  on-primary-fixed-variant: '#444749'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#121318'
  on-background: '#e3e1e9'
  surface-variant: '#34343a'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.03em
  headline-xl-mobile:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 24px
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-tablet: 1rem
  margin: 1rem
  margin-tablet: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style
The design system manifests an ultra-refined, futuristic mobile operating surface engineered for power users and onchain natives. It dissolves the friction between daily smartphone utility and decentralized technology, transforming the primary home surface into an ambient, context-aware command center.

The aesthetic philosophy centers on **Platinum Fluid Minimalist**: deep astronomical voids punctuated by cold platinum luminescence, ethereal optics, and sub-pixel structural borders. The interface avoids loud skeumorphic mimicry in favor of precise optical materials—translucent frosted membranes, atmospheric cyan-emerald radial fields, and micro-precision typography. The emotional posture is calm, authoritative, high-bandwidth, and relentlessly modern.

## Colors
The palette leverages high-contrast luminescence over an abyss of obsidian and titanium shades.

- **Canvas Foundation**: Pure Obsidian Void (`#090A0F`, `#0D0E14`) provides infinite visual depth, saving battery life on OLED displays and serving as the darkroom canvas.
- **Surface Elevation**: Dark Titanium (`#12131C`, `#181926`) structures content tiers, overlaid with ultra-sheer white alpha values (`rgba(255, 255, 255, 0.04)` to `0.07`).
- **Primary Luminescence**: Platinum White (`#FFFFFF`, `#F4F5F7`) commands focal attention, used for high-tier titles, vital figures, and primary gesture points.
- **Telemetry & Status**: Emerald (`#10B981`) signifies onchain node connectivity, gas equilibrium, and verified block sync; Mint (`#34D399`) tracks positive financial deltas and live sparkline vectors.
- **Network Resonance**: Cyan / Electric Blue (`#38BDF8`) provides secondary telemetry for cryptographic links, identity verification rings, and network metadata.
- **Typographic Scale**: Pure White (`#FFFFFF`) for primary titles, Silver Slate (`#94A3B8`) for navigational labels, and Muted Zinc (`#64748B`) for cryptographic hashes and inactive indicators.

## Typography
Typographic rhythm is established through a strict dual-engine system:

1. **Primary Neo-Grotesque (`Geist`)**: Deployed for human-facing copy, system metrics, primary titles, and navigation labels. It offers geometric neutrality with condensed tracking for tight mobile constraints.
2. **Cryptographic Monospace (`JetBrains Mono`)**: Deployed for raw data fidelity—ENS handles, checksum contract addresses, gas prices (Gwei), and live pricing sparkline overlays.

All uppercase labels utilize increased tracking (+0.02em to +0.04em) to preserve optical balance against frosted dark backgrounds. Numerical data points must enable tabular figures (`tnum`) to eliminate layout jitter during high-frequency live stream re-renders.

## Layout & Spacing
The layout follows a fluid columnar architecture engineered for single-handed thumb-reach zones within native Android launcher contexts:

- **Mobile Rhythm**: A responsive 4-column grid spanning an outer margin of `1rem` (16px) with dynamic gutters of `0.75rem` (12px). Quick-action operational modules are locked to the lower two-thirds of the viewport.
- **Tablet Reflow**: Expands to an 8-column layout with `1.5rem` margins, allowing secondary telemetry modules (Market Pulse & Gas Trackers) to sit parallel to the Identity Card rather than stacking vertically.
- **Safe Area Protocol**: Strictly adheres to Android gesture navigation bars (accommodating the 24px bottom buffer) and edge-to-edge camera cutouts via dynamic padding.

## Elevation & Depth
Depth is created through optical physics rather than heavy drop shadows:

- **Surface Translucency**: Cards use frosted acrylic layers composed of `rgba(255, 255, 255, 0.04)` to `rgba(255, 255, 255, 0.07)` background blends combined with hardware-accelerated `backdrop-filter: blur(20px) saturate(180%)`.
- **Specular Ghost Borders**: Boundaries are marked by a crisp 1px perimeter using `rgba(255, 255, 255, 0.08)`. For focused or active states, the top border edge catches light at `rgba(255, 255, 255, 0.20)`, simulating an overhead ambient rim light.
- **Diffused Radial Glows**: Interactive elements project soft background luminescence:
  - System ambient: `radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.08), transparent 70%)`
  - Active nodes: `0 0 24px rgba(16, 185, 129, 0.15)`
- **Elevation Layers**:
  - `Level 0 (Canvas)`: Flat obsidian void.
  - `Level 1 (Dock & Tiles)`: 4% white opacity, 12px blur, 1px border.
  - `Level 2 (Identity & Market Cards)`: 7% white opacity, 20px blur, 1px top-lit border.
  - `Level 3 (Modals & Overlays)`: 12% white opacity, 32px blur, 1px border with `0 16px 40px rgba(0, 0, 0, 0.6)`.

## Shapes
A unified rounded geometry (`roundedness: 2`) introduces a friendly yet technological presence:

- **Base Radius (0.5rem / 8px)**: Micro tags, network pills, copy-address badges, and inline status chips.
- **Large Radius (1rem / 16px)**: Action tiles, market cards, and search inputs.
- **Extra Large Radius (1.5rem / 24px)**: Hero ENS Social Identity Container and system dock wrappers.
- **Full Radius (9999px)**: Avatar rings, active presence dots, live network toggles, and Android gesture affordance bars.

## Components

### App Header
- Single horizontal bar displaying the platform signature mark alongside an interactive glowing ambient orb.
- Right-aligned tactile gear action button housed in a 36x36px circle with frosted background (`rgba(255, 255, 255, 0.05)`) and micro-hover scaling.

### ENS Social Identity Card
- **Container**: `rounded-xl` card built with Level 2 glass depth, 16px inner padding.
- **Avatar Unit**: 48x48px circle framed by an electric blue to emerald gradient ring (`linear-gradient(135deg, #38BDF8, #10B981)`). Includes a 10px absolute-positioned Emerald presence dot indicating onchain sync.
- **Identity Stack**: Displays the primary ENS name in `headline-sm` (`#FFFFFF`), paired with a copyable truncated address (`0x...`) in `label-sm` monospace (`#64748B`).
- **Social Chips**: Inline horizontal cluster of pill tags (`#` tags for X, GitHub, Web) utilizing `space-xs` padding, rendering icons in silver slate (`#94A3B8`).

### Action Grid
- 2-column tactical touch matrix (`gutter: 0.75rem`).
- **Tiles**: 16px padding with internal frosted icon reservoirs (32x32px squircle).
- **Feedback**: Active press states depress slightly (`scale(0.98)`) and trigger an inner glow highlight (`rgba(255, 255, 255, 0.12)`).

### Market Pulse Cards
- Live token rows housing 3 key zones:
  - Left: Token glyph with symbol in `body-md` bold and protocol name in `body-sm` muted zinc.
  - Center: Vector sparkline SVG (2px stroke) in Mint Green (`#34D399`) for positive runs or Muted Red (`#F43F5E`) for corrections.
  - Right: Ticker price in `label-lg` tabular monospace with an inline pill badge stating the 24h percentage delta.

### Gesture Pill Affordances (Launcher UX)
- Bottom-docked swipe-up affordance for accessing the traditional app drawer.
- Employs a centered, low-contrast platinum bar (36x4px) paired with an upward chevron icon, responding to vertical inertia gestures with fluid spring kinetics.
