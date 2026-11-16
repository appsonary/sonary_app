---
version: alpha
name: YouTube Music
description: Design System clone and layout specification based on YouTube Music (music.youtube.com), reconstructed for the sonary_pro application.
colors:
  background-base: "#030303"
  background-surface: "#0f0f0f"
  background-elevated: "#212121"
  background-chip-inactive: "#1d1d1d"
  background-chip-hover: "#2b2b2b"
  background-additive: "rgba(255, 255, 255, 0.1)"
  background-hover: "#282828"
  background-active: "#333333"
  background-overlay-dark: "rgba(0, 0, 0, 0.5)"
  background-atmospheric-glow: "rgba(40, 20, 25, 0.35)"
  brand-primary: "#FF0000"
  brand-accent: "#FFFFFF"
  text-primary: "#FFFFFF"
  text-secondary: "#AAAAAA"
  text-muted: "#717171"
  border-subtle: "rgba(255, 255, 255, 0.1)"
  border-elevated: "#282828"
  indicator-error: "#FF4E45"
  indicator-success: "#2BA640"
typography:
  display:
    fontFamily: 'Roboto, "YouTube Sans", system-ui, sans-serif'
    fontSize: 28px
    lineHeight: 34px
    fontWeight: 700
  title:
    fontFamily: 'Roboto, "YouTube Sans", system-ui, sans-serif'
    fontSize: 20px
    lineHeight: 26px
    fontWeight: 700
  body:
    fontFamily: 'Roboto, "YouTube Sans", system-ui, sans-serif'
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 500
  secondary:
    fontFamily: 'Roboto, "YouTube Sans", system-ui, sans-serif'
    fontSize: 12px
    lineHeight: 18px
    fontWeight: 400
  badge:
    fontFamily: 'Roboto, "YouTube Sans", system-ui, sans-serif'
    fontSize: 13px
    lineHeight: 18px
    fontWeight: 500
rounded:
  track-card: 4px
  album-card: 8px
  chip: 8px
  dialog: 12px
  circular: 9999px
spacing:
  base: 4px
  scale: [4, 8, 12, 16, 20, 24, 32, 48, 64]
components:
  card-track:
    backgroundColor: "{colors.background-base}"
    rounded: "{rounded.track-card}"
    padding: 8px
  card-elevated:
    backgroundColor: "{colors.background-elevated}"
    rounded: "{rounded.album-card}"
  chip-filter:
    backgroundColor: "{colors.background-additive}"
    rounded: "{rounded.chip}"
    padding: 6px 14px
  button-circular:
    rounded: "{rounded.circular}"
  player-bar:
    backgroundColor: "{colors.background-elevated}"
    borderTopColor: "{colors.border-subtle}"
---

# YouTube Music Design System Specification for Sonary Pro

## Overview
This document formalizes the visual language and layout architecture of YouTube Music (`music.youtube.com`), tailored for the `sonary_pro` React Native audio streaming application. The design language features a deep pitch-black immersive backdrop (`#030303`), elevated dark-gray surfaces (`#0f0f0f` and `#212121`), high-contrast pure white typography (`#FFFFFF`), signature muted secondary metadata (`#AAAAAA`), and YouTube's iconic crimson brand accent (`#FF0000`).

---

## 1. Visual Identity & Atmosphere

### 1.1 Brand Expression & Voice
- **Atmosphere:** Deep, focused, modern, immersive entertainment environment where the artwork is the hero.
- **Surface Philosophy:** Pitch-black background (`#030303`) minimizes OLED power usage and focuses the eye on media cover art.
- **Signature Brand Element:** The circular red badge with white play triangle, pill-shaped category chips (`border-radius: 8px`), and the unmistakable secondary text contrast (`#AAAAAA` on `#030303`).

---

## 2. Design System Tokens

