# @dsh-custom/dsh-client-ui-theme-zai

English | [中文](README.zh.md)

The Zai brand themes ported from ZCode: `zai-light` and `zai-dark` register on the dsh theme registry as alias-token themes, so every UI built on the alias layer re-skins without touching the base palettes. Both appear in the Settings → Appearance theme list automatically.

## How it works

- Registers two themes via `ctx.theme.register`: `zai-light` (light scheme, near-white surfaces, ink foreground, black brand) and `zai-dark` (dark scheme, near-black surfaces, white foreground, white brand).
- Each theme overrides exactly the 14 documented alias tokens (`--dsw-alias-*` plus `--dsw-specific-sidebar-fill`) with the values ported from ZCode's `theme-zai-light` / `theme-zai-dark` palettes.
- Registering never changes the active preference; the user picks the theme in the appearance row.

## Config

None.

## Model Experience

None, as this package registers no tools and no model-visible context; it only contributes theme palette tokens.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- ZCode-only token vocabulary is dropped where dsh has no alias counterpart (trajectory colors, heatmap scale); they fall back to the base palette.
- The appearance row shows the raw ids (`zai-light`, `zai-dark`); friendly localized display names would ride ui-theme's label surface if it grows one.
