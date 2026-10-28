import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Camera,
  Sliders,
  Check,
  Upload,
  Film,
  Activity,
  Volume2,
  Gauge,
  RotateCcw,
  Sparkles,
  Info,
} from 'lucide-react';
import type { AvatarProfile, MouthCalibration, VisemeType } from '../data/avatars';
import type { LipSyncTelemetry } from '../services/speechService';

interface RealisticAvatarProps {
  avatar: AvatarProfile;
  isSpeaking: boolean;
  viseme: VisemeType;
  amplitude: number;
  telemetry?: LipSyncTelemetry | null;
  emotion?: 'smile' | 'excited' | 'thinking' | 'serious' | 'nod' | 'greeting';
  aspectRatio?: '9:16' | '16:9' | '1:1' | 'full';
  showStudioBadge?: boolean;
  onQuickUploadMedia?: (file: File) => void;
  onUpdateMouthConfig?: (config: MouthCalibration) => void;
  onTestArabicClip?: (testText: string, rate?: number) => void;
  onTestFormantPulse?: () => void;
  className?: string;
}

const VISEME_ARABIC_LABEL: Record<VisemeType, string> = {
  rest: 'سكون (صمت)',
  open_a: 'فتحة / ألف (آ)',
  open_o: 'ضمة / واو (أو)',
  spread_e: 'كسرة / ياء (إي)',
  closed_m: 'شفوي مطبق (ب/م/ف)',
  dental_d: 'لثوي / أسناني (د/ت/س/ل)',
};

const ARABIC_SYNC_TEST_CLIPS = [
  {
    id: 'bilabials-pauses',
    label: 'اختبار الباء والميم والفاء + التوقف',
    text: 'بِسْمِ الله، مَرْحَبًا بِكُمْ في بَثِّنَا... تَوَقَّفْ قَلِيلًا، ثُمَّ تَكَلَّمْ بِوُضُوحٍ وَفَصَاحَة.',
    rate: 1.0,
  },
  {
    id: 'vowels-long',
    label: 'اختبار الحركات والمدود (آ / أو / إي)',
    text: 'قَالَ قَيْسٌ وَأَحْلَام: نُورُ الصَّبَاحِ جَمِيلٌ وَسَعِيدٌ جِدًّا.',
    rate: 1.0,
  },
  {
    id: 'fast-speech',
    label: 'جملة سريعة متصلة',
    text: 'أهلاً وسهلاً بكم جميعاً في تجربة التزامن الصوتي المباشر والسريع عبر المتصفح!',
    rate: 1.2,
  },
  {
    id: 'slow-speech',
    label: 'جملة بطيئة مع سكون',
    text: 'مَرْحَبًا بِكُمْ... كَيْفَ حَالُكُمْ اليَوْم؟ نَحْنُ نَسْتَمِعُ إِلَيْكُمْ.',
    rate: 0.86,
  },
];

