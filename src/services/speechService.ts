import type { VisemeType } from '../data/avatars';
import {
  lipSyncService,
  buildArabicVisemeTimeline,
  type LipSyncTelemetry,
  type LipSyncCalibrationOptions,
} from './lipSyncService';

export {
  lipSyncService,
  buildArabicVisemeTimeline,
  type LipSyncTelemetry,
  type LipSyncCalibrationOptions,
};

export interface SpeechCallbacks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onEnd?: () => void;
  onViseme?: (
    amplitude: number,
    viseme: VisemeType,
    telemetry?: LipSyncTelemetry
  ) => void;
  onError?: (err: any) => void;
}

class SpeechService {
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private cleanupLipSyncSession: (() => void) | null = null;
  private isSpeaking = false;
  private isPaused = false;
  private synthIntervalId: any = null;
  private playbackSessionId = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.getVoices();
        };
      }

      // Mobile iOS Safari & Android Chrome AudioContext Auto-Unlocker on first user gesture
      const unlockHandler = () => {
        this.unlockAudioContext();
      };
      window.addEventListener('pointerdown', unlockHandler, { once: true, passive: true });
      window.addEventListener('touchstart', unlockHandler, { once: true, passive: true });
      window.addEventListener('keydown', unlockHandler, { once: true, passive: true });
    }
  }

  public setCalibration(opts: LipSyncCalibrationOptions) {
    lipSyncService.setCalibration(opts);
  }

  public getCalibration(): Required<LipSyncCalibrationOptions> {
    return lipSyncService.getCalibration();
  }

  public getAudioContextState(): string {
    if (!this.audioCtx) return 'uninitialized';
    return this.audioCtx.state;
  }

  public unlockAudioContext() {
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      // Play a 1-sample silent buffer to unlock iOS Safari Web Audio output
      const silentBuf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = silentBuf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // ignore
    }
  }

  private getAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass({ latencyHint: 'interactive' });
      lipSyncService.ensureWorkletRegistered(this.audioCtx).catch(() => {});
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }

  public async pause() {
    if (!this.isSpeaking || this.isPaused) return;
    this.isPaused = true;
    if (this.audioCtx && this.audioCtx.state === 'running') {
      await this.audioCtx.suspend();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
    }
  }

  public async resume() {
    if (!this.isSpeaking || !this.isPaused) return;
    this.isPaused = false;
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }
  }

  public stop() {
    this.playbackSessionId++;
    this.isSpeaking = false;
    this.isPaused = false;

    if (this.cleanupLipSyncSession) {
      this.cleanupLipSyncSession();
      this.cleanupLipSyncSession = null;
    }
    this.analyser = null;

    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // ignore
      }
      this.currentSource = null;
    }
    if (this.synthIntervalId) {
      clearInterval(this.synthIntervalId);
      this.synthIntervalId = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Play server-generated audio base64 (WAV or MP3) with Real-Time AudioWorklet FFT Lip Sync:
   * - Uses LipSyncService's AudioWorkletProcessor to compute 512-point FFT directly on the audio thread
   * - Combines real-time acoustic RMS, ZCR, and Formant bands (F1/F2/Bilabial/Fricative) with time-aligned Arabic phonetic cues
   */
  public async playGeminiAudio(
    base64Audio: string,
    callbacks: SpeechCallbacks = {},
    options: {
      rate?: number;
      pitch?: number;
      text?: string;
      calibration?: LipSyncCalibrationOptions;
    } = {}
  ) {
    this.stop();
    const currentSession = ++this.playbackSessionId;

    if (options.calibration) {
      this.setCalibration(options.calibration);
    }

    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Ensure AudioWorklet FFT module is registered on this AudioContext before playback
      await lipSyncService.ensureWorkletRegistered(ctx);

      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));

      if (currentSession !== this.playbackSessionId) {
        return;
      }

      this.runBufferLipSync(ctx, audioBuffer, callbacks, options);
    } catch (err) {
      if (currentSession !== this.playbackSessionId) return;
      this.stop();
      callbacks.onViseme?.(0, 'rest');
      callbacks.onError?.(err);
    }
  }

  /**
   * Synthesize an instant Web Audio Arabic Formant Test Sequence (for zero-latency calibration testing even offline)
   */
  public async playCalibrationTestSequence(
    callbacks: SpeechCallbacks = {},
    calibration?: LipSyncCalibrationOptions
  ) {
    this.stop();
    const currentSession = ++this.playbackSessionId;
    if (calibration) this.setCalibration(calibration);

    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      await lipSyncService.ensureWorkletRegistered(ctx);

      const sampleRate = ctx.sampleRate || 24000;
      const durationSec = 3.6;
      const totalSamples = Math.floor(sampleRate * durationSec);
      const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
      const data = buffer.getChannelData(0);

      // Syllables:
      // 0.0-0.55s: "بَا" (closed_m -> open_a, F1=760Hz, F2=1250Hz)
      // 0.55-0.78s: Silence (rest)
      // 0.78-1.38s: "مُو" (closed_m -> open_o, F1=380Hz, F2=820Hz)
      // 1.38-1.62s: Silence (rest)
      // 1.62-2.22s: "فِي" (closed_m -> spread_e, F1=320Hz, F2=2250Hz)
      // 2.22-2.48s: Silence (rest)
      // 2.48-3.38s: "قَيْس" (open_a -> spread_e)
      const segments = [
        { start: 0.05, end: 0.16, f0: 130, f1: 220, f2: 900, amp: 0.22 }, // ب (bilabial murmur)
        { start: 0.16, end: 0.55, f0: 135, f1: 760, f2: 1250, amp: 0.85 }, // ا (open_a)
        { start: 0.78, end: 0.92, f0: 128, f1: 240, f2: 850, amp: 0.25 }, // م (bilabial murmur)
        { start: 0.92, end: 1.38, f0: 132, f1: 380, f2: 820, amp: 0.75 }, // و (open_o)
        { start: 1.62, end: 1.75, f0: 140, f1: 260, f2: 1900, amp: 0.22 }, // ف (labiodental)
        { start: 1.75, end: 2.22, f0: 142, f1: 320, f2: 2250, amp: 0.72 }, // ي (spread_e)
        { start: 2.48, end: 2.95, f0: 136, f1: 720, f2: 1350, amp: 0.82 }, // قَ (open_a)
        { start: 2.95, end: 3.38, f0: 130, f1: 350, f2: 2150, amp: 0.65 }, // يْس (spread_e)
      ];

      for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        let sample = 0;
        for (const seg of segments) {
          if (t >= seg.start && t <= seg.end) {
            const localT = (t - seg.start) / (seg.end - seg.start);
            const env = Math.sin(localT * Math.PI);
            const fundamental = Math.sin(2 * Math.PI * seg.f0 * t) * 0.45;
            const formant1 = Math.sin(2 * Math.PI * seg.f1 * t) * 0.35;
            const formant2 = Math.sin(2 * Math.PI * seg.f2 * t) * 0.2;
            sample = (fundamental + formant1 + formant2) * seg.amp * env;
            break;
          }
        }
        data[i] = sample;
      }

      if (currentSession !== this.playbackSessionId) return;

      this.runBufferLipSync(ctx, buffer, callbacks, {
        text: 'با ، مو ، في ، قيس',
        rate: 1.0,
      });
    } catch (err) {
      this.stop();
      callbacks.onError?.(err);
    }
  }

  private runBufferLipSync(
    ctx: AudioContext,
    audioBuffer: AudioBuffer,
    callbacks: SpeechCallbacks,
    options: { rate?: number; pitch?: number; text?: string }
  ) {
    const currentSession = this.playbackSessionId;
    const playbackRate =
      options.rate && options.rate >= 0.6 && options.rate <= 1.6 ? options.rate : 1.0;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;

    if (options.pitch && source.detune) {
      source.detune.value = (options.pitch - 1.0) * 1200;
    }

    this.currentSource = source;
    const effectiveDurationSec = audioBuffer.duration / playbackRate;

    this.isSpeaking = true;
    this.isPaused = false;
    callbacks.onStart?.();

    const session = lipSyncService.startAudioAnalysisSession({
      ctx,
      source,
      effectiveDurationSec,
      text: options.text,
      isPaused: () => this.isPaused,
      isActive: () => this.isSpeaking && currentSession === this.playbackSessionId,
      onFrame: (amplitude, viseme, telemetry) => {
        callbacks.onViseme?.(amplitude, viseme, telemetry);
      },
    });

    this.cleanupLipSyncSession = session.cleanup;
    this.analyser = session.analyser;

    source.onended = () => {
      if (currentSession !== this.playbackSessionId) return;
      this.stop();
      callbacks.onViseme?.(0, 'rest', {
        rms: 0,
        amplitude: 0,
        viseme: 'rest',
        f1Energy: 0,
        f2Energy: 0,
        bilabialEnergy: 0,
        fricativeEnergy: 0,
        zcr: 0,
        syncDeltaMs: 0,
        audioContextState: ctx.state,
        sourceType: 'idle',
        currentTimeSec: effectiveDurationSec,
        durationSec: effectiveDurationSec,
      });
      callbacks.onEnd?.();
    };

    source.start(0);
  }

  // Fallback to browser SpeechSynthesis API with boundary-aligned Arabic phonetic cues
  public speakWithWebSpeech(
    text: string,
    options: {
      lang?: string;
      pitch?: number;
      rate?: number;
      calibration?: LipSyncCalibrationOptions;
    } = {},
    callbacks: SpeechCallbacks = {}
  ) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      callbacks.onError?.(new Error('المتصفح لا يدعم النطق الصوتي المحلي'));
      callbacks.onEnd?.();
      return;
    }

    this.stop();
    const currentSession = ++this.playbackSessionId;

    if (options.calibration) {
      this.setCalibration(options.calibration);
    }

    const cleanText = text.replace(/[#*`_~]/g, '').trim();
    if (!cleanText) {
      callbacks.onEnd?.();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = options.lang || 'ar-SA';
    utterance.pitch = options.pitch ?? 1;
    utterance.rate = options.rate ?? 1;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice =
      voices.find((v) => v.lang === options.lang) ||
      voices.find((v) => v.lang.startsWith('ar')) ||
      voices.find((v) => v.name.toLowerCase().includes('arabic'));

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    const timeline = buildArabicVisemeTimeline(cleanText);
    const estimatedTotalMs = Math.max(
      900,
      (cleanText.length * 72) / (options.rate || 1)
    );
    let speechStartedAt = 0;
    let boundaryCharIndex = 0;
    let smoothedAmp = 0;

    utterance.onstart = () => {
      if (currentSession !== this.playbackSessionId) return;
      this.isSpeaking = true;
      speechStartedAt = performance.now();
      callbacks.onStart?.();

      this.synthIntervalId = setInterval(() => {
        if (!this.isSpeaking || this.isPaused || currentSession !== this.playbackSessionId) {
          return;
        }
        const cal = this.getCalibration();
        const elapsedMs = performance.now() - speechStartedAt + cal.latencyOffsetMs;
        const progress = Math.max(0, Math.min(1, elapsedMs / estimatedTotalMs));

        const cue =
          timeline.find((c) => progress >= c.startRatio && progress <= c.endRatio) ||
          timeline[Math.min(timeline.length - 1, boundaryCharIndex)];

        const v: VisemeType = cue?.viseme || 'open_a';
        const targetAmp =
          v === 'rest'
            ? 0
            : v === 'closed_m'
            ? 0.14
            : v === 'dental_d'
            ? 0.35
            : v === 'spread_e'
            ? 0.52
            : v === 'open_o'
            ? 0.65
            : 0.78;

        const scaledTarget = Math.min(1, targetAmp * cal.sensitivity);
        smoothedAmp += (scaledTarget - smoothedAmp) * (1 - cal.smoothing * 0.5);

        callbacks.onViseme?.(smoothedAmp, v, {
          rms: smoothedAmp * 0.7,
          amplitude: smoothedAmp,
          viseme: v,
          f1Energy: v === 'open_a' ? 0.75 : 0.35,
          f2Energy: v === 'spread_e' ? 0.78 : 0.3,
          bilabialEnergy: v === 'closed_m' ? 0.85 : 0.2,
          fricativeEnergy: 0.1,
          zcr: 0.12,
          syncDeltaMs: 0,
          audioContextState: this.getAudioContextState(),
          sourceType: 'web-speech-estimated',
          currentTimeSec: elapsedMs / 1000,
          durationSec: estimatedTotalMs / 1000,
        });
      }, 45);
    };

    utterance.onboundary = (event) => {
      if (typeof event.charIndex === 'number') {
        boundaryCharIndex = event.charIndex;
      }
    };

    utterance.onend = () => {
      if (currentSession !== this.playbackSessionId) return;
      this.stop();
      callbacks.onViseme?.(0, 'rest');
      callbacks.onEnd?.();
    };

    utterance.onerror = () => {
      if (currentSession !== this.playbackSessionId) return;
      this.stop();
      callbacks.onViseme?.(0, 'rest');
      callbacks.onEnd?.();
    };

    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      this.stop();
      callbacks.onError?.(err);
      callbacks.onEnd?.();
    }
  }
}

export const speechService = new SpeechService();