### 2.1 Colors
| Token | Hex / Value | Semantic Role | Usage |
|---|---|---|---|
| `background-base` | `#030303` | Core base viewport background | Root container, deep app canvas |
| `background-surface` | `#0f0f0f` | Intermediate surface | Content rows, header backdrop |
| `background-elevated` | `#212121` | Elevated container & panels | Mini player bar, dialogs, search box |
| `background-additive` | `rgba(255, 255, 255, 0.1)` | Subtle pill & action fill | Category filter chips, icon button backgrounds |
| `background-hover` | `#282828` | Hover / touch state | Track item press feedback |
| `background-active` | `#333333` | Active / selected state | Selected tab, active row highlight |
| `brand-primary` | `#FF0000` | Signature brand crimson | Brand badge, active favorite state, primary CTA |
| `brand-accent` | `#FFFFFF` | Primary action contrast | Circular play icon, high-visibility actions |
| `text-primary` | `#FFFFFF` | Primary text | Track titles, headlines, primary button text |
| `text-secondary` | `#AAAAAA` | Secondary metadata | Artist names, durations, subtitles, inactive tabs |
| `text-muted` | `#717171` | Muted placeholders & hints | Search placeholder, disabled text |
| `border-subtle` | `rgba(255, 255, 255, 0.1)` | Divider & separator lines | Player top border, dialog dividers |
| `border-elevated` | `#282828` | Elevated element borders | Search bar border, modal borders |
| `indicator-error` | `#FF4E45` | System error alert | Error banners, failure indicators |
| `indicator-success` | `#2BA640` | Success & confirmation | Download checkmarks, saved badges |

### 2.2 Typography
- **Font Stack:** `Roboto, "YouTube Sans", system-ui, -apple-system, sans-serif`
- **Display / Header:** `24px` - `28px`, Weight: `700` (Bold), Letter Spacing: `-0.02em`
- **Section Title:** `18px` - `20px`, Weight: `700` (Bold), Letter Spacing: `-0.01em`
- **Track / Card Title:** `14px` - `15px`, Weight: `500` (Medium) / `600` (Semi-bold)
- **Secondary / Subtitle:** `12px` - `13px`, Weight: `400` (Regular), Color: `#AAAAAA`
- **Pills & Chips:** `13px`, Weight: `500` (Medium), Color: `#FFFFFF`
- **Timers & Badges:** `11px` - `12px`, Weight: `500` (Medium)

### 2.3 Radii & Shapes
| Shape Role | Radius | Applied Elements |
|---|---|---|
| `track-card` | `4px` | Track list thumbnails (48x48px) |
| `album-card` | `8px` | Album covers, playlist hero covers (140px - 200px) |
| `chip` | `8px` | Category filter chips (e.g. "Relax", "Treino", "Energia") |
| `dialog` | `12px` - `16px` | Modal bottom sheets and confirmation dialogs |
| `circular` | `9999px` | Artist avatars, play/pause buttons, circular icon buttons |

### 2.4 Spacing
- **Base Grid:** `4px` / `8px` increment system.
- Standard steps: `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `48px`, `64px`.

---

## 3. Component Architecture & Specifications

### 3.1 Top Header & Collapsible Navigation Sidebar
- **Logo Presentation:** Red circular badge (`28x28px`, `border-radius: 14px`, `#FF0000`) with white play triangle alongside the "Sonary" wordmark in white bold text (`22px`, weight 800) and "Pro" in `#FF0000`.
- **Top Header Utility Cluster:** Profile avatar (`32x32px`, `borderRadius: 16px`) for balanced visual composition (device casting/pairing omitted until native backend support is connected).
- **Refined Status Badge:** Subtle frosted pill badge (`backgroundColor: rgba(255, 255, 255, 0.04)`, `borderRadius: 12px`, with `6px` emerald green status indicator dot) displaying `Só você e a música` in clean 11px typography, eliminating visual clutter.
- **Collapsible Sidebar (Desktop & Tablet):**
  - **Collapsed State (72px):** Minimalist icon-only rail for maximum content canvas.
  - **Expanded State (240px):** Full navigation rail with hamburger toggle (`Menu` icon), primary navigation links (`Início & Busca`, `Biblioteca`, `Músicas Salvas`), divider line, and pinned playlists list.
  - **Pinned Playlists:** "Nova Playlist" button (`Plus` icon), "Músicas Curtidas" hero item with `#FF0000` heart icon, and custom playlist rows with active highlight.

### 3.2 Search Experience, Discovery Grid & Atmospheric Vignette
- **Atmospheric Vignette:** Pitch black OLED base (`#030303`) with an ultra-subtle, cinematic radial/vertical ambient glow (`#7A000A` with 18% opacity fading into `#030303`), eliminating flat or overpowering red banners.
- **Pill Search Bar:** `height: 46px`, `borderRadius: 24px`, background `#1E1E22`, subtle 1px border `rgba(255, 255, 255, 0.08)`, smooth focus transition to `rgba(255, 255, 255, 0.35)`.
- **Tactile Search Button:** Pill button (`borderRadius: 24px`, `height: 46px`) with dynamic state lighting — resting in elevated dark state (`#242428`) and illuminating into high-contrast white (`#FFFFFF`) when a query is entered, with active touch compression (`0.97x`).
- **Initial Discovery Hub:** When no query is typed, displays "O que você quer ouvir?" with tactile explore chips (`Lo-Fi`, `Pop`, `Rock`, `Acústico`, `MPB`, `Eletrônica`, `Jazz`, `Treino`) that trigger instant search on tap.
- **Results Sectioning:** Visual separation between horizontal "Escolhas Rápidas" (Quick Picks) and the vertical catalog "Músicas e Resultados" with track count badge.

