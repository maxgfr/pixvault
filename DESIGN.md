---
name: pixvault
description: A museum print room for your photos — mat board, archival blue-grey, graphite, one conservation red.
colors:
  ground: "#e8e5de"
  surface: "#fbfaf7"
  surface-2: "#f2f0ea"
  core: "#ffffff"
  bevel-hi: "#ffffff"
  bevel-lo: "#d9d3c7"
  line: "#d6d0c4"
  line-soft: "#e6e1d8"
  ink: "#22282d"
  ink-2: "#454d54"
  muted: "#5c6369"
  box: "#566d7a"
  box-deep: "#435763"
  box-text: "#435763"
  box-ink: "#f3f5f6"
  box-soft: "#dde4e8"
  red: "#b0442b"
  red-deep: "#943620"
  red-ink: "#ffffff"
  red-soft: "#f4e3dc"
  gain: "#2f6b45"
  loss: "#9a5a00"
  gps: "#8a5300"
  gps-soft: "#f6e9cf"
  error: "#a3271c"
  focus: "#2f6f9a"
  dark-ground: "#171a1c"
  dark-surface: "#212629"
  dark-ink: "#e7e4dd"
  dark-box: "#2f3d45"
  dark-box-text: "#a9c6d6"
  dark-red: "#e0775c"
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
    backgroundColor: "{colors.red}"
    textColor: "{colors.red-ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.95rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.red-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  shell-bar:
    backgroundColor: "{colors.box}"
    textColor: "{colors.box-ink}"
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

A working tool dressed as a museum photography print room. Every photo the user drops is treated as a piece in a collection: it sits in its own **mat with a bevel-cut window**, carries an **accession number** (PV-001) in small caps, and every change is reported like a condition report (before → after, with the gain). The interface is otherwise a plain, familiar web app (Operate mode): top bar, a grid, a side column of actions, standard form controls. The world contributes only palette, type voice, density and the one signature move — the bevelled window.

Colour is quarantined: the chrome is mat board, graphite and archival blue-grey, so the only saturated colours on screen are the photographs themselves and the state colours.

## Colors

- **Mat board** (`ground`, `surface`, `surface-2`, `core`): warm greys and off-whites, like acid-free board. `surface` is the face of a mat; `core` the white core exposed by a bevel and the field of inputs.
- **Archival box blue-grey** (`box`, `box-deep`, `box-text`): the shell bar, current navigation, links, icons, category headings — the colour of conservation storage boxes.
- **Graphite** (`ink`, `ink-2`, `muted`): all text. `muted` passes 4.5:1 on every light ground (4.85:1 on `ground`).
- **Conservation red** (`red`, `red-deep`): reserved for what is about to happen or change — the primary run button, selection ticks, the before/after divider, drawn crop and redact areas, the drop target when files hover. Never decoration.
- **States**: `gain` (smaller file), `loss` (bigger file), `gps`/`gps-soft` (a photo reveals its location; also risk panels), `error`, `focus`.
- **Dark theme** follows the system: an archive at night — near-black board, deep blue-grey bar, warm off-white ink, a lighter red that keeps contrast.

## Typography

One system sans for everything (no web fonts: the CSP loads nothing from elsewhere, and system-ui reads well in English and French). A fixed rem scale with small steps; the only large type is the home heading. Accession numbers use `font-variant-caps: all-small-caps` with tabular figures and 0.06em tracking. Every number a user compares — sizes, dimensions, percentages, progress — uses tabular figures.

## Layout

- Shell max width 1320px, 1rem gutters.
- Home: two columns (heading and facts, 5fr; the drop mat, 7fr), then the tool index set as a three-column catalogue (CSS columns, categories never split).
- Workspace: a fluid grid of mats (`minmax(11.5rem, 1fr)`) beside a sticky 21rem action column.
- Tool view: the stage (preview, editors, results) beside a sticky 22rem settings column whose run button stays pinned at its bottom.
- Below 1040px both two-column views stack (actions first in the workspace); below 640px mats go two per row and nav labels collapse to icons.

## Elevation & Depth

Mats rest on the table: a two-layer soft shadow (`0 1px 1px` + `0 4px 10px -4px`, warm-tinted). A lifted state (drag over, a mat settling in) uses a deeper `0 12px 28px -10px`. Inside a mat, depth comes only from the bevel. No other shadows; no borders under shadows.

## Shapes

Board is cut square: mats and stages have 2px corners, controls 3–4px, chips and counts are pills. **The bevel** is the signature: a window is drawn with solid borders of different colours per side (`bevel-lo` on top and left, `bevel-hi` on bottom and right), which mitre at the corners exactly like a 45° cut into board. 5px around thumbnails, 6px around previews and editors, 8px around the drop window and the AI model gate.

## Components

- **Mat**: selection tick (top-left, red when checked), bevelled window with the upright thumbnail, accession number, badges (GPS, Changed), file name, label line (format · size · weight), and quiet icon tools (details, restore, move, remove). Unselected mats dim to 40% and desaturate.
- **Drop mat**: a large mat whose window is the drop target; turns red-tinted while files hover.
- **Quick action**: icon + title + two-line summary, `core` background, red border on hover.
- **Compare**: before/after on one picture, a red divider with a round knob, driven by an invisible range input (keyboard accessible).
- **Rect and brush editors**: red outlines and handles; crop shades outside the frame, redact tints inside.
- **Results**: a condition-report table — thumbnail, accession, before → after, gain in green or loss in amber, per-file actions; bulk actions above.
- **Model gate**: a bevelled panel stating model, licence, size and origin, with one red download button.

## Do's and Don'ts

- Do keep red for the action about to run and what it will change. Don't use it for decoration, headings or categories.
- Do let photographs be the colour. Don't add tinted backgrounds or gradients behind them.
- Do use standard controls (selects, ranges, checkboxes) themed with `accent-color`. Don't invent widgets for the world's sake.
- Do write every string in English and French, side by side in the code.
- Don't add web fonts, icon fonts or emoji icons: icons are the inline 24×24 stroke set in `src/icons.tsx`.
- Don't use eyebrows above headings, numbered sections, nested cards or hard offset shadows.
