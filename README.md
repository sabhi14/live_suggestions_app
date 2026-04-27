# Live Suggestions App

Real-time meeting copilot that listens to microphone audio, transcribes continuously, generates live speaking suggestions, and supports detailed chat follow-ups with full session export.

## Project Overview

This assignment implements an end-to-end real-time assistant:

- **Capture** audio in the browser using `MediaRecorder`
- **Transcribe** chunked audio through Groq Whisper (`whisper-large-v3`)
- **Suggest** exactly 3 varied next-response options per refresh
- **Assist** with contextual chat answers
- **Persist** configurable prompts/settings in `localStorage`
- **Export** full session JSON with timestamps and metadata

## Stack Choices

- **Frontend:** Angular (standalone components), Signals, HttpClient, simple CSS
- **Backend:** Spring Boot 3 (Java 17), REST controllers, DTOs, global exception handling
- **LLM/ASR Provider:** Groq OpenAI-compatible endpoints
  - Transcription model: `whisper-large-v3`
  - Chat model: `openai/gpt-oss-120b`
- **State Model:** Central Angular store service for recording, transcript, suggestions, chat, settings, and export

## Run Backend

```bash
cd backend
mvn spring-boot:run
```

Backend runs on `http://localhost:8080` with CORS enabled for `http://localhost:4200`.

## Run Frontend

```bash
cd frontend
npm install
npm start
```

Frontend runs on `http://localhost:4200`.

## Groq API Key Setup

1. Open the app in browser.
2. Click **Settings** (top right).
3. Paste Groq key into **Groq API Key**.
4. Click **Done**.

Notes:
- Key is sent as `X-Groq-Api-Key` header to backend.
- Key is stored in browser `localStorage` for convenience.
- Session export intentionally removes the key.

## Prompt Strategy

The app exposes editable prompts for:

- **Live suggestion prompt**
- **Detailed answer prompt**
- **Chat prompt**

Default live suggestion prompt is tuned for real-time meetings and forces:

- exactly 3 suggestions
- varied intent:
  - answer/fact/explanation
  - follow-up question/talking point
  - clarification/risk/fact-check
- valid JSON-only output for robust parsing

This makes output consistent for UI rendering while preserving variety and usefulness.

## Context Window Strategy

Configurable windows (minutes) are used per feature:

- Live suggestions (default: `5`)
- Detailed answer (default: `15`)
- Chat (default: `15`)

Transcript chunks are timestamped and filtered by recency window before each API call.  
If a window returns no chunks, the app safely falls back to full transcript context.

## Latency Tradeoffs

- **Short audio chunks** (default `30s`) reduce perceived delay but increase API call frequency.
- **Longer chunks** reduce call volume but delay transcript/suggestion freshness.
- **Smaller context windows** are faster/cheaper but can miss earlier details.
- **Larger context windows** improve continuity but increase token usage and response latency.

## Known Limitations

- No authentication/user accounts; key is client-provided.
- No server-side session/database persistence.
- Browser microphone behavior varies by device/browser permissions.
- Suggestion JSON correctness still depends on model compliance (guarded but not guaranteed).
- Backend currently serializes context into prompts rather than using structured tool schema.

## Deployment Notes

- Frontend and backend can be deployed independently.
- Configure backend CORS for deployed frontend origin.
- Prefer environment-based backend URL in frontend for production builds.
- Use HTTPS in production for microphone access and secure API key handling.
- For scale: add request logging, rate limiting, retry/backoff policy, and secret management.

## Assignment Requirements Checklist

- [x] Spring Boot backend with `/api/transcribe`, `/api/suggestions`, `/api/chat`
- [x] Groq integration for transcription and chat-completions
- [x] Angular 3-column UI (transcript, suggestions, chat)
- [x] Browser microphone permission + start/stop recording
- [x] `MediaRecorder` chunked transcription pipeline
- [x] Auto suggestions after transcript updates + manual refresh
- [x] Exactly 3 suggestions per batch
- [x] Centralized frontend state service
- [x] Editable prompt-engineering settings
- [x] Context-window controls by feature
- [x] Audio chunk duration setting
- [x] Settings persistence via `localStorage`
- [x] Session export JSON with timestamps and required metadata
- [x] Export filename format: `twinmind-session-YYYY-MM-DD-HH-mm.json`
