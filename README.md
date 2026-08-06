# Persona Coach — New Tab

A Chrome extension (Manifest V3) that replaces your **New Tab** page with a lightweight, AI-powered personal coach. You set one goal for the day, and the extension reacts to what you actually wrote instead of throwing generic motivational quotes at you.

No backend, no account, no data collection — it's **BYOK (Bring Your Own Key)**: you paste your own Gemini or OpenAI API key, and it stays on your machine.

## Why

Most "productivity new tab" extensions either show static quotes or aggressively track your browsing. Persona Coach does neither:

- It only ever knows the one goal you typed in.
- It calls the AI provider directly from your browser — there's no third-party server sitting in the middle of your API key or your data.
- If you don't have a key, or you're offline, or the API fails, it quietly falls back to a small local quote bank instead of breaking.

## Features

- **Daily goal input** — type your #1 focus for the day; it's remembered until midnight.
- **Context-aware coaching prompt** — the prompt is built specifically to react to your exact goal text (not a generic template), acknowledging the real situation first and then giving a direct, concrete push.
- **BYOK, no backend** — supports both **Gemini** and **OpenAI**. Your key is stored only in `chrome.storage.local` on your device.
- **Automatic model selection for Gemini** — instead of hardcoding a model name that Google can retire without notice, the extension queries Gemini's own `ListModels` endpoint, ranks candidates (preferring fast/cheap stable models), caches the result for 24h, and automatically retries the next candidate if one is unavailable.
- **Real token usage tracking** — logs the provider's own reported token counts per day (not an estimate) and shows a running total in Settings.
- **Quota-aware fallback** — if a call fails with a rate-limit (429) response, the UI clearly signals a quota issue rather than pretending the fallback quote was the AI's real answer.
- **30-minute response caching** — avoids refetching on every new tab; manual refresh button available.
- **Offline-safe** — if there's no key, no connection, or the API errors out, it shows a local fallback quote instead of a broken UI.

## Installation (unpacked / developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.
5. Open a new tab — set your goal, then open **Settings** (gear icon) to paste your Gemini or OpenAI API key.

> Get a free Gemini API key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey), or an OpenAI key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

## Tech stack

Plain HTML/CSS/JavaScript, Manifest V3, `chrome.storage.local` for persistence — no build step, no external dependencies, no bundler.

## Project structure

```
coach-extension/
├── manifest.json      # MV3 manifest, new-tab override, permissions
├── newtab.html        # New tab UI
├── app.js             # Core logic: persona prompts, provider calls, caching, storage
├── styles.css          # Styling
├── quotes.json         # Offline fallback quotes
└── icons/               # Extension icons
```

## Privacy

- No analytics, no telemetry, no remote server of any kind.
- Your API key never leaves your browser except in direct calls to the provider you selected (Google or OpenAI).
- All state (goal, key, cached message, usage stats) lives in local extension storage and is never synced anywhere by this project.

## Roadmap / ideas

- Additional coaching personas beyond the current "tough-love" style.
- Optional Chrome Sync storage for cross-device goal continuity.
- Streaks / history view for past goals.

## License

MIT — feel free to fork, learn from, or build on this.

---

Built as a hands-on exploration of prompt design and Chrome Extension (MV3) architecture, with AI assistance in the implementation.
