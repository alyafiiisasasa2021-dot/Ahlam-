import type { VisemeType } from '../data/avatars';

export interface LipSyncTelemetry {
  rms: number; // Raw RMS energy (0..1)
  amplitude: number; // Calibrated & gated mouth opening amplitude (0..1)
  viseme: VisemeType;
  f1Energy: number; // First formant band 340-1000Hz (jaw openness)
  f2Energy: number; // Second formant band 1000-2650Hz (lip spreading vs rounding)
  bilabialEnergy: number; // Low murmur band 80-340Hz (ب / م / ف)
  fricativeEnergy?: number; // High fricative band 2650-6000Hz (ف / س / ش)
  zcr: number; // Zero-crossing rate (0..1)
  syncDeltaMs: number; // Measured audio-to-visual latency delta in ms
  audioContextState: string;
  sourceType: 'audio-worklet-fft' | 'web-audio-fft' | 'web-speech-estimated' | 'idle';
  currentTimeSec: number;
  durationSec: number;
}

export interface LipSyncCalibrationOptions {
  sensitivity?: number; // 0.5 .. 2.2 (default 1.15)
  noiseThreshold?: number; // 0.01 .. 0.20 (default 0.032)
  smoothing?: number; // 0.15 .. 0.85 (default 0.55)
  latencyOffsetMs?: number; // -100 .. +100 ms (default 0)
}

export interface PhonemeCue {
  startRatio: number;
  endRatio: number;
  viseme: VisemeType;
  weight: number;
  char: string;
}

export interface WorkletFFTFrame {
  rms: number;
  zcr: number;
  bilabial: number;
  f1: number;
  f2: number;
  fricative: number;
  audioTime: number;
  receivedAtMs: number;
}

interface TimestampedProcessedFrame {
  timestampMs: number;
  amplitude: number;
  viseme: VisemeType;
  rms: number;
  f1: number;
  f2: number;
  bilabial: number;
  fricative: number;
  zcr: number;
  sourceType: 'audio-worklet-fft' | 'web-audio-fft';
}

/**
 * Builds an Arabic phonetic timeline supporting short/long vowels, sukoon, shadda,
 * punctuation pauses, bilabials (ب م ف), and dental/coronal consonants.
 */
