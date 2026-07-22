# Voice Input — Speech-to-Text

Add push-to-talk voice input to the herdr-mobile-relay PWA. Audio is captured in the
browser, sent to the relay via WebSocket, transcoded to WAV, forwarded to a
configured STT endpoint (router like omnirouter or direct provider), and the
transcribed text is inserted into the composer for review before sending.

## Architecture

```
┌──────────────────────┐     WebSocket                    ┌──────────────────┐
│   PWA (Svelte)       │     { transcribe_audio }         │  Relay (Python)  │
│                      │ ──────────────────────────────▶ │                  │
│  Mic button →        │     { transcribe_result }        │  ffmpeg transcode│
│  MediaRecorder       │ ◀────────────────────────────── │  WebM/Opus → WAV │
│  → WebM/Opus blob    │                                 │  16kHz/16bit     │
│                      │                                 │                  │
│  Result text goes    │                                 │  POST configured  │
│  into composer       │                                 │  STT endpoint     │
└──────────────────────┘                                 │  (router/provider)│
                                                          └──────────────────┘
```

## UX Flow

1. **Idle state** — Mic button visible next to Send button. Text composer active.
2. **Tap mic** — MediaRecorder starts. Mic button changes to recording indicator
   (pulsing red dot). Two buttons appear: Submit (✓) and Cancel (✕). Text
   input and Send button are disabled.
3. **Recording** — User speaks. Visual indicator shows recording is active.
4. **Tap ✓ (Submit)** — Recording stops. Blob is base64-encoded and sent to
   relay via WebSocket. Buttons show loading state.
5. **Relay processing** — Relay decodes audio, transcodes to WAV via ffmpeg,
   forwards to configured STT endpoint (router or provider), returns text.
6. **Result** — Transcribed text is inserted into the composer. Recording UI
   resets to idle state. User can edit text before sending.
7. **Tap ✕ (Cancel)** — Recording stops. Blob discarded. UI returns to idle.

## Audio Pipeline

| Stage | Format | Notes |
| ------- | -------- | ------- |
| Browser capture | WebM/Opus | MediaRecorder default codec |
| Relay transcode | WAV 16kHz 16-bit mono | ffmpeg conversion |
| STT endpoint | multipart/form-data | OpenAI-compatible /v1/audio/transcriptions |
| ASR provider | Configurable | Router (omnirouter) or direct (Deepgram, OpenAI, Groq, etc.) |

## Configuration

**File:** `~/.config/herdr/agent-profiles.ini`

```ini
[transcribe]
# STT endpoint URL — can be a router (OpenAI-compatible) or direct provider:
#   omnirouter: http://localhost:20128/v1/audio/transcriptions
#   Deepgram:   https://api.deepgram.com/v1/listen
#   OpenAI:     https://api.openai.com/v1/audio/transcriptions
url = http://localhost:20128/v1/audio/transcriptions

# Optional API key sent as Authorization: Bearer header
# (not needed when using omnirouter — it handles its own keys)
# api_key = dg_your_deepgram_key

# Optional model name sent as form field
# model = whisper-1

max_size_mb = 25
timeout_s = 30
```

## Implementation

### Relay (`relay/herdr_relay.py`)

- `_read_transcribe_config()` — reads `[transcribe]` section from
  `agent-profiles.ini` (respects `XDG_CONFIG_HOME`/`~/.config/herdr/`)
- `transcribe_audio()` — decodes base64, transcodes via ffmpeg, POSTs to
  configured endpoint, returns text
- WebSocket message type `transcribe_audio` dispatched in `handle_client()`
- Result returned as `transcribe_result` message
- Added to `RELAY_CAPABILITIES` so frontend knows feature is available
- Dependency: `httpx>=0.27.0` for async HTTP

### Frontend (`frontend/src/lib/store.ts`)

- `transcribeAudio(relayId, data, mime)` — sends base64-encoded audio via
  WebSocket, returns Promise resolving to transcribed text
- `handleTranscribeResult()` — resolves/rejects the pending promise

### Frontend (`frontend/src/components/TerminalView.svelte`)

- Mic button (SVG icon) beside image attach button
- `startRecording()` — requests `getUserMedia`, creates `MediaRecorder`
- `stopRecording(submit)` — stops recording, sends blob on submit
- Recording UI: pulsing red dot indicator, ✓ and ✕ buttons
- Inputs disabled during recording (textarea, send, other buttons)
- Transcribed text inserted into composer for review

## Security

- API keys stored only in `~/.config/herdr/agent-profiles.ini`, never
  exposed to the PWA
- Audio data sent over WebSocket (same connection as chat, already
  authenticated via `HERDR_RELAY_TOKEN`)
- Temp WAV files cleaned up after transcription
- Audio limited to configured `max_size_mb` (default 25 MB)
