# @dsh-custom/dsh-tool-screenshot

English | [中文](README.zh.md)

Model-facing screenshot tool: captures the current screen to a PNG and returns the file path, so the agent can recognize its own screenshots through an external vision MCP tool (for example `mcp__glm4v__analyze_image`).

## How it works

- Registers a `screenshot` tool on `ctx.tools`.
- Execution goes through `ctx.shell`, so the same sandbox policy applies as for `tool-pwsh`.
- Windows uses PowerShell `CopyFromScreen`; macOS uses `screencapture`; Linux uses ImageMagick `import`.
- The result is `{ path, bytes }`; the path is an absolute local path that MCP vision tools can read.

## Config

None.

## Model Experience

No prompt sections, no model-visible context beyond the tool result. The tool only writes a PNG file and returns its path.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Linux requires ImageMagick (`import`); a `gnome-screenshot` fallback is not implemented.
- Region capture is supported on Windows and macOS; Linux uses ImageMagick crop.
- Windows captures the virtual screen (all monitors) by default.
