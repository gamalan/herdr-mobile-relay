/**
 * Speech-to-text engine abstraction.
 *
 * Supports multiple on-device models:
 * - moonshine-tiny: Moonshine Tiny (English, 26M params, fast)
 * - moonshine-base: Moonshine Base English (58M params, from HuggingFace)
 * - whisper-base:  Whisper Base via Transformers.js
 * - whisper-small: Whisper Small via Transformers.js
 *
 * Remote mode sends audio to the relay's configured STT endpoint.
 */

import type { VoiceModel } from './types';

// ── Types ──────────────────────────────────────────────────────────

export interface SttCallbacks {
  /** Called when a chunk of transcription is ready (incremental). */
  onChunk: (text: string) => void;
  /** Called when the model starts loading. */
  onLoading: () => void;
  /** Called when the model is loaded. */
  onReady: () => void;
  /** Called on error. */
  onError: (message: string) => void;
}

// ── Moonshine backend (VAD-based, incremental) ─────────────────────

type MoonshineModule = typeof import('@moonshine-ai/moonshine-js');
let moonshineMod: MoonshineModule | null = null;
let moonshineTranscriber: InstanceType<
  MoonshineModule['MicrophoneTranscriber']
> | null = null;
let moonshineLoadPromise: Promise<void> | null = null;

async function loadMoonshine(model: 'moonshine-tiny' | 'moonshine-base'): Promise<void> {
  if (moonshineTranscriber?.isActive) return;
  if (moonshineLoadPromise) return moonshineLoadPromise;

  moonshineLoadPromise = (async () => {
    const M = await import('@moonshine-ai/moonshine-js');
    moonshineMod = M;

    // Point to the right model URL
    if (model === 'moonshine-base') {
      M.Settings.BASE_ASSET_PATH.MOONSHINE =
        'https://huggingface.co/UsefulSensors/moonshine/resolve/main/onnx/merged/base';
    }
    // For tiny, the default CDN path (https://download.moonshine.ai/) is used with "model/tiny"

    const instance = new M.MicrophoneTranscriber(
      model === 'moonshine-tiny' ? 'model/tiny' : '',
      {},
      true, // useVAD = true gives soft 10s chunks
      'quantized',
    );
    await instance.load();
    moonshineTranscriber = instance;
  })();

  try {
    await moonshineLoadPromise;
  } catch (error) {
    moonshineLoadPromise = null;
    moonshineTranscriber = null;
    throw error;
  }
}