export const RealisticAvatar: React.FC<RealisticAvatarProps> = ({
  avatar,
  isSpeaking,
  viseme,
  amplitude,
  telemetry = null,
  emotion = 'smile',
  aspectRatio = '9:16',
  showStudioBadge = true,
  onQuickUploadMedia,
  onUpdateMouthConfig,
  onTestArabicClip,
  onTestFormantPulse,
  className = '',
}) => {
  const [isCalibratingMouth, setIsCalibratingMouth] = useState(false);
  const [isTestingMouth, setIsTestingMouth] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [measuredFps, setMeasuredFps] = useState(60);
  const [showTechInfo, setShowTechInfo] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const mouthX = avatar.mouthConfig?.x ?? 50;
  const mouthY = avatar.mouthConfig?.y ?? 53;
  const mouthScale = avatar.mouthConfig?.scale ?? 1;
  const syncMode = avatar.mouthConfig?.mode || 'natural-warp';
  const sensitivity = avatar.mouthConfig?.sensitivity ?? 1.15;
  const noiseThreshold = avatar.mouthConfig?.noiseThreshold ?? 0.032;
  const smoothing = avatar.mouthConfig?.smoothing ?? 0.55;
  const latencyOffsetMs = avatar.mouthConfig?.latencyOffsetMs ?? 0;
  const isVideoAvatar = avatar.mediaType === 'video' && Boolean(avatar.videoUrl);

  // Refs for 60fps canvas animation loop to read latest props without restarting loop
  const stateRef = useRef({
    isSpeaking,
    viseme,
    amplitude,
    emotion,
    isCalibratingMouth,
    isTestingMouth,
    mouthX,
    mouthY,
    mouthScale,
    syncMode,
    sensitivity,
    noiseThreshold,
    smoothing,
    latencyOffsetMs,
    isVideoAvatar,
  });

  // Callback ref to wake up the render loop if it was sleeping during idle
  const wakeRenderLoopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current = {
      isSpeaking,
      viseme,
      amplitude,
      emotion,
      isCalibratingMouth,
      isTestingMouth,
      mouthX,
      mouthY,
      mouthScale,
      syncMode,
      sensitivity,
      noiseThreshold,
      smoothing,
      latencyOffsetMs,
      isVideoAvatar,
    };
    wakeRenderLoopRef.current?.();
  }, [
    isSpeaking,
    viseme,
    amplitude,
    emotion,
    isCalibratingMouth,
    isTestingMouth,
    mouthX,
    mouthY,
    mouthScale,
    syncMode,
    sensitivity,
    noiseThreshold,
    smoothing,
    latencyOffsetMs,
    isVideoAvatar,
  ]);

  // Load image source whenever avatar.imageUrl changes
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = avatar.imageUrl;
    img.onload = () => {
      imageRef.current = img;
      wakeRenderLoopRef.current?.();
    };
  }, [avatar.imageUrl]);

  // Manage hidden HTMLVideoElement source & audio-synced playback
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !isVideoAvatar || !avatar.videoUrl) {
      setVideoReady(false);
      return;
    }

    const activeNow = isSpeaking || isTestingMouth;
    const effectiveAmp = isTestingMouth ? 0.65 : amplitude;

    if (syncMode === 'video-sync') {
      // Mode 2: For videos where the user is already talking on camera
      // Only play video frames when voice energy > threshold; pause on closed-mouth frame 0 when silent
      if (activeNow && effectiveAmp > noiseThreshold) {
        vid.play().catch(() => {});
        vid.playbackRate = Math.max(0.75, Math.min(1.45, 0.8 + effectiveAmp * 0.65));
      } else {
        vid.pause();
        if (!activeNow && vid.currentTime > 0.05) {
          try {
            vid.currentTime = 0;
          } catch {
            // ignore seek error
          }
        }
      }
    } else {
      // Mode 1 ('natural-warp'): Play video smoothly for natural head/eye motion while Canvas warps the lips
      if (activeNow) {
        vid.play().catch(() => {});
        vid.playbackRate = 1.0;
      } else {
        vid.play().catch(() => {});
        vid.playbackRate = 0.65;
      }
    }
  }, [isSpeaking, isTestingMouth, amplitude, isVideoAvatar, avatar.videoUrl, syncMode, noiseThreshold]);

  // Main 60 FPS Canvas Renderer with 2D Strip-Mesh Jaw & Lip Deformation + Idle Optimization
  useEffect(() => {
    let animId: number | null = null;
    let idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let isLoopRunning = false;
    let phase = 0;
    let smoothAmp = 0;
    let smoothWidthFactor = 1.0;
    let smoothTeethVisibility = 0;
    let blinkTimer = 0;
    let isBlinkingNow = false;

    let frameCounter = 0;
    let lastFpsSampleTime = performance.now();

    const scheduleNextFrame = (isActiveMotion: boolean) => {
      if (document.hidden) {
        isLoopRunning = false;
        return;
      }

      if (isActiveMotion) {
        animId = requestAnimationFrame(renderLoop);
      } else {
        // Low-power idle mode (~12 FPS for gentle breathing/blinking without burning mobile GPU)
        idleTimeoutId = setTimeout(() => {
          animId = requestAnimationFrame(renderLoop);
        }, 85);
      }
    };

    const renderLoop = (now: number) => {
      if (document.hidden) {
        isLoopRunning = false;
        return;
      }

      frameCounter++;
      if (now - lastFpsSampleTime >= 600) {
        const currentFps = Math.min(60, Math.round((frameCounter * 1000) / (now - lastFpsSampleTime)));
        setMeasuredFps(currentFps);
        frameCounter = 0;
        lastFpsSampleTime = now;
      }

      const st = stateRef.current;
      const isActiveMotion =
        st.isSpeaking ||
        st.isTestingMouth ||
        st.isCalibratingMouth ||
        st.isVideoAvatar ||
        smoothAmp > 0.005;

      phase += isActiveMotion ? 0.045 : 0.18;
      blinkTimer += isActiveMotion ? 1 : 4;

      // Natural blinking every ~180 frames (~3s)
      if (blinkTimer > 190 && Math.random() < 0.035) {
        isBlinkingNow = true;
        setTimeout(() => {
          isBlinkingNow = false;
        }, 130);
        blinkTimer = 0;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const cw = canvas.width;
        const ch = canvas.height;

        // Calculate target amplitude strictly from actual audio amplitude (or manual preview test)
        // Never hold the mouth open during silence (st.amplitude <= noiseThreshold * 0.5)
        let rawTargetAmp = 0;
        if (st.isTestingMouth) {
          rawTargetAmp = 0.4 + Math.abs(Math.sin(phase * 3.1)) * 0.48;
        } else if (st.isSpeaking && st.amplitude > 0.008) {
          rawTargetAmp = Math.min(1, st.amplitude);
        } else {
          rawTargetAmp = 0;
        }

        // Apply cubic easing curve for natural organic opening/closing
        const easedTargetAmp =
          rawTargetAmp > 0
            ? rawTargetAmp * rawTargetAmp * (3 - 2 * rawTargetAmp) * 1.12
            : 0;

        // Asymmetric attack/release interpolation controlled by user smoothing slider
        const attackAlpha = Math.max(0.18, Math.min(0.68, 0.58 - st.smoothing * 0.35));
        const releaseAlpha = Math.max(0.14, Math.min(0.55, 0.45 - st.smoothing * 0.28));

        smoothAmp += (easedTargetAmp - smoothAmp) * (easedTargetAmp > smoothAmp ? attackAlpha : releaseAlpha);
        if (smoothAmp < 0.009 && easedTargetAmp === 0) {
          smoothAmp = 0;
        }

        const testVisemeOrder: VisemeType[] = [
          'open_a',
          'closed_m',
          'open_o',
          'spread_e',
          'dental_d',
          'rest',
        ];
        const currentViseme: VisemeType = st.isTestingMouth
          ? testVisemeOrder[Math.floor(phase * 1.35) % testVisemeOrder.length]
          : smoothAmp === 0
          ? 'rest'
          : st.viseme;

        // Viseme horizontal width factor:
        // - open_o (ضمة / واو): rounded narrower lips (0.74)
        // - spread_e (كسرة / ياء): wider lip corners (1.19)
        // - closed_m (ب / م / ف): pressed bilabials (0.91)
        // - dental_d (د / ت / س / ل / ن): slightly spread with dental aperture (1.06)
        // - open_a (فتحة / ألف): natural open width (1.03)
        const targetWidthFactor =
          currentViseme === 'open_o'
            ? 0.74
            : currentViseme === 'spread_e'
            ? 1.19
            : currentViseme === 'closed_m'
            ? 0.91
            : currentViseme === 'dental_d'
            ? 1.06
            : 1.0 + smoothAmp * 0.06;

        smoothWidthFactor += (targetWidthFactor - smoothWidthFactor) * 0.32;

        const targetTeeth =
          currentViseme === 'closed_m' || currentViseme === 'rest'
            ? 0
            : currentViseme === 'dental_d' || currentViseme === 'spread_e'
            ? Math.min(0.88, smoothAmp * 1.45)
            : Math.min(0.75, Math.max(0, (smoothAmp - 0.16) * 1.35));

        smoothTeethVisibility += (targetTeeth - smoothTeethVisibility) * 0.35;

        ctx.clearRect(0, 0, cw, ch);

        // Determine active visual source (Video frame if ready, otherwise Image)
        const vid = videoRef.current;
        const img = imageRef.current;
        const useVideoSource =
          st.isVideoAvatar && vid && vid.readyState >= 2 && vid.videoWidth > 0;
        const sourceEl: HTMLVideoElement | HTMLImageElement | null = useVideoSource
          ? vid
          : img && img.complete && img.naturalWidth > 0
          ? img
          : null;

        if (sourceEl) {
          const srcW = useVideoSource
            ? (sourceEl as HTMLVideoElement).videoWidth
            : (sourceEl as HTMLImageElement).naturalWidth;
          const srcH = useVideoSource
            ? (sourceEl as HTMLVideoElement).videoHeight
            : (sourceEl as HTMLImageElement).naturalHeight;

          // Compute object-cover crop rectangle in source coordinates
          const canvasAspect = cw / ch;
          const srcAspect = srcW / srcH;
          let cropW = srcW;
          let cropH = srcH;
          let cropX = 0;
          let cropY = 0;

          if (srcAspect > canvasAspect) {
            cropW = srcH * canvasAspect;
            cropX = (srcW - cropW) / 2;
          } else {
            cropH = srcW / canvasAspect;
            cropY = (srcH - cropH) / 2;
          }

          // Subtle breathing & speech micro-nodding
          const breathY = Math.sin(phase * 0.7) * 2.2;
          const talkNodY = smoothAmp > 0.06 ? Math.sin(phase * 2.2) * 1.8 * smoothAmp : 0;
          const totalShiftY = breathY + talkNodY;

          ctx.save();
          // Slight zoom to prevent edges showing during breathing/nodding
          ctx.translate(cw / 2, ch / 2 + totalShiftY);
          ctx.scale(1.02, 1.02);
          ctx.translate(-cw / 2, -ch / 2);

          // 1. Draw Base Frame (100% Real Face from Video or Photo)
          ctx.drawImage(sourceEl, cropX, cropY, cropW, cropH, 0, 0, cw, ch);

          // 2. Apply Real-Time 2D Strip-Mesh Lip & Jaw Deformation
          const shouldWarpLips =
            smoothAmp > 0.015 && (st.syncMode !== 'video-sync' || !useVideoSource);

          if (shouldWarpLips) {
            const mcx = (st.mouthX / 100) * cw;
            const mcy = (st.mouthY / 100) * ch;
            const scale = st.mouthScale;

            const isClosedConsonant = currentViseme === 'closed_m';
            const isDentalConsonant = currentViseme === 'dental_d';

            // Vertical jaw displacement depends on viseme class:
            // - closed_m (ب/م/ف): lips press together with minimal jaw drop
            // - dental_d (د/ت/س/ل/ن): moderate jaw drop (~55%)
            // - open_a / open_o / spread_e: full proportional jaw drop
            const visemeJawMultiplier = isClosedConsonant
              ? 0.06
              : isDentalConsonant
              ? 0.56
              : currentViseme === 'spread_e'
              ? 0.72
              : 1.0;

            const jawDropCanvasPx = smoothAmp * 22 * scale * visemeJawMultiplier;
            const mouthRx = 42 * scale * smoothWidthFactor;
            const jawZoneHeight = 85 * scale;
            const numStrips = 14;
            const stripH = jawZoneHeight / numStrips;

            // Step 2A: Progressive horizontal mesh strips from chin up to lower lip
            for (let i = numStrips - 1; i >= 0; i--) {
              const t = i / numStrips; // 0 at mouth line, 1 at bottom of chin
              const falloff = Math.cos(t * (Math.PI / 2));
              const shiftY = jawDropCanvasPx * falloff;

              const destY = mcy + i * stripH + shiftY;
              const srcCanvasY = mcy + i * stripH;

              const stripRadiusX = mouthRx * (1.25 - t * 0.35);
              const leftCanvasX = Math.max(0, mcx - stripRadiusX);
              const rightCanvasX = Math.min(cw, mcx + stripRadiusX);
              const widthCanvas = rightCanvasX - leftCanvasX;

              if (widthCanvas > 2) {
                const sx = cropX + (leftCanvasX / cw) * cropW;
                const sy = cropY + (srcCanvasY / ch) * cropH;
                const sw = (widthCanvas / cw) * cropW;
                const sh = ((stripH + 1.5) / ch) * cropH;

                ctx.save();
                ctx.beginPath();
                ctx.ellipse(
                  mcx,
                  destY + stripH / 2,
                  stripRadiusX,
                  stripH * 1.15,
                  0,
                  0,
                  Math.PI * 2
                );
                ctx.clip();
                ctx.drawImage(
                  sourceEl,
                  sx,
                  sy,
                  sw,
                  sh,
                  leftCanvasX,
                  destY,
                  widthCanvas,
                  stripH + 1.5
                );
                ctx.restore();
              }
            }

            // Step 2B: Anatomically Blended Oral Parting Cavity at (mcx, mcy)
            const cavityRx = 24 * scale * smoothWidthFactor;
            const cavityRy = isClosedConsonant
              ? 1.1 * scale
              : Math.min(
                  17.5 * scale,
                  Math.max(1.6, smoothAmp * 15.5 * scale * visemeJawMultiplier)
                );
            const cavityCenterY = mcy + jawDropCanvasPx * 0.22;

            ctx.save();
            ctx.beginPath();
            ctx.ellipse(mcx, cavityCenterY, cavityRx, cavityRy, 0, 0, Math.PI * 2);
            ctx.clip();

            if (isClosedConsonant) {
              // Bilabial lip-compression line (ب / م / ف): subtle pressed lip shadow without hollow cavity
              ctx.fillStyle = 'rgba(58, 22, 28, 0.72)';
              ctx.fillRect(
                mcx - cavityRx,
                cavityCenterY - cavityRy,
                cavityRx * 2,
                cavityRy * 2
              );
            } else {
              // Soft radial dark oral interior gradient for vowels & open consonants
              const grad = ctx.createRadialGradient(
                mcx,
                cavityCenterY,
                1,
                mcx,
                cavityCenterY,
                Math.max(cavityRx, cavityRy)
              );
              grad.addColorStop(0, 'rgba(26, 7, 11, 0.94)');
              grad.addColorStop(0.65, 'rgba(60, 17, 23, 0.85)');
              grad.addColorStop(1, 'rgba(95, 34, 40, 0.22)');
              ctx.fillStyle = grad;
              ctx.fillRect(
                mcx - cavityRx,
                cavityCenterY - cavityRy,
                cavityRx * 2,
                cavityRy * 2
              );

              // Subtle Upper Teeth Highlight when mouth opens for vowels / dentals
              if (smoothTeethVisibility > 0.05) {
                ctx.fillStyle = `rgba(248, 245, 238, ${smoothTeethVisibility})`;
                ctx.beginPath();
                ctx.roundRect(
                  mcx - cavityRx * 0.62,
                  cavityCenterY - cavityRy * 0.86,
                  cavityRx * 1.24,
                  Math.max(1.8, cavityRy * (isDentalConsonant ? 0.52 : 0.4)),
                  3
                );
                ctx.fill();
              }

              // Subtle Tongue Hint at bottom of oral cavity
              if (smoothAmp > 0.34 || isDentalConsonant) {
                const tongueAlpha = isDentalConsonant
                  ? Math.min(0.62, smoothAmp * 1.2)
                  : Math.min(0.62, (smoothAmp - 0.28) * 1.35);
                ctx.fillStyle = `rgba(195, 78, 88, ${tongueAlpha})`;
                ctx.beginPath();
                ctx.ellipse(
                  mcx,
                  cavityCenterY + cavityRy * (isDentalConsonant ? 0.45 : 0.65),
                  cavityRx * 0.54,
                  cavityRy * 0.44,
                  0,
                  0,
                  Math.PI * 2
                );
                ctx.fill();
              }
            }

            ctx.restore();
          }

          // 3. Subtle Natural Eye Blinking on Photo Mode
          if (!useVideoSource && isBlinkingNow) {
            const eyeY = ((st.mouthY - 16.5) / 100) * ch;
            const leftEyeX = 0.39 * cw;
            const rightEyeX = 0.61 * cw;
            ctx.save();
            ctx.fillStyle = 'rgba(25, 18, 15, 0.45)';
            ctx.beginPath();
            ctx.ellipse(leftEyeX, eyeY, 18, 4.5, 0, 0, Math.PI * 2);
            ctx.ellipse(rightEyeX, eyeY, 18, 4.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          ctx.restore();
        }
      }

      scheduleNextFrame(isActiveMotion);
    };

    const startLoopIfNeeded = () => {
      if (document.hidden) return;
      if (idleTimeoutId) {
        clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
      }
      if (!isLoopRunning) {
        isLoopRunning = true;
        animId = requestAnimationFrame(renderLoop);
      }
    };

    wakeRenderLoopRef.current = startLoopIfNeeded;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (animId !== null) cancelAnimationFrame(animId);
        if (idleTimeoutId !== null) clearTimeout(idleTimeoutId);
        isLoopRunning = false;
      } else {
        startLoopIfNeeded();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startLoopIfNeeded();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (animId !== null) cancelAnimationFrame(animId);
      if (idleTimeoutId !== null) clearTimeout(idleTimeoutId);
      isLoopRunning = false;
    };
  }, []);

  const updatePartialMouthConfig = useCallback(
    (patch: Partial<MouthCalibration>) => {
      if (!onUpdateMouthConfig) return;
      onUpdateMouthConfig({
        x: mouthX,
        y: mouthY,
        scale: mouthScale,
        mode: syncMode,
        sensitivity,
        noiseThreshold,
        smoothing,
        latencyOffsetMs,
        ...patch,
      });
    },
    [
      onUpdateMouthConfig,
      mouthX,
      mouthY,
      mouthScale,
      syncMode,
      sensitivity,
      noiseThreshold,
      smoothing,
      latencyOffsetMs,
    ]
  );

  const handleResetCalibrationDefaults = () => {
    updatePartialMouthConfig({
      scale: 1.0,
      sensitivity: 1.15,
      noiseThreshold: 0.032,
      smoothing: 0.55,
      latencyOffsetMs: 0,
    });
  };

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCalibratingMouth || !containerRef.current || !onUpdateMouthConfig) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;
    updatePartialMouthConfig({
      x: Math.round(Math.max(20, Math.min(80, clickX))),
      y: Math.round(Math.max(25, Math.min(85, clickY))),
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onQuickUploadMedia) {
      onQuickUploadMedia(file);
    }
    e.target.value = '';
  };

  const aspectClass =
    aspectRatio === '9:16'
      ? 'aspect-[9/16] max-w-sm'
      : aspectRatio === '16:9'
      ? 'aspect-[16/9] w-full max-w-3xl'
      : aspectRatio === '1:1'
      ? 'aspect-square max-w-md'
      : 'w-full h-full';

  const activeVisemeLabel = VISEME_ARABIC_LABEL[viseme] || 'سكون (صمت)';
  const ampPercent = Math.round(Math.min(100, (isTestingMouth ? 0.7 : amplitude) * 100));

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className={`relative overflow-hidden rounded-3xl bg-slate-900 shadow-2xl select-none mx-auto ${aspectClass} ${
        isCalibratingMouth ? 'cursor-crosshair ring-4 ring-amber-400' : ''
      } ${className}`}
      style={{
        boxShadow:
          isSpeaking || isTestingMouth
            ? '0 0 50px -10px rgba(16, 185, 129, 0.4), 0 20px 40px -15px rgba(0, 0, 0, 0.7)'
            : '0 20px 40px -15px rgba(0, 0, 0, 0.7)',
      }}
    >
      {/* Hidden File Input for Quick Photo/Video Replacement */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Hidden Video Decoder Element (feeds frames to the 60FPS Canvas) */}
      {isVideoAvatar && avatar.videoUrl && (
        <video
          ref={videoRef}
          src={avatar.videoUrl}
          muted
          loop
          playsInline
          autoPlay
          onLoadedData={() => setVideoReady(true)}
          onCanPlay={() => setVideoReady(true)}
          className="hidden"
        />
      )}

      {/* High-DPI 60FPS Synchronized Avatar & Lip-Sync Canvas */}
      <canvas
        ref={canvasRef}
        width={540}
        height={960}
        className="w-full h-full object-cover block"
      />

      {/* Mouth Calibration Target Crosshair (Works on BOTH Photos and Videos!) */}
      {isCalibratingMouth && (
        <div
          className="absolute z-30 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center"
          style={{ left: `${mouthX}%`, top: `${mouthY}%` }}
        >
          <div className="w-12 h-6 rounded-full border-2 border-amber-400 bg-amber-400/25 animate-pulse flex items-center justify-center shadow-lg">
            <div className="w-2 h-2 rounded-full bg-amber-300" />
          </div>
          <span className="mt-1 px-2 py-0.5 rounded bg-black/85 text-amber-300 text-[10px] font-bold whitespace-nowrap border border-amber-400/40">
            مركز الشفاه ({mouthX}%, {mouthY}%)
          </span>
        </div>
      )}

      {/* Top Overlay: Live Status & Quick Controls */}
      {showStudioBadge && (
        <div className="absolute top-3 inset-x-3 flex items-center justify-between z-20 gap-1.5">
          {/* Live Status Indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/75 backdrop-blur-md border border-white/10 text-white text-xs font-bold shadow-lg pointer-events-none">
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isSpeaking || isTestingMouth ? 'bg-emerald-400' : 'bg-slate-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isSpeaking || isTestingMouth ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              />
            </span>
            <span className="truncate max-w-[165px] sm:max-w-[210px]">
              {isSpeaking
                ? `ينطق • ${activeVisemeLabel}`
                : isTestingMouth
                ? 'اختبار حركة الشفاه...'
                : 'سكون • جاهز للحديث'}
            </span>
          </div>

          {/* Quick Action Buttons on Avatar Frame */}
          <div className="flex items-center gap-1.5">
            {onUpdateMouthConfig && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCalibratingMouth(!isCalibratingMouth);
                  if (isCalibratingMouth) setIsTestingMouth(false);
                }}
                className={`px-2.5 py-1.5 rounded-full text-[11px] font-bold backdrop-blur-md border transition-all flex items-center gap-1 shadow-lg ${
                  isCalibratingMouth
                    ? 'bg-amber-500 text-black border-amber-300'
                    : 'bg-black/75 text-white border-white/15 hover:bg-black/90'
                }`}
                title="لوحة معايرة التزامن الصوتي والشفاه"
              >
                {isCalibratingMouth ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>إغلاق المعايرة</span>
                  </>
                ) : (
                  <>
                    <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                    <span>معايرة الشفاه</span>
                  </>
                )}
              </button>
            )}

            {onQuickUploadMedia && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="px-2.5 py-1.5 rounded-full bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-bold backdrop-blur-md border border-emerald-400/30 shadow-lg flex items-center gap-1 transition-all active:scale-95"
                title="رفع صورة أو فيديو لوجهك الحقيقي"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>تغيير الوجه</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Professional Audio-Driven Lip-Sync Calibration & Testing Panel (Requirements 8, 9, 10) */}
      {isCalibratingMouth && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-2.5 bottom-2.5 top-14 z-30 p-3 rounded-2xl bg-slate-950/95 backdrop-blur-xl border border-amber-400/50 text-white text-xs flex flex-col justify-between overflow-y-auto space-y-2.5 shadow-2xl"
        >
          {/* Header & Instructions */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-amber-300 flex items-center gap-1 text-xs">
                <Gauge className="w-3.5 h-3.5" />
                <span>معايرة التزامن الصوتي وحركة الشفاه</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowTechInfo(!showTechInfo)}
                  className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1"
                  title="معلومات محرك التزامن وحدود النظام"
                >
                  <Info className="w-3 h-3 text-emerald-400" />
                  <span>كيف يعمل؟</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetCalibrationDefaults}
                  className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1"
                  title="استعادة القيم الافتراضية"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>افتراضي</span>
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-300">
              👆 انقر على منتصف الفم في {isVideoAvatar ? 'الفيديو' : 'الصورة'} لتحديد مركز الشفاه ({mouthX}%, {mouthY}%)
            </p>
          </div>

          {/* Transparent Technical Boundaries Explanation (Requirement 2 & 10) */}
          {showTechInfo && (
            <div className="p-2.5 rounded-xl bg-slate-900 border border-emerald-500/30 text-[10px] text-slate-300 leading-relaxed space-y-1">
              <div className="font-bold text-emerald-400">
                آلية التزامن الصوتي عبر AudioWorklet FFT وحدود النظام:
              </div>
              <p>
                • يقوم <code>lipSyncService.ts</code> بتشغيل معالج{' '}
                <code>AudioWorkletProcessor</code> لحساب التحويل الترددي السريع (512-point Radix-2 FFT مع نافذة Hann) مباشرة في خيط الصوت المستقل بعيداً عن الخيط الرئيسي للمتصفح.
              </p>
              <p>
                • يستخرج المعالج حزم الفورمانت ($F_1, F_2$، وحزمة الباء/الميم `80–340Hz`، وحزمة الاحتكاك `2650–6000Hz`) ويدمجها مع خريطة الحروف العربية وبوابة الصمت الصوتية.
              </p>
              <p className="text-amber-300/90">
                • ملاحظة تقنية: التحليل الطيفي الفوري يضبط توقيت الفتح والإغلاق والفئة الصوتية بدقة عالية، لكنه لا يغني عن Phoneme Timestamps لتطابق كل حرف منفرد بنسبة 100%.
              </p>
            </div>
          )}

          {/* Live Acoustic & Sync Telemetry Readout */}
          <div className="grid grid-cols-3 gap-1.5 p-2 rounded-xl bg-slate-900/90 border border-slate-800 text-[10px]">
            <div>
              <span className="text-slate-400 block">الحركة الحالية:</span>
              <span className="font-bold text-emerald-400 truncate block">{activeVisemeLabel}</span>
            </div>
            <div>
              <span className="text-slate-400 block">التأخير / الإطارات:</span>
              <span className="font-bold text-amber-300">
                {telemetry ? `${telemetry.syncDeltaMs}ms` : '0ms'} • {measuredFps} FPS
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">طاقة الصوت (RMS):</span>
              <span className="font-bold text-cyan-300">
                {telemetry ? `${Math.round(telemetry.rms * 100)}%` : `${ampPercent}%`} (
                {telemetry?.sourceType === 'audio-worklet-fft'
                  ? 'Worklet FFT'
                  : telemetry?.sourceType === 'web-audio-fft'
                  ? 'WebAudio FFT'
                  : 'WebSpeech'}
                )
              </span>
            </div>
          </div>

          {/* Video Sync Mode Toggle when a Video is uploaded */}
          {isVideoAvatar && (
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800">
              <button
                type="button"
                onClick={() => updatePartialMouthConfig({ mode: 'natural-warp' })}
                className={`py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
                  syncMode !== 'video-sync'
                    ? 'bg-emerald-500 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                تحريك الشفاه الذكي على الفيديو
              </button>
              <button
                type="button"
                onClick={() => updatePartialMouthConfig({ mode: 'video-sync' })}
                className={`py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
                  syncMode === 'video-sync'
                    ? 'bg-emerald-500 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                مزامنة إطارات فيديو متحدث
              </button>
            </div>
          )}

          {/* Calibration Sliders (Requirement 8) */}
          <div className="space-y-2 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80">
            {/* 1. Mouth Opening Sensitivity */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-300">حساسية فتح الفم للصوت:</span>
                <span className="text-emerald-400 font-bold">{Math.round(sensitivity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.2"
                step="0.05"
                value={sensitivity}
                onChange={(e) =>
                  updatePartialMouthConfig({ sensitivity: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* 2. Silence Threshold (Noise Gate) */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-300">عتبة الصمت (منع الفتح أثناء السكون):</span>
                <span className="text-amber-300 font-bold">
                  {(noiseThreshold * 100).toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.18"
                step="0.005"
                value={noiseThreshold}
                onChange={(e) =>
                  updatePartialMouthConfig({ noiseThreshold: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 accent-amber-400 cursor-pointer"
              />
            </div>

            {/* 3. Motion Smoothing */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-300">سلاسة الحركة وتقليل الاهتزاز:</span>
                <span className="text-cyan-300 font-bold">{Math.round(smoothing * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.15"
                max="0.85"
                step="0.05"
                value={smoothing}
                onChange={(e) =>
                  updatePartialMouthConfig({ smoothing: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* 4. Audio-Visual Latency Compensation */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-300">تعويض التأخير الزمني (الصوت/الرسم):</span>
                <span className="text-purple-300 font-bold">
                  {latencyOffsetMs > 0 ? `+${latencyOffsetMs}` : latencyOffsetMs} ms
                </span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="5"
                value={latencyOffsetMs}
                onChange={(e) =>
                  updatePartialMouthConfig({ latencyOffsetMs: parseInt(e.target.value, 10) })
                }
                className="w-full h-1.5 accent-purple-400 cursor-pointer"
              />
            </div>

            {/* 5. Geometric Mouth Scale */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-300">حجم منطقة الفم والفك:</span>
                <span className="text-amber-300 font-bold">{Math.round(mouthScale * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.6"
                max="1.7"
                step="0.05"
                value={mouthScale}
                onChange={(e) =>
                  updatePartialMouthConfig({ scale: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 accent-amber-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Arabic Audio Lip-Sync Verification Clips (Requirements 8 & 9) */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-slate-300 flex items-center gap-1">
              <Volume2 className="w-3 h-3 text-emerald-400" />
              <span>اختبار التزامن بمقاطع صوتية عربية:</span>
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {ARABIC_SYNC_TEST_CLIPS.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => {
                    setIsTestingMouth(false);
                    onTestArabicClip?.(clip.text, clip.rate);
                  }}
                  className="py-1.5 px-2 rounded-xl bg-slate-900 hover:bg-emerald-950/80 border border-slate-700 hover:border-emerald-500/50 text-[10px] font-bold text-slate-200 hover:text-emerald-300 text-right truncate transition-all"
                  title={clip.text}
                >
                  🔊 {clip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom Action Row: Formant Pulse + Visual Loop Preview + Save */}
          <div className="flex items-center justify-between gap-1.5 pt-1">
            {onTestFormantPulse && (
              <button
                type="button"
                onClick={() => {
                  setIsTestingMouth(false);
                  onTestFormantPulse();
                }}
                className="py-1.5 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] flex items-center gap-1 transition-all"
                title="تشغيل نبضات صوتية معيارية (بَا - مُو - فِي - قَيْس) عبر Web Audio API"
              >
                <Sparkles className="w-3 h-3" />
                <span>نبضة صوتية</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsTestingMouth(!isTestingMouth)}
              className={`flex-1 py-1.5 px-2.5 rounded-xl font-bold text-[10px] flex items-center justify-center gap-1 transition-all ${
                isTestingMouth
                  ? 'bg-rose-600 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{isTestingMouth ? 'إيقاف الحركة' : 'معاينة صامتة'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsTestingMouth(false);
                setIsCalibratingMouth(false);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px]"
            >
              حفظ
            </button>
          </div>
        </div>
      )}

      {/* Media Type & Lip-Sync Status Badge */}
      {showStudioBadge && !isCalibratingMouth && (
        <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
          <span className="px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-md border border-white/10 text-[10px] text-slate-200 font-semibold flex items-center gap-1.5">
            {isVideoAvatar ? (
              <>
                <Film className="w-3 h-3 text-emerald-400" />
                <span>
                  {videoReady ? 'فيديو حقيقي • تزامن صوتي نشط' : 'جاري تحميل الفيديو...'}
                </span>
              </>
            ) : (
              <>
                <Camera className="w-3 h-3 text-emerald-400" />
                <span>صورة حقيقية • تزامن طيفي عربي ({measuredFps} FPS)</span>
              </>
            )}
          </span>
        </div>
      )}

      {/* Bottom Left Floating Equalizer & Viseme Telemetry when Speaking */}
      {(isSpeaking || isTestingMouth) && !isCalibratingMouth && (
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/75 backdrop-blur-md border border-emerald-500/40 pointer-events-none">
          <div className="flex items-center gap-1">
            {[0.6, 0.9, 0.45, 0.85, 1.0, 0.55, 0.8].map((factor, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-emerald-400 transition-all duration-75"
                style={{
                  height: `${Math.max(
                    3,
                    Math.min(20, ((isTestingMouth ? 0.65 : amplitude) + 0.12) * 20 * factor)
                  )}px`,
                }}
              />
            ))}
          </div>
          <span className="text-[10px] font-bold text-emerald-300">
            {ampPercent}% {telemetry ? `• ${telemetry.syncDeltaMs}ms` : ''}
          </span>
        </div>
      )}
    </div>
  );
};
