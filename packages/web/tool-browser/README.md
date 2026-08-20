# @dsh-custom/dsh-tool-browser

English | [中文](README.zh.md)

Background browser automation tools: opens a page in headless Microsoft Edge and drives it through CDP, so the agent can run screenshot-analyze-operate loops without stealing the foreground from the user.

## How it works

- `browser_open(url, headless?)` launches headless Edge with a temporary profile and navigates to the URL.
- `browser_screenshot(output_path?)` captures the current page as a PNG (page content, not the desktop).
- `browser_eval(expression)` executes JavaScript in the page for clicking, typing, reading state, or navigation.
- `browser_close()` closes the browser and removes its temporary profile.
- One browser is kept per agent session and is closed when the session is disposed.

## Config

None.

## Model Experience

The tools add no prompt sections and no model-visible context beyond their results.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Requires Microsoft Edge installed on Windows.
- Headless mode is the default so the browser never appears on the user's screen.
- The implementation uses the Chrome DevTools Protocol over Node's built-in WebSocket; it is intentionally minimal (no Playwright/Puppeteer dependency).