### 3.3 Quick Picks 4xN Grid
- Layout: 4 rows per column, horizontally scrollable shelf (`grid-template-rows: repeat(4, 1fr)`).
- Eyebrow header: `"INICIAR RÁDIO COM UMA MÚSICA"` in `#AAAAAA` (`12px`, weight 700, uppercase).
- Section Title: `"Escolhas Rápidas"` in `#FFFFFF` (`20px`, weight 700).
- Row Item:
  - Height: `56px` to `64px`, `border-radius: 4px`.
  - Thumbnail: `48x48px` (`border-radius: 4px`), fallback dark container with `Music2` icon.
  - Track Number / Equalizer: Resting numeric index in `#AAAAAA`, transforms to hover `Play` button overlay, or 3-bar animated red equalizer when track is currently active.
  - Metadata: Title in `#FFFFFF` (`14px`, weight 500) and Artist + duration in `#AAAAAA` (`12px`).
  - Progressive Disclosure: Add-to-playlist icon (`ListPlus`) revealed on hover without layout shift.

### 3.4 Carousel Media Cards (Square Albums & Circular Artists)
- Section header with eyebrow and title, horizontal carousel row with comfortable gutters.
- **Square Album & Playlist Cards:**
  - 1:1 Aspect ratio cover (`140px` to `180px`), `border-radius: 8px`, box-shadow `0 4px 12px rgba(0,0,0,0.4)`.
  - Dark hover scrim (`rgba(0,0,0,0.5)`) with scale zoom (`1.05x`).
  - Floating Play Button: Circular button with `#030303` play icon inside `#FFFFFF` circle, positioned at bottom-right of artwork on hover.
  - Card Title: `#FFFFFF` (`14px`, weight 600, single line truncated).
  - Card Subtitle: `#AAAAAA` (`12px`, e.g., `"Álbum • Artista"` ou `"Playlist • N músicas"`).
- **Circular Artist Cards:**
  - 1:1 Aspect ratio avatar (`border-radius: 9999px` / 50% circle), circular hover scrim.
  - Centered floating play button on hover.
  - Card Title: `#FFFFFF` centered below avatar.
  - Card Subtitle: `#AAAAAA` centered (e.g., `"Artista • 12M ouvintes"`).

### 3.5 Playlist & Album Track Table
- Heroic playlist header with up to `200x200px` cover (`border-radius: 8px`), bold title (`22px`, weight 800), and metadata.
- Primary CTA: Pill-shaped `"Tocar Playlist"` button (`border-radius: 9999px`, `#FFFFFF` background with black play triangle and text).
- Table Rows:
  - Column 1: Index number (`1, 2, 3...`) or animated active play indicator.
  - Column 2: Track thumbnail `44x44px` (`border-radius: 4px`).
  - Column 3: Title (`#FFFFFF`, weight 500), Artist and Album (`#AAAAAA`).
  - Column 4: Duration format `m:ss` in `#AAAAAA` tabular numerals.
  - Column 5: Status badge (`CheckCircle2` green `#2BA640` if downloaded, `Globe` if online).
  - Column 6: Remove button (`X` icon in `#AAAAAA`) and contextual options dropdown (`MoreVertical`).

### 3.6 Spotify-Style Floating Mini Player (56px) & Dynamic Artwork Tint
- **Floating Card Geometry:** Floats directly above the bottom tab navigation bar (`marginHorizontal: 8px`, `marginBottom: 6px`, `borderRadius: 8px`, `overflow: hidden`, `height: 56px`), with 1px border `rgba(255, 255, 255, 0.08)` and subtle drop shadow.
- **Dynamic Dominant Background:** Adapts dynamically to the dominant dark palette of the current track's album cover (e.g. Deep Midnight Navy `#132438` for blue covers, Deep Forest `#0e2d24` for greens, Deep Velvet `#2a1435` for purples, Deep Wine `#351419` for warm/red tones). Guarantees WCAG AAA contrast (> 9.5:1) for white text.
- **Left Cluster:** Album cover thumbnail (`40x40px`, `borderRadius: 4px`), Title in bold white (`13.5px`, weight 700), Artist in Spotify gray (`#B3B3B3`, `12px`).
- **Right Controls (Spotify Signature):**
  - Favorite Heart button (`Heart`, `18px`, `#FF0000` red fill when saved, `#B3B3B3` when idle).
  - Track controls: Skip Previous (`SkipBack`), Bare white Play/Pause icon (`Play`/`Pause`, `22px`, `#FFFFFF` fill), and Skip Next (`SkipForward`).
  - Desktop controls (`>= 680px`): Repeat, Shuffle, Volume slider, and Expand chevron (`ChevronUp`).
