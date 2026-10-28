---
name: pixvault
description: A white gallery for your photos — white mats on a cool wall, an ink bar, one vermilion for the action.
colors:
  ground: "#f5f5f3"
  surface: "#ffffff"
  surface-2: "#f0f0ee"
  core: "#ffffff"
  bevel-hi: "#fafaf9"
  bevel-lo: "#e2e2df"
  line: "#e3e3e0"
  line-soft: "#ededeb"
  ink: "#17191c"
  ink-2: "#3d4046"
  muted: "#5f6368"
  bar: "#15171a"
  bar-deep: "#2b2e33"
  bar-ink: "#ffffff"
  badge: "#eeeeec"
  vermilion: "#ff5a36"
  vermilion-hover: "#ff7352"
  vermilion-ink: "#15171a"
  vermilion-text: "#cc3a17"
  vermilion-soft: "#ffe8e1"
  gain: "#1f7a4a"
  loss: "#9a5a00"
  gps: "#8a5300"
  gps-soft: "#fdf0d5"
  error: "#c0261b"
  focus: "#1f6feb"
  dark-ground: "#0e0f11"
  dark-surface: "#17191c"
  dark-ink: "#ededeb"
  dark-bar: "#08090a"
  dark-vermilion: "#ff6a45"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "2.375rem"
    fontWeight: 650
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  h1:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.2
  h2:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.8125rem"
  accession:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 650
    letterSpacing: "0.06em"
rounded:
  mat: "2px"
  sm: "3px"
  md: "4px"
  pill: "99px"
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "1rem"
  lg: "2rem"
  xl: "3.5rem"
components:
  button-primary:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.vermilion-ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.95rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.vermilion-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  shell-bar:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.bar-ink}"
    height: "3.5rem"
  mat:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.mat}"
    padding: "0.8rem"
  badge-gps:
    backgroundColor: "{colors.gps-soft}"
    textColor: "{colors.gps}"
    rounded: "{rounded.mat}"
---

# pixvault design

## Overview

A working tool laid out like a white-walled photo gallery. Every photo the user drops is treated as a piece in a collection: it sits in its own **white mat with a bevel-cut window**, carries an **accession number** (PV-001) in small caps, and every change is reported like a condition report (before → after, with the gain). The interface is otherwise a plain, familiar web app (Operate mode): top bar, a grid, a side column of actions, standard form controls. The world contributes only palette, type voice, density and the one signature move — the bevelled window.

Colour is quarantined: the chrome is white, cool off-white and ink, so the only saturated colours on screen are the photographs, the vermilion of the next action, and the state colours. (The first version used warm mat board, archival blue-grey and brick red; it read dated and was replaced by this palette.)

## Colors

- **Wall and mats** (`ground`, `surface`, `surface-2`, `core`): a cool off-white wall (`#f5f5f3`) with pure white mats and fields.
- **Ink bar** (`bar`, `bar-deep`, `bar-ink`): the top bar and current navigation, near-black with white text; the brand mark's window is vermilion.
- **Ink** (`ink`, `ink-2`, `muted`): all text and links (underlined). `muted` passes 4.5:1 on the wall (5.5:1) and on white (6:1).
- **Vermilion** (`vermilion`, `vermilion-hover`): reserved for what is about to happen or change — the primary run button (ink text on it, 5.8:1), selection ticks, the before/after divider, drawn crop and redact areas, the drop target while files hover. Never decoration, never text (use `vermilion-text` if ever needed).
- **States**: `gain` (smaller file), `loss` (bigger file), `gps`/`gps-soft` (a photo reveals its location; also risk panels), `error`, `focus` (blue ring).
- **Dark theme** follows the system: near-black wall, dark grey mats, an even darker bar, a lighter vermilion with black text.

## Typography

One system sans for everything (no web fonts: the CSP loads nothing from elsewhere, and system-ui reads well in English and French). A fixed rem scale with small steps; the only large type is the home heading. Accession numbers use `font-variant-caps: all-small-caps` with tabular figures and 0.06em tracking. Every number a user compares — sizes, dimensions, percentages, progress — uses tabular figures.

## Layout

- Shell max width 1320px, 1rem gutters.
- Home: two columns (heading and facts, 5fr; the drop mat, 7fr), then the tool index set as a three-column catalogue (CSS columns, categories never split).
- Workspace: a fluid grid of mats (`minmax(11.5rem, 1fr)`) beside a sticky 21rem action column.
- Tool view: the stage (preview, editors, results) beside a sticky 22rem settings column whose run button stays pinned at its bottom.
- Below 1040px both two-column views stack (actions first in the workspace); below 640px mats go two per row and nav labels collapse to icons.

## Elevation & Depth

Mats hang on the wall: a two-layer soft neutral shadow (`0 1px 2px` + `0 6px 16px -8px`). A lifted state (drag over, a mat settling in) uses a deeper `0 12px 28px -10px`. Inside a mat, depth comes only from the bevel. No other shadows; no borders under shadows.

## Shapes

Board is cut square: mats and stages have 2px corners, controls 3–4px, chips and counts are pills. **The bevel** is the signature: a window is drawn with solid borders of different colours per side (`bevel-lo` on top and left, `bevel-hi` on bottom and right), which mitre at the corners exactly like a 45° cut into board. 5px around thumbnails, 6px around previews and editors, 8px around the drop window and the AI model gate.

## Components

- **Mat**: selection tick (top-left, vermilion when checked), bevelled window with the upright thumbnail, accession number, badges (GPS, Changed), file name, label line (format · size · weight), and quiet icon tools (details, restore, move, remove). Unselected mats dim to 40% and desaturate.
- **Drop mat**: a large mat whose window is the drop target; turns vermilion-tinted while files hover.
- **Quick action**: icon + title + two-line summary, white background, vermilion border on hover.
- **Compare**: before/after on one picture, a vermilion divider with a round knob, driven by an invisible range input (keyboard accessible).
- **Rect and brush editors**: vermilion outlines and handles; crop shades outside the frame, redact tints inside.
- **Results**: a condition-report table — thumbnail, accession, before → after, gain in green or loss in amber, per-file actions; bulk actions above.
- **Model gate**: a bevelled panel stating model, licence, size and origin, with one vermilion download button.

## Do's and Don'ts

- Do keep vermilion for the action about to run and what it will change. Don't use it for decoration, headings, categories or text.
- Do let photographs be the colour. Don't add tinted backgrounds or gradients behind them.
- Do use standard controls (selects, ranges, checkboxes) themed with `accent-color`. Don't invent widgets for the world's sake.
- Do write every string in English and French, side by side in the code.
- Don't add web fonts, icon fonts or emoji icons: icons are the inline 24×24 stroke set in `src/icons.tsx`.
- Don't use eyebrows above headings, numbered sections, nested cards or hard offset shadows.
