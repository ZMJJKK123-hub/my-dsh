# @dsh-custom/dsh-client-ui-turn-sounds

English | [中文](README.zh.md)

Browser sound notifications: plays a completion chime when an agent turn ends, and a question chime when the agent asks the user. Settings live under the "提示音" page in Settings.

## How it works

- Listens to every listed session's conversation snapshot for new completed turns (`turnEnds`) and new pending questions (`pending` entries with `kind: 'question'`), so sounds play even when the dsh tab is in the background or another session is running.
- Default sounds are synthesized with Web Audio; users can upload an mp3/wav/ogg file up to 1MB for each slot in Settings.
- Settings persist in `localStorage` under `dsh.turn-sounds`.

## Config

None.

## Model Experience

No prompt sections, no tools, no model-visible context.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Sounds play in the dsh browser tab, not system-wide outside the browser.
- Browser autoplay policy may require a first user interaction; the plugin primes the AudioContext on the first click or keypress.
- Custom uploads are stored as data URLs in `localStorage`; clearing site data removes them.