- **Bottom Progress Bar:** Positioned at the very bottom edge of the card (`position: absolute, bottom: 0`), `height: 2.5px`, subtle translucent track (`rgba(255, 255, 255, 0.15)`), and crisp white progress fill line (`#FFFFFF`).

### 3.7 Full Screen Now Playing Drawer (100vh) & 3-Tab System
- Immersive dark canvas in `#030303` with dynamic ambient glow matching the active track.
- Header: Minimize chevron (`ChevronDown`, `28px`), `"TOCANDO AGORA"` uppercase subtitle in `#AAAAAA`, track/album title in `#FFFFFF`, and queue toggle button.
- Hero Artwork: Centered `340x340px` square with `border-radius: 8px`, deep shadow, and Apple-style physical spring scale animation (1.0 playing, 0.95 paused).
- Scrubber: Sleek `4px` track with `#FFFFFF` fill knob (`14px`), elapsed and remaining time in `#AAAAAA`.
- Primary Controls:
  - Relative Seek: `-15s` (`RotateCcw`) and `+15s` (`RotateCw`) in `#AAAAAA`.
  - Skip Previous (`32px` white fill) and Skip Next (`32px` white fill).
  - Main Play/Pause Button: Large circular `68x68px` button (`#FFFFFF` background with `#030303` icon).
- Footer Actions: Pill-shaped quick actions (`border-radius: 9999px`) for `"Playlist"` and `"Salvar offline"` (with `#2BA640` checkmark when downloaded).
- **3-Tab Drawer System (The YTM Signature):**
  1. **A SEGUIR (Up Next Queue):** Full queue list with filter chips (`Todos`, `Músicas Familiares`, `Descobertas`), currently playing track with red play indicator, upcoming tracks with tap-to-play, and infinite smart radio.
  2. **LETRAS (Synchronized Lyrics):** Synchronized autoscrolling lyrics with active verse highlight (`#FFFFFF`, weight 700) and clickable timestamp lines that seek audio immediately.
  3. **RELACIONADOS (Related Insights):** Artist bio card, recommended smart mixes, and related tracks.

### 3.8 Mobile Bottom Navigation Bar (56px)
- Fixed container: `height: 56px`, `backgroundColor: #030303`, `borderTopWidth: 1px`, `borderTopColor: rgba(255, 255, 255, 0.08)`.
- 3 core tabs: `Buscar` (Search), `Playlists` (Library), `Baixadas` (Downloads/Offline).
- Inactive tab: `#AAAAAA` icon and text (`11px`).
- Active tab: `#FFFFFF` icon and text with high contrast.

---

## 4. Layout & Responsive Grid

### 4.1 Mobile Viewport (390 x 844)
- Compact single-column vertical feed.
- Persistent bottom mini-player anchored at `bottom: 56px` (above bottom navigation).
- Horizontal scroll lists for chips and quick recommendations.

### 4.2 Desktop / Tablet Viewport (1440 x 900)
- Content container capped with comfortable gutters (`max-width: 1200px`, centered).
- Track lists and playlist grids expand into multi-column responsive cards (4 to 6 columns for albums).
- Mini-player becomes a persistent full-width desktop bottom bar (`ytmusic-player-bar`) with volume control slider on the far right.

---

## 5. Do's and Don'ts

### Do
- Always use `#030303` as the canonical root background and `#212121` for elevated surfaces.
- Always use `#AAAAAA` for secondary text, metadata, and duration indicators.
- Use `4px` corner radius for track thumbnails and `8px` for album art and category chips.
- Use `9999px` (circular) for artist pictures and primary play/pause buttons.
- Maintain accessible 44x44px minimum touch targets on all interactive controls.

### Don't
- Do not use Spotify bright green `#1DB954` anywhere in the interface.
- Do not use mid-gray backgrounds like `#121212` or `#1A1A1A` when `#030303` / `#0f0f0f` / `#212121` are specified.
- Do not use high-opacity white text for secondary metadata; keep it at `#AAAAAA`.
- Do not break existing `testID`, `id`, `aria-label`, or component prop contracts.

