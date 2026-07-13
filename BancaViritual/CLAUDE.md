# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A single static HTML file, `banca-virtual.html` (~200KB), that implements "Banca" — a virtual
banker/scorekeeper app for playing physical (board) Monopoly without paper money. It's a
Spanish-language, mobile-first, offline-first web app. There is no `package.json`, no build
config, no test suite, and no other source files — this one file is the entire product.

## Working with the file

**There is no build step and nothing to install.** The `<script>` in `banca-virtual.html` is
already a bundled/minified production build (esbuild IIFE containing React 18.3.1 + the app code
concatenated together — you can see the bundler helpers `df,rs,ff,pf,mf,vf,In,gf...` at the very
top and a "Bundled license information" comment block at the very bottom). There is no
unminified source checked in anywhere in this repo.

Consequences for editing:
- Line 16/20/21/23 etc. are single lines tens of thousands of characters long (React/ReactDOM
  internals and the app code are each one giant line). Use `grep -o`, targeted `sed -n 'Np'`, or
  small Python snippets to locate/inspect specific substrings instead of reading the whole file —
  a plain `Read` will blow past normal context limits.
- Identifiers are minified/obfuscated single- or double-letter names (`e,n,t,r,l,o,i,u,c,f,...`,
  `Fa`, `Da`, `ja`, `cn`, etc.). There's no source map. Making surgical edits means finding the
  exact minified token via `grep`/string search first, then editing that exact occurrence — don't
  try to "clean up" or reformat the bundle as a side effect of a fix.
- If a change requires anything beyond a small in-place string/logic patch (e.g. adding a real
  feature), the practical approach is to extract the relevant JS out to a scratch file, edit it
  readably, then fold the result back into the single `<script>` tag — this repo has no separate
  build pipeline to regenerate the bundle from source.

## Running / verifying changes

No dev server, no npm scripts, no linter, no tests exist for this project. To check a change:
- Open `banca-virtual.html` directly in a browser (double-click, or `xdg-open banca-virtual.html`
  on this machine), or serve it locally (`python3 -m http.server`) if you need to test under
  `http://` instead of `file://`.
- Verify manually in the browser: add players, do a bank payment, a player-to-player transfer,
  undo/redo, and reload the page to confirm state persisted.

## Architecture (all inside the one `<script>` block)

- **Bundle layout, in order**: esbuild runtime helpers → React → ReactDOM (18.3.1-next) → app
  code → a `window.storage` polyfill → `createRoot(...).render(<Fa/>)` mount call at the very end.
- **Single root component** (minified name `Fa`). No routing, no external state library — the
  entire app is one component tree driven by `useState`/`useRef` hooks and local helper functions
  defined inside/near `Fa`.
- **Persistence is dual-layer**: the app always calls an async `window.storage.get/set/delete` KV
  API. If the hosting page doesn't already provide `window.storage` (e.g. a sandboxed/artifact
  host might inject its own), the script defines a fallback at the bottom that just wraps
  `localStorage`. Don't assume `localStorage` is used directly — trace through `window.storage`.
  - Storage keys: `banca:estado` (current game state), `banca:snapshot` (one-shot snapshot used by
    the "restore previous game" banner after starting a new game), `banca:help_seen` (whether the
    how-to-play sheet was dismissed), `banca:dark` (dark mode flag).
- **Domain model**: game state holds a `players` array (each with `name`, an emoji `icon` token,
  a `ci`/color index into the fixed palette `cn` — named colors like Marrón, Celeste, Fucsia,
  Naranja, Rojo, Amarillo, Verde, Azul, Morado, Turquesa, Coral, Gris — plus `balance` and a
  `bankrupt` flag), a `sym` currency symbol (default `$`/`€`), a `quicks` array of quick-amount
  buttons, a `log`/`redo` movement history, and optional `dice`/`special`/`sound`/`voice` settings.
- **Core money actions** (all go through the log for undo/redo): bank → player payment, player →
  bank payment, player → player transfer (supports splitting one amount across multiple selected
  recipients, e.g. for rent paid to several owners), a one-tap "Salida" (+200) action, and
  "declarar bancarrota" which removes/flags a player as bankrupt.
- **Optional dice/turn tracker**: when enabled, shows a turn bar with a "next turn" button; an
  optional third "special" die adds surprise faces (choose one die/other/sum, double both dice,
  reroll, lose turn, +6 bonus).
- **Feedback layer**: a Web Audio API oscillator plays a short "cash register" blip on
  transactions, and Spanish `SpeechSynthesis` (es-ES voice) reads out payments and the win
  announcement; both are togglable in settings.
- **Wealth chart**: a bottom sheet renders each player's balance history as an inline hand-rolled
  SVG line chart (no charting library).
- **Styling**: all CSS lives in one template-literal string (assigned to the minified var holding
  the app's `@import` of Google Fonts "Oswald" plus rules) injected into the page; class names use
  a `bv-` prefix throughout (e.g. `bv-sheet`, `bv-dicebig`, `bv-menu-btn`).