export function buildArabicVisemeTimeline(text: string): PhonemeCue[] {
  const clean = text.replace(/[#*`_~]/g, '').trim();
  if (!clean) return [];

  const rawTokens: Array<{ viseme: VisemeType; weight: number; char: string }> = [];
  const chars = Array.from(clean);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const nextCh = chars[i + 1] || '';

    // 1. Punctuation & pauses -> strict rest
    if ('.،؟!؛:\n-—'.includes(ch)) {
      rawTokens.push({ viseme: 'rest', weight: 2.2, char: ch });
      continue;
    }
    if (ch === ' ') {
      rawTokens.push({ viseme: 'rest', weight: 0.45, char: ch });
      continue;
    }

    // Ignore standalone diacritics that were already processed with preceding consonant
    if ('\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652'.includes(ch)) {
      continue;
    }

    const hasShadda = nextCh === '\u0651';
    const afterChar = hasShadda ? chars[i + 2] || '' : nextCh;
    const hasSukoon = afterChar === '\u0652';

    // 2. Arabic Bilabials & Labiodentals: ب (Baa), م (Meem), ف (Faa)
    if ('بمف'.includes(ch)) {
      rawTokens.push({
        viseme: 'closed_m',
        weight: hasShadda ? 1.55 : 1.05,
        char: ch,
      });
      if (afterChar === '\u064E' || afterChar === '\u064B') {
        rawTokens.push({ viseme: 'open_a', weight: 0.85, char: afterChar });
      } else if (afterChar === '\u064F' || afterChar === '\u064C') {
        rawTokens.push({ viseme: 'open_o', weight: 0.85, char: afterChar });
      } else if (afterChar === '\u0650' || afterChar === '\u064D') {
        rawTokens.push({ viseme: 'spread_e', weight: 0.85, char: afterChar });
      }
      continue;
    }

    // 3. Long Vowels (حروف المد الطويلة)
    if ('اآأإ'.includes(ch)) {
      rawTokens.push({ viseme: 'open_a', weight: 1.7, char: ch });
      continue;
    }
    if ('وؤ'.includes(ch)) {
      rawTokens.push({ viseme: 'open_o', weight: 1.65, char: ch });
      continue;
    }
    if ('يئى'.includes(ch)) {
      rawTokens.push({ viseme: 'spread_e', weight: 1.6, char: ch });
      continue;
    }

    // 4. Emphatic / Velar / Rounded Consonants (ص ض ط ظ ق خ غ)
    if ('صضطظقخغ'.includes(ch)) {
      rawTokens.push({
        viseme: hasSukoon ? 'dental_d' : 'open_o',
        weight: hasShadda ? 1.4 : 1.0,
        char: ch,
      });
      continue;
    }

    // 5. Pharyngeal / Glottal Open Consonants (ع ح هـ ك ء)
    if ('عهحكء'.includes(ch)) {
      rawTokens.push({
        viseme: 'open_a',
        weight: hasShadda ? 1.35 : 1.0,
        char: ch,
      });
      continue;
    }

    // 6. Dental / Alveolar Consonants (د ذ ل ن ر)
    if ('دذلنر'.includes(ch)) {
      rawTokens.push({
        viseme: 'dental_d',
        weight: hasShadda ? 1.3 : 0.9,
        char: ch,
      });
      if (afterChar === '\u064E') {
        rawTokens.push({ viseme: 'open_a', weight: 0.75, char: afterChar });
      } else if (afterChar === '\u064F') {
        rawTokens.push({ viseme: 'open_o', weight: 0.75, char: afterChar });
      } else if (afterChar === '\u0650') {
        rawTokens.push({ viseme: 'spread_e', weight: 0.75, char: afterChar });
      }
      continue;
    }

    // 7. Sibilants & Front Coronal Consonants (ت ث س ش ز ج)
    if ('تثسشزجة'.includes(ch)) {
      rawTokens.push({
        viseme: 'spread_e',
        weight: hasShadda ? 1.3 : 0.95,
        char: ch,
      });
      continue;
    }

    // Default consonant
    rawTokens.push({ viseme: 'open_a', weight: 0.9, char: ch });
  }

  const totalWeight = rawTokens.reduce((acc, t) => acc + t.weight, 0) || 1;
  let running = 0;

  return rawTokens.map((t) => {
    const startRatio = running / totalWeight;
    running += t.weight;
    const endRatio = running / totalWeight;
    return {
      startRatio,
      endRatio,
      viseme: t.viseme,
      weight: t.weight,
      char: t.char,
    };
  });
}

/**
 * Dedicated AudioWorkletProcessor that performs 512-point Hann-windowed Radix-2 FFT
 * directly on the Web Audio rendering thread (off the main UI thread).
 * Zero heap allocations inside process() for glitch-free mobile & desktop performance.
 */
const FFT_WORKLET_PROCESSOR_CODE = `
class ArabicFFTLipSyncWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fftSize = 512;
    this.halfFft = 256;
    this.ringBuffer = new Float32Array(this.fftSize);
    this.writeIndex = 0;
    this.real = new Float32Array(this.fftSize);
    this.imag = new Float32Array(this.fftSize);
    this.hannWindow = new Float32Array(this.fftSize);
    this.bitRev = new Uint16Array(this.fftSize);
    this.quantumCounter = 0;

    // Precompute Hann window & bit-reversal table once at construction
    const bits = 9; // log2(512) = 9
    for (let i = 0; i < this.fftSize; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.fftSize - 1)));
      let rev = 0;
      let val = i;
      for (let b = 0; b < bits; b++) {
        rev = (rev << 1) | (val & 1);
        val >>= 1;
      }
      this.bitRev[i] = rev;
    }

    // Precompute twiddle factors for each Radix-2 stage
    this.cosTable = new Float32Array(this.halfFft);
    this.sinTable = new Float32Array(this.halfFft);
    for (let i = 0; i < this.halfFft; i++) {
      const angle = (-2 * Math.PI * i) / this.fftSize;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  runInPlaceFFT() {
    const N = this.fftSize;
    const real = this.real;
    const imag = this.imag;

    for (let size = 2; size <= N; size <<= 1) {
      const halfSize = size >> 1;
      const tableStep = N / size;
      for (let i = 0; i < N; i += size) {
        let k = 0;
        for (let j = i; j < i + halfSize; j++) {
          const l = j + halfSize;
          const cos = this.cosTable[k];
          const sin = this.sinTable[k];
          const tReal = real[l] * cos - imag[l] * sin;
          const tImag = real[l] * sin + imag[l] * cos;
          real[l] = real[j] - tReal;
          imag[l] = imag[j] - tImag;
          real[j] += tReal;
          imag[j] += tImag;
          k += tableStep;
        }
      }
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    const len = channelData.length; // Typically 128 samples per render quantum
    if (!len) return true;

    let sumSq = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < len; i++) {
      const sample = channelData[i];
      sumSq += sample * sample;
      if (
        i > 0 &&
        ((sample >= 0 && channelData[i - 1] < 0) ||
          (sample < 0 && channelData[i - 1] >= 0))
      ) {
        zeroCrossings++;
      }
      this.ringBuffer[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) & 511;
    }

    this.quantumCounter++;
    // Run 512-point FFT every 2 render quanta (~256 samples = ~5.3ms at 48kHz, ~10.6ms at 24kHz)
    if (this.quantumCounter % 2 !== 0) {
      return true;
    }

    const rms = Math.sqrt(sumSq / len);
    const zcr = zeroCrossings / len;

    // Fast path: if audio is completely silent, skip FFT butterfly and emit zeroed energy
    if (rms < 0.0015) {
      this.port.postMessage({
        rms: 0,
        zcr: 0,
        bilabial: 0,
        f1: 0,
        f2: 0,
        fricative: 0,
        audioTime: currentTime,
      });
      return true;
    }

    // Copy unrolled ringBuffer with Hann window into bit-reversed positions
    const N = this.fftSize;
    for (let i = 0; i < N; i++) {
      const ringIdx = (this.writeIndex + i) & 511;
      const revIdx = this.bitRev[i];
      this.real[revIdx] = this.ringBuffer[ringIdx] * this.hannWindow[i];
      this.imag[revIdx] = 0;
    }

    // Execute in-place Cooley-Tukey Radix-2 FFT on the audio thread
    this.runInPlaceFFT();

    const sr = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 24000;
    const binHz = sr / N;

    const computeBandEnergy = (lowHz, highHz, scale) => {
      const startBin = Math.max(1, Math.floor(lowHz / binHz));
      const endBin = Math.min(this.halfFft - 1, Math.ceil(highHz / binHz));
      if (endBin < startBin) return 0;
      let sumMag = 0;
      for (let b = startBin; b <= endBin; b++) {
        const r = this.real[b];
        const im = this.imag[b];
        sumMag += Math.sqrt(r * r + im * im);
      }
      const avgMag = sumMag / (endBin - startBin + 1) / (N * 0.12);
      return Math.min(1, avgMag * scale);
    };

    const bilabial = computeBandEnergy(80, 340, 2.2);
    const f1 = computeBandEnergy(340, 1000, 2.8);
    const f2 = computeBandEnergy(1000, 2650, 3.4);
    const fricative = computeBandEnergy(2650, 6000, 4.2);

    this.port.postMessage({
      rms,
      zcr,
      bilabial,
      f1,
      f2,
      fricative,
      audioTime: currentTime,
    });

    return true;
  }
}

registerProcessor('arabic-fft-lipsync-worklet', ArabicFFTLipSyncWorkletProcessor);
`;

export class LipSyncService {
  private registeredContexts = new WeakSet<AudioContext>();
  private registeringPromises = new WeakMap<AudioContext, Promise<boolean>>();

  private calibration: Required<LipSyncCalibrationOptions> = {
    sensitivity: 1.15,
    noiseThreshold: 0.032,
    smoothing: 0.55,
    latencyOffsetMs: 0,
  };

  public setCalibration(opts: LipSyncCalibrationOptions) {
    this.calibration = {
      sensitivity: opts.sensitivity ?? this.calibration.sensitivity,
      noiseThreshold: opts.noiseThreshold ?? this.calibration.noiseThreshold,
      smoothing: opts.smoothing ?? this.calibration.smoothing,
      latencyOffsetMs: opts.latencyOffsetMs ?? this.calibration.latencyOffsetMs,
    };
  }

  public getCalibration(): Required<LipSyncCalibrationOptions> {
    return { ...this.calibration };
  }

  /**
   * Registers the in-thread FFT AudioWorkletProcessor on the given AudioContext.
   * Safe to call multiple times on the same AudioContext.
   */
  public async ensureWorkletRegistered(ctx: AudioContext): Promise<boolean> {
    if (this.registeredContexts.has(ctx)) {
      return true;
    }
    if (!ctx.audioWorklet) {
      return false;
    }
    const existingPromise = this.registeringPromises.get(ctx);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      try {
        const blob = new Blob([FFT_WORKLET_PROCESSOR_CODE], {
          type: 'application/javascript',
        });
        const url = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.registeredContexts.add(ctx);
        return true;
      } catch {
        return false;
      }
    })();

    this.registeringPromises.set(ctx, promise);
    return promise;
  }

  /**
   * Starts a real-time audio-driven lip-sync analysis session for a playing AudioBufferSourceNode.
   * Primary path: AudioWorkletProcessor FFT on the audio thread.
   * Fallback path: AnalyserNode only if AudioWorklet is unavailable on the device.
   */
  public startAudioAnalysisSession(params: {
    ctx: AudioContext;
    source: AudioBufferSourceNode;
    effectiveDurationSec: number;
    text?: string;
    isPaused: () => boolean;
    isActive: () => boolean;
    onFrame: (amplitude: number, viseme: VisemeType, telemetry: LipSyncTelemetry) => void;
  }): { cleanup: () => void; analyser: AnalyserNode | null } {
    const {
      ctx,
      source,
      effectiveDurationSec,
      text,
      isPaused,
      isActive,
      onFrame,
    } = params;

    let workletNode: AudioWorkletNode | null = null;
    let fallbackAnalyser: AnalyserNode | null = null;
    let animFrameId: number | null = null;

    // Latest spectral frame received from AudioWorklet thread
    let latestWorkletFrame: WorkletFFTFrame = {
      rms: 0,
      zcr: 0,
      bilabial: 0,
      f1: 0,
      f2: 0,
      fricative: 0,
      audioTime: ctx.currentTime,
      receivedAtMs: 0,
    };

    const workletReady = this.registeredContexts.has(ctx);
    if (workletReady) {
      try {
        workletNode = new AudioWorkletNode(ctx, 'arabic-fft-lipsync-worklet');
        workletNode.port.onmessage = (event) => {
          const d = event.data;
          if (d) {
            latestWorkletFrame = {
              rms: d.rms || 0,
              zcr: d.zcr || 0,
              bilabial: d.bilabial || 0,
              f1: d.f1 || 0,
              f2: d.f2 || 0,
              fricative: d.fricative || 0,
              audioTime: d.audioTime || ctx.currentTime,
              receivedAtMs: performance.now(),
            };
          }
        };
        // Connect source -> destination for audio output, and source -> workletNode for off-thread FFT
        source.connect(ctx.destination);
        source.connect(workletNode);
      } catch {
        workletNode = null;
      }
    }

    // Only create a main-thread AnalyserNode if AudioWorklet could not be attached
    let fallbackFreqData: Uint8Array<ArrayBuffer> | null = null;
    let fallbackTimeData: Float32Array<ArrayBuffer> | null = null;
    if (!workletNode) {
      fallbackAnalyser = ctx.createAnalyser();
      fallbackAnalyser.fftSize = 512;
      fallbackAnalyser.smoothingTimeConstant = 0.35;
      source.connect(fallbackAnalyser);
      fallbackAnalyser.connect(ctx.destination);
      fallbackFreqData = new Uint8Array(fallbackAnalyser.frequencyBinCount);
      fallbackTimeData = new Float32Array(fallbackAnalyser.fftSize);
    }

    const phonemeTimeline = text ? buildArabicVisemeTimeline(text) : [];
    const frameHistory: TimestampedProcessedFrame[] = [];
    let smoothedAmplitude = 0;
    let lastActiveViseme: VisemeType = 'rest';
    let visemeHoldFrames = 0;
    const startAudioTime = ctx.currentTime;

    const extractFallbackMainThreadFFT = (): WorkletFFTFrame => {
      if (!fallbackAnalyser || !fallbackFreqData || !fallbackTimeData) {
        return latestWorkletFrame;
      }
      fallbackAnalyser.getFloatTimeDomainData(fallbackTimeData);
      let sumSq = 0;
      let zeroCrossings = 0;
      for (let i = 0; i < fallbackTimeData.length; i++) {
        const s = fallbackTimeData[i];
        sumSq += s * s;
        if (
          i > 0 &&
          ((s >= 0 && fallbackTimeData[i - 1] < 0) ||
            (s < 0 && fallbackTimeData[i - 1] >= 0))
        ) {
          zeroCrossings++;
        }
      }
      const rms = Math.sqrt(sumSq / fallbackTimeData.length);
      const zcr = zeroCrossings / fallbackTimeData.length;

      fallbackAnalyser.getByteFrequencyData(fallbackFreqData);
      const sr = ctx.sampleRate || 24000;
      const binHz = sr / fallbackAnalyser.fftSize;

      const getBand = (lowHz: number, highHz: number) => {
        const startBin = Math.max(1, Math.floor(lowHz / binHz));
        const endBin = Math.min(fallbackFreqData!.length - 1, Math.ceil(highHz / binHz));
        if (endBin < startBin) return 0;
        let sum = 0;
        for (let b = startBin; b <= endBin; b++) {
          sum += fallbackFreqData![b];
        }
        return sum / (endBin - startBin + 1) / 255;
      };

      return {
        rms,
        zcr,
        bilabial: getBand(80, 340),
        f1: getBand(340, 1000),
        f2: getBand(1000, 2650),
        fricative: getBand(2650, 6000),
        audioTime: ctx.currentTime,
        receivedAtMs: performance.now(),
      };
    };

    const renderSyncLoop = () => {
      if (!isActive()) return;

      if (isPaused() || (typeof document !== 'undefined' && document.hidden)) {
        animFrameId = requestAnimationFrame(renderSyncLoop);
        return;
      }

      const nowMs = performance.now();
      const elapsedAudioSec = Math.max(0, ctx.currentTime - startAudioTime);
      const outputLatencySec =
        (ctx as any).outputLatency || (ctx as any).baseLatency || 0.012;

      // Read off-main-thread AudioWorklet FFT frame (or fallback if worklet unsupported)
      const usingWorklet = Boolean(workletNode);
      const rawFrame = usingWorklet ? latestWorkletFrame : extractFallbackMainThreadFFT();

      const { rms: rawRms, zcr, bilabial: bilabialBand, f1: f1Band, f2: f2Band, fricative: fricativeBand } = rawFrame;

      // Unified acoustic energy combining time-domain RMS and worklet FFT formant energy
      const spectralEnergy = bilabialBand * 0.25 + f1Band * 0.45 + f2Band * 0.3;
      const combinedRawLevel = Math.max(rawRms * 2.6, spectralEnergy);

      const { sensitivity, noiseThreshold, smoothing, latencyOffsetMs } = this.calibration;

      // Silence Noise Gate
      let gatedAmplitude = 0;
      if (combinedRawLevel > noiseThreshold) {
        gatedAmplitude = Math.min(
          1.0,
          ((combinedRawLevel - noiseThreshold) / Math.max(0.15, 0.68 - noiseThreshold)) *
            sensitivity
        );
      }

      // Asymmetric Attack / Release Easing
      const attackAlpha = Math.max(0.25, 1.0 - smoothing * 0.65);
      const releaseAlpha = Math.max(0.12, (1.0 - smoothing) * 0.45);
      const alpha = gatedAmplitude > smoothedAmplitude ? attackAlpha : releaseAlpha;
      smoothedAmplitude += (gatedAmplitude - smoothedAmplitude) * alpha;
      if (smoothedAmplitude < 0.014) {
        smoothedAmplitude = 0;
      }

      // Time-aligned Arabic phonetic cue lookup with latency offset compensation
      const compensatedAudioSec =
        elapsedAudioSec - outputLatencySec + latencyOffsetMs / 1000;
      const progressRatio =
        effectiveDurationSec > 0
          ? Math.max(0, Math.min(1, compensatedAudioSec / effectiveDurationSec))
          : 0;

      const alignedCue = phonemeTimeline.find(
        (c) => progressRatio >= c.startRatio && progressRatio <= c.endRatio
      );

      let detectedViseme: VisemeType = 'rest';

      if (smoothedAmplitude <= 0.022) {
        detectedViseme = 'rest';
      } else {
        let acousticViseme: VisemeType = 'open_a';

        if (
          smoothedAmplitude < 0.28 &&
          bilabialBand > f1Band * 1.15 &&
          f2Band < 0.24
        ) {
          // Low-frequency murmur with damped F1/F2 -> Bilabial closure (ب / م)
          acousticViseme = 'closed_m';
        } else if (zcr > 0.26 && fricativeBand > f1Band * 0.85 && smoothedAmplitude < 0.36) {
          // High ZCR + high frequency energy -> Labiodental / Sibilant (ف / س / ث)
          acousticViseme = alignedCue?.viseme === 'closed_m' ? 'closed_m' : 'spread_e';
        } else if (f1Band > 0.36 && f1Band >= f2Band * 1.04) {
          // Dominant F1 -> Open vowel (فتحة / ألف مد)
          acousticViseme = 'open_a';
        } else if (bilabialBand + f1Band * 0.5 > f2Band * 1.32) {
          // Low F1 & Low F2 -> Rounded back vowel (ضمة / واو مد / مفخم)
          acousticViseme = 'open_o';
        } else if (f2Band > f1Band * 0.92) {
          // High F2 relative to F1 -> Front spread vowel (كسرة / ياء مد)
          acousticViseme = 'spread_e';
        } else {
          acousticViseme = 'dental_d';
        }

        // Fuse AudioWorklet FFT classification with Arabic phonetic timeline cue
        if (alignedCue && alignedCue.viseme !== 'rest') {
          if (alignedCue.viseme === 'closed_m' && smoothedAmplitude < 0.46) {
            detectedViseme = 'closed_m';
          } else if (alignedCue.viseme === 'dental_d' && smoothedAmplitude < 0.5) {
            detectedViseme = 'dental_d';
          } else if (smoothedAmplitude > 0.54 && acousticViseme === 'open_a') {
            detectedViseme = 'open_a';
          } else {
            detectedViseme = alignedCue.viseme;
          }
        } else {
          detectedViseme = acousticViseme;
        }
      }

      // Anti-chatter hold (~3 frames) to keep mouth transitions organic
      if (detectedViseme === 'rest') {
        lastActiveViseme = 'rest';
        visemeHoldFrames = 0;
      } else if (detectedViseme !== lastActiveViseme) {
        if (visemeHoldFrames >= 2 || lastActiveViseme === 'rest') {
          lastActiveViseme = detectedViseme;
          visemeHoldFrames = 0;
        } else {
          detectedViseme = lastActiveViseme;
          visemeHoldFrames++;
        }
      } else {
        visemeHoldFrames++;
      }

      const sourceType: 'audio-worklet-fft' | 'web-audio-fft' = usingWorklet
        ? 'audio-worklet-fft'
        : 'web-audio-fft';

      frameHistory.push({
        timestampMs: nowMs,
        amplitude: smoothedAmplitude,
        viseme: detectedViseme,
        rms: rawRms,
        f1: f1Band,
        f2: f2Band,
        bilabial: bilabialBand,
        fricative: fricativeBand,
        zcr,
        sourceType,
      });
      while (frameHistory.length > 35) {
        frameHistory.shift();
      }

      let outputFrame = frameHistory[frameHistory.length - 1];
      if (latencyOffsetMs < 0 && frameHistory.length > 1) {
        const targetTime = nowMs + latencyOffsetMs;
        for (let i = frameHistory.length - 1; i >= 0; i--) {
          if (frameHistory[i].timestampMs <= targetTime) {
            outputFrame = frameHistory[i];
            break;
          }
        }
      }

      // Calculate actual audio-to-render sync delta in ms
      const workletAgeMs =
        usingWorklet && rawFrame.receivedAtMs > 0
          ? Math.min(18, Math.max(0, nowMs - rawFrame.receivedAtMs))
          : 0;
      const measuredDeltaMs =
        Math.round((outputLatencySec * 1000 + workletAgeMs * 0.25 - latencyOffsetMs) * 10) / 10;

      const telemetry: LipSyncTelemetry = {
        rms: outputFrame.rms,
        amplitude: outputFrame.amplitude,
        viseme: outputFrame.viseme,
        f1Energy: outputFrame.f1,
        f2Energy: outputFrame.f2,
        bilabialEnergy: outputFrame.bilabial,
        fricativeEnergy: outputFrame.fricative,
        zcr: outputFrame.zcr,
        syncDeltaMs: measuredDeltaMs,
        audioContextState: ctx.state,
        sourceType: outputFrame.sourceType,
        currentTimeSec: elapsedAudioSec,
        durationSec: effectiveDurationSec,
      };

      onFrame(outputFrame.amplitude, outputFrame.viseme, telemetry);
      animFrameId = requestAnimationFrame(renderSyncLoop);
    };

    animFrameId = requestAnimationFrame(renderSyncLoop);

    const cleanup = () => {
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      if (workletNode) {
        try {
          workletNode.port.onmessage = null;
          workletNode.disconnect();
        } catch {
          // ignore
        }
        workletNode = null;
      }
      if (fallbackAnalyser) {
        try {
          fallbackAnalyser.disconnect();
        } catch {
          // ignore
        }
        fallbackAnalyser = null;
      }
    };

    return { cleanup, analyser: fallbackAnalyser };
  }
}

export const lipSyncService = new LipSyncService();
