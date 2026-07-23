/**
 * Speech-to-text engine abstraction.
 *
 * Supports two modes:
 * - local: on-device transcription via MoonshineJS (MicrophoneTranscriber with VAD)
 * - remote: sends audio to the relay's configured STT endpoint
 */

import { MicrophoneTranscriber } from '@moonshine-ai/moonshine-js';
import type { TranscriberCallbacks } from '@moonshine-ai/moonshine-js';

// Cache the transcriber instance so the model loads only once.
let cachedTranscriber: MicrophoneTranscriber | null = null;
let loadPromise: Promise<void> | null = null;

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

/**
 * Load the Moonshine model (lazy, caches after first load).
 * Resolves when the model is ready for transcription.
 */
export async function loadLocalModel(): Promise<void> {
  if (cachedTranscriber?.isActive) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Use the "tiny" model for faster loading; change to "base-es-non-commercial" for better accuracy.
    const instance = new MicrophoneTranscriber(
      'model/tiny',
      {},
      true, // useVAD = true gives us soft 10s chunks
      'quantized',
    );
    await instance.load();
    cachedTranscriber = instance;
  })();

  try {
    await loadPromise;
  } catch (error) {
    loadPromise = null;
    cachedTranscriber = null;
    throw error;
  }
}

/**
 * Start local (Moonshine) transcription.
 * The model is loaded lazily if not already cached.
 *
 * @param callbacks - Event callbacks for this recording session
 * @returns A function to stop recording and get the full accumulated text
 */
export async function startLocalTranscription(
  callbacks: SttCallbacks,
): Promise<() => string> {
  // Load model if needed
  callbacks.onLoading();
  try {
    await loadLocalModel();
  } catch (error) {
    callbacks.onError(
      `Failed to load speech model: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return () => '';
  }
  callbacks.onReady();

  if (!cachedTranscriber) {
    callbacks.onError('Speech model not available');
    return () => '';
  }

  // Track accumulated chunks during this session
  let accumulatedText = '';

  const sessionCallbacks: Partial<TranscriberCallbacks> = {
    onTranscriptionCommitted(text: string) {
      if (!text) return;
      accumulatedText = accumulatedText ? `${accumulatedText}\n${text}` : text;
      callbacks.onChunk(accumulatedText);
    },
    onError(error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      callbacks.onError(msg);
    },
  };

  // Assign callbacks to the existing transcriber instance.
  cachedTranscriber.callbacks = sessionCallbacks;

  try {
    await cachedTranscriber.start();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    callbacks.onError(`Failed to start recording: ${msg}`);
    return () => accumulatedText;
  }

  // Return a stop function that stops recording and returns accumulated text
  return () => {
    try {
      if (cachedTranscriber?.isActive) {
        cachedTranscriber.stop();
      }
    } catch {
      // Ignore stop errors
    }
    return accumulatedText;
  };
}

/**
 * Check if the Moonshine model has been loaded and cached.
 */
export function isModelLoaded(): boolean {
  return cachedTranscriber !== null && cachedTranscriber.isLoaded;
}
