# @deepseek-ai/dsh-client-ui-background

English | [中文](README.zh.md)

Custom chat background: upload a photo in **Settings → General → 背景图片**, and it becomes the main-area background. The sidebar keeps its own fill; the image is stored locally (compressed to a JPEG data URL in localStorage) and survives reloads.

## How it works

1. The plugin registers a `settings.general.item` row (after Appearance) with an upload button, a preview, and a remove button.
2. Picking an image downscales it (long side capped at 1920px) and encodes it as JPEG via a canvas.
3. The data URL is persisted in `localStorage` (`dsh.background.image`) and applied to the document body: `data-dsh-bg` plus the `--dsh-bg-url` custom property.
4. An injected global style turns the page-level surfaces (`--dsw-alias-bg-base` users: frame, chat area, details panel) transparent while `data-dsh-bg` is set, so the image shows through. Message bubbles, inputs, and the sidebar use their own tokens and stay opaque.

## Model Experience

No prompt sections, no tools, no model-visible context; the plugin touches the browser only.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The background applies to the main area only; the sidebar and details rail keep their fills by design.
- Images are stored as JPEG (photos look best); PNG transparency is not preserved.
- The stored image lives in the browser's localStorage — clearing site data removes the background.