async function startMoonshineRecording(
  callbacks: SttCallbacks,
  model: 'moonshine-tiny' | 'moonshine-base',
): Promise<() => string> {
  callbacks.onLoading();
  try {
    await loadMoonshine(model);
  } catch (error) {
    callbacks.onError(
      `Failed to load speech model: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return () => '';
  }
  callbacks.onReady();

  if (!moonshineTranscriber || !moonshineMod) {
    callbacks.onError('Speech model not available');
    return () => '';
  }

  let accumulatedText = '';

  const sessionCallbacks: Partial<import('@moonshine-ai/moonshine-js').TranscriberCallbacks> = {
    onTranscriptionCommitted(text: string) {
      if (!text) return;
      accumulatedText = accumulatedText ? `${accumulatedText}\n${text}` : text;
      callbacks.onChunk(accumulatedText);
    },
    onError(error: unknown) {
      callbacks.onError(
        error instanceof Error ? error.message : String(error),
      );
    },
  };

  // Merge into existing defaults so no-op stubs remain for callbacks we don't provide.
  moonshineTranscriber.callbacks = {
    ...moonshineTranscriber.callbacks,
    ...sessionCallbacks,
  };

  try {
    await moonshineTranscriber.start();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    callbacks.onError(`Failed to start recording: ${msg}`);
    return () => accumulatedText;
  }

  return () => {
    try {
      if (moonshineTranscriber?.isActive) {
        moonshineTranscriber.stop();
      }
    } catch {
      // ignore
    }
    return accumulatedText;
  };
}

// ── Whisper backend (record-then-transcribe) ────────────────────────

type WhisperPipeline = (
  audio: Float32Array | Blob | string,
) => Promise<Record<string, unknown>>;

let whisperPipeline: WhisperPipeline | null = null;
let whisperModelId: string | null = null;
let whisperLoadPromise: Promise<void> | null = null;

async function loadWhisper(model: 'whisper-base' | 'whisper-small'): Promise<void> {
  const hfModelId =
    model === 'whisper-small'
      ? 'Xenova/whisper-small'
      : 'Xenova/whisper-base';

  if (whisperPipeline && whisperModelId === hfModelId) return;
  if (whisperLoadPromise) return whisperLoadPromise;

  whisperLoadPromise = (async () => {
    const mod: Record<string, unknown> = await import('@huggingface/transformers');
    const pipeFn = mod.pipeline as
      | ((task: string, model: string) => Promise<unknown>)
      | undefined;
    if (!pipeFn) throw new Error('pipeline not found in @huggingface/transformers');
    const pipe = await pipeFn('automatic-speech-recognition', hfModelId);
    whisperPipeline = pipe as WhisperPipeline;
    whisperModelId = hfModelId;
  })();

  try {
    await whisperLoadPromise;
  } catch (error) {
    whisperLoadPromise = null;
    whisperPipeline = null;
    whisperModelId = null;
    throw error;
  }
}

async function startWhisperRecording(
  callbacks: SttCallbacks,
  model: 'whisper-base' | 'whisper-small',
): Promise<() => Promise<string>> {
  let audioChunks: Blob[] = [];
  let mediaRecorder: MediaRecorder | null = null;
  let recordingStream: MediaStream | null = null;
  let stopped = false;

  callbacks.onLoading();
  try {
    await loadWhisper(model);
  } catch (error) {
    callbacks.onError(
      `Failed to load speech model: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return async () => '';
  }
  callbacks.onReady();

  // Start recording
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingStream = stream;
    audioChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    mediaRecorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    recorder.onstop = () => {
      recordingStream?.getTracks().forEach((t) => t.stop());
      recordingStream = null;
    };

    recorder.start();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Microphone access denied';
    callbacks.onError(`Recording failed: ${msg}`);
    return async () => '';
  }

  return async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return '';
    if (stopped) return '';
    stopped = true;

    mediaRecorder.stop();
    mediaRecorder = null;

    // Wait for ondataavailable to fire
    await new Promise((r) => setTimeout(r, 150));

    if (audioChunks.length === 0) return '';

    const blob = new Blob(audioChunks, { type: 'audio/webm' });

    try {
      callbacks.onLoading(); // re-use as "Transcribing…"
      if (!whisperPipeline) return '';

      const result = await whisperPipeline(blob);
      const data = result as Record<string, unknown>;
      const text =
        typeof data.text === 'string'
          ? data.text
          : Array.isArray(data)
            ? (data as Array<Record<string, unknown>>)
                .map((r) => String(r.text || ''))
                .join(' ')
            : '';

      return text;
    } catch (error) {
      callbacks.onError(
        `Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return '';
    }
  };
}

// ── Unified API ─────────────────────────────────────────────────────

/**
 * Start on-device transcription with the given model.
 *
 * @param model - The voice model to use
 * @param callbacks - Event callbacks for this recording session
 * @returns A stop function: call it to stop recording and get accumulated text.
 *          For Moonshine models the stop function returns the text synchronously;
 *          for Whisper models it returns a Promise<string> (async).
 */
type StopFn = () => string | Promise<string>;

/**
 * Start on-device transcription with the given model.
 * The returned stop function may return a string (synchronous, Moonshine)
 * or a Promise<string> (asynchronous, Whisper).
 */
export async function startLocalTranscription(
  model: VoiceModel,
  callbacks: SttCallbacks,
): Promise<StopFn> {
  if (model === 'whisper-base' || model === 'whisper-small') {
    return startWhisperRecording(callbacks, model);
  }
  // Default to Moonshine
  const mm = model === 'moonshine-base' ? 'moonshine-base' : 'moonshine-tiny';
  return startMoonshineRecording(callbacks, mm);
}
