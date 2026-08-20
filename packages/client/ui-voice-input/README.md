# @deepseek-ai/dsh-client-ui-voice-input

English | [中文](README.zh.md)

A mic button in the composer's tool row (right seat, before the send button). Clicking starts browser speech recognition (Web Speech API — Edge/Chrome); each final transcript is appended to the draft, composing with whatever is already typed. Clicking again stops. Unsupported browsers render nothing.

## How it works

- Registers into `conversation.input.right` with order 5, so it sits in the tool row before the primary send button.
- Uses the session standard kit (`useInput` for the live draft, `inputActions.setDraft` for the write) — no Remote, no Host state.
- Language follows the UI locale: `zh-CN` for Chinese, `en-US` otherwise.
- Errors (permission denied, network failure, no speech) surface through the button's title and a transient `data-error` state; they never block the composer.

## Model Experience

No prompt sections, no tools, no model-visible context. It only writes into the draft, exactly as if the user had typed.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Requires a browser with the Web Speech API (Edge/Chrome); Firefox and Safari are not supported.
- Recognition runs on the browser vendor's speech service; an offline machine cannot transcribe.
