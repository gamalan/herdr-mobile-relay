declare module "@moonshine-ai/moonshine-js" {
	export const Settings: {
		BASE_ASSET_PATH: {
			MOONSHINE: string;
			ONNX_RUNTIME: string;
			SILERO_VAD: string;
		};
		FRAME_SIZE: number;
		STREAM_UPDATE_INTERVAL: number;
		STREAM_COMMIT_MIN_INTERVAL: number;
		STREAM_COMMIT_MAX_INTERVAL: number;
		STREAM_COMMIT_EMA_THRESHOLD: number;
		STREAM_COMMIT_EMA_PERIOD: number;
		VAD_COMMIT_INTERVAL: number;
		VERBOSE_LOGGING: boolean;
	};

	export interface TranscriberCallbacks {
		onError: (error: unknown) => void;
		onModelLoaded: () => void;
		onModelLoadStarted: () => void;
		onPermissionsRequested: () => void;
		onSpeechContinuing: (audio: Float32Array) => void;
		onSpeechEnd: (audio: Float32Array) => void;
		onSpeechStart: () => void;
		onTranscribeStarted: () => void;
		onTranscribeStopped: () => void;
		onTranscriptionCommitted: (text: string, audio?: AudioBuffer) => void;
		onTranscriptionUpdated: (text: string, audio: Float32Array) => void;
	}

	export class Transcriber {
		callbacks: Partial<TranscriberCallbacks>;
		isActive: boolean;
		isLoaded: boolean;
		constructor(
			modelURL: string,
			callbacks: Partial<TranscriberCallbacks>,
			useVAD: boolean,
			precision: string,
		);
		attachStream(stream: MediaStream): void;
		detachStream(): void;
		getAudioBuffer(buffer: Float32Array): AudioBuffer;
		load(): Promise<void>;
		start(): Promise<void>;
		stop(): void;
	}

	export class MicrophoneTranscriber extends Transcriber {
		constructor(
			modelURL: string,
			callbacks: Partial<TranscriberCallbacks>,
			useVAD?: boolean,
			precision?: string,
		);
	}

	export class MoonshineModel {
		constructor(inputModelURL: string, precision?: string);
		benchmark(sampleSize?: number): Promise<number>;
		generate(audio: Float32Array): Promise<string>;
		getLatency(): number;
		isLoaded(): boolean;
		isLoading(): boolean;
		loadModel(): Promise<void>;
	}
}
