import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Sparkles,
  Phone,
  Film,
  MessageSquare,
  Wand2,
  Volume2,
  VolumeX,
  Download,
  Plus,
  Play,
  Pause,
  Square,
  AlertCircle,
  X,
  Upload,
  Settings,
  Radio,
  Share2,
  RefreshCw,
} from 'lucide-react';
import {
  PRESET_AVATARS,
  type AvatarProfile,
  type MouthCalibration,
  type VisemeType,
} from './data/avatars';
import { RealisticAvatar } from './components/RealisticAvatar';
import { WhatsAppCallMode } from './components/WhatsAppCallMode';
import { TikTokLiveMode } from './components/TikTokLiveMode';
import { ScriptStudioMode } from './components/ScriptStudioMode';
import { AvatarCreatorModal, VOICE_PRESETS } from './components/AvatarCreatorModal';
import { speechService, type LipSyncTelemetry } from './services/speechService';
import { videoRecorder } from './services/videoRecorder';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  emotion?: 'smile' | 'excited' | 'thinking' | 'serious' | 'nod' | 'greeting';
  time: string;
  viaVoice?: boolean;
}

const STORAGE_KEY = 'qais_saved_user_avatar_v1';

export default function App() {
  // Load saved user face avatar from localStorage if available
  const [avatarsList, setAvatarsList] = useState<AvatarProfile[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as AvatarProfile;
        if (parsed && parsed.id && parsed.imageUrl) {
          return [
            parsed,
            ...PRESET_AVATARS.filter((a) => a.id !== parsed.id),
          ];
        }
      }
    } catch {
      // ignore storage errors
    }
    return PRESET_AVATARS;
  });

  const [selectedAvatar, setSelectedAvatar] = useState<AvatarProfile>(() => avatarsList[0]);
  const [activeTab, setActiveTab] = useState<'chat' | 'whatsapp' | 'tiktok' | 'script'>('chat');

  // Speech & Lip-Sync states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const [viseme, setViseme] = useState<VisemeType>('rest');
  const [amplitude, setAmplitude] = useState(0);
  const [lipSyncTelemetry, setLipSyncTelemetry] = useState<LipSyncTelemetry | null>(null);
  const [currentEmotion, setCurrentEmotion] = useState<
    'smile' | 'excited' | 'thinking' | 'serious' | 'nod' | 'greeting'
  >('smile');
  const [isMuted, setIsMuted] = useState(false);

  // Continuous Voice Conversation Mode (زر تشغيل وإيقاف المحادثة الصوتية)
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  const isVoiceSessionActiveRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  // Microphone & Audio Error Handling States
  const [micError, setMicError] = useState<string | null>(null);
  const [audioNotice, setAudioNotice] = useState<string | null>(null);

  // Chat conversation state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([
    'مرحباً يا قيس، عرفني بنفسك',
    'تحدث معي بصوتك الجديد',
    'أعطني فكرة فيديو تيك توك',
    'ما نصيحتك لي اليوم؟',
  ]);

  // Video recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordRemaining, setRecordRemaining] = useState(10);
  const [downloadModalVideo, setDownloadModalVideo] = useState<{ url: string; blob: Blob } | null>(null);

  // Avatar Creator / Settings Modal
  const [isCreatorModalOpen, setIsCreatorModalOpen] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState<AvatarProfile | null>(null);

  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const quickUploadInputRef = useRef<HTMLInputElement | null>(null);
  const selectedAvatarRef = useRef<AvatarProfile>(selectedAvatar);
  const isMutedRef = useRef<boolean>(isMuted);

  useEffect(() => {
    selectedAvatarRef.current = selectedAvatar;
  }, [selectedAvatar]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isVoiceSessionActiveRef.current = isVoiceSessionActive;
  }, [isVoiceSessionActive]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Save user's primary avatar changes to localStorage (when image-based)
  const persistAvatarUpdate = useCallback((updated: AvatarProfile) => {
    setSelectedAvatar(updated);
    setAvatarsList((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    if (updated.mediaType !== 'video' && updated.imageUrl.length < 4_500_000) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Quota exceeded or private browsing; keep in memory
      }
    }
  }, []);

  // Initialize greeting message when switching avatar
  useEffect(() => {
    speechService.stop();
    setIsSpeaking(false);
    setIsSpeechPaused(false);
    setViseme('rest');
    setAmplitude(0);
    setLipSyncTelemetry(null);

    if (selectedAvatar.mouthConfig) {
      speechService.setCalibration({
        sensitivity: selectedAvatar.mouthConfig.sensitivity ?? 1.15,
        noiseThreshold: selectedAvatar.mouthConfig.noiseThreshold ?? 0.032,
        smoothing: selectedAvatar.mouthConfig.smoothing ?? 0.55,
        latencyOffsetMs: selectedAvatar.mouthConfig.latencyOffsetMs ?? 0,
      });
    }

    const initialGreeting: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'model',
      content: selectedAvatar.welcomeMessage,
      emotion: 'greeting',
      time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages([initialGreeting]);
  }, [selectedAvatar.id]);

  // Auto-scroll chat container
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading, interimTranscript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      speechService.stop();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Start Microphone Speech Recognition
  const startMicRecognition = useCallback(() => {
    const SpeechRec = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRec) {
      setMicError(
        'متصفحك الحالي لا يدعم ميزة التعرف على الصوت المباشر. يرجى استخدام متصفح Google Chrome أو Edge أو Safari، أو كتابة رسالتك نصياً وسيرد عليك قيس بالصوت.'
      );
      setIsVoiceSessionActive(false);
      setIsListening(false);
      return;
    }

    // Stop any current speech before listening
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }

    setMicError(null);
    const rec = new SpeechRec();
    rec.lang = selectedAvatarRef.current.dialectCode || 'ar-SA';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalCaptured = '';

    rec.onstart = () => {
      setIsListening(true);
      setInterimTranscript('');
    };

    rec.onresult = (event: any) => {
      let interim = '';
      let finalStr = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalStr += transcript;
        } else {
          interim += transcript;
        }
      }
      if (interim) {
        setInterimTranscript(interim);
      }
      if (finalStr.trim()) {
        finalCaptured = finalStr.trim();
        setInterimTranscript('');
        handleSendMessage(finalCaptured, true);
      }
    };

    rec.onerror = (event: any) => {
      const errCode = event?.error;
      setIsListening(false);
      setInterimTranscript('');

      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        setMicError(
          'تم رفض إذن الوصول إلى الميكروفون. يرجى السماح للمتصفح باستخدام الميكروفون من أيقونة القفل بجانب عنوان الموقع ثم المحاولة مرة أخرى.'
        );
        setIsVoiceSessionActive(false);
      } else if (errCode === 'audio-capture') {
        setMicError('لم يتم العثور على ميكروفون متصل بجهازك. تأكد من توصيل الميكروفون.');
        setIsVoiceSessionActive(false);
      } else if (errCode === 'network') {
        setMicError('حدث خطأ في الشبكة أثناء التعرف على الصوت. تحقق من اتصالك بالإنترنت.');
      } else if (errCode === 'no-speech') {
        // If in continuous voice conversation mode and not speaking/loading, gently restart listening
        if (isVoiceSessionActiveRef.current && !speechService.getIsSpeaking() && !isLoadingRef.current) {
          setTimeout(() => {
            if (isVoiceSessionActiveRef.current && !speechService.getIsSpeaking() && !isLoadingRef.current) {
              startMicRecognition();
            }
          }, 400);
        }
      }
    };

    rec.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
      // If user didn't speak yet, and continuous mode is active, keep listening
      if (
        !finalCaptured &&
        isVoiceSessionActiveRef.current &&
        !speechService.getIsSpeaking() &&
        !isLoadingRef.current
      ) {
        setTimeout(() => {
          if (isVoiceSessionActiveRef.current && !speechService.getIsSpeaking() && !isLoadingRef.current) {
            startMicRecognition();
          }
        }, 450);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      setIsListening(false);
    }
  }, []);

  // Stop Microphone Recognition
  const stopMicRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  // Speak Message with New Voice & Synchronized Audio-Driven Lip Movement
  const speakMessage = useCallback(
    async (text: string, avatar: AvatarProfile, overrideRate?: number) => {
      if (isMutedRef.current) {
        setAudioNotice('الصوت مكتوم حالياً. اضغط على زر السماعة لتفعيل الصوت وسماع الرد.');
        return;
      }

      setAudioNotice(null);
      setIsSpeechPaused(false);
      speechService.unlockAudioContext();
      // Pause microphone while avatar speaks so it doesn't hear itself
      stopMicRecognition();

      const calibrationPayload = {
        sensitivity: avatar.mouthConfig?.sensitivity ?? 1.15,
        noiseThreshold: avatar.mouthConfig?.noiseThreshold ?? 0.032,
        smoothing: avatar.mouthConfig?.smoothing ?? 0.55,
        latencyOffsetMs: avatar.mouthConfig?.latencyOffsetMs ?? 0,
      };
      const effectiveRate = overrideRate ?? avatar.speechRate;

      const onSpeechEnd = () => {
        setIsSpeaking(false);
        setIsSpeechPaused(false);
        setViseme('rest');
        setAmplitude(0);
        // Resume listening automatically if continuous voice conversation mode is ON
        if (isVoiceSessionActiveRef.current) {
          setTimeout(() => {
            if (isVoiceSessionActiveRef.current && !isLoadingRef.current) {
              startMicRecognition();
            }
          }, 350);
        }
      };

      const fallbackToBrowserSpeech = () => {
        speechService.speakWithWebSpeech(
          text,
          {
            lang: avatar.dialectCode,
            pitch: avatar.speechPitch,
            rate: effectiveRate,
            calibration: calibrationPayload,
          },
          {
            onStart: () => {
              setIsSpeaking(true);
              setIsSpeechPaused(false);
            },
            onViseme: (amp, v, telemetry) => {
              setAmplitude(amp);
              setViseme(v);
              if (telemetry) setLipSyncTelemetry(telemetry);
            },
            onEnd: onSpeechEnd,
            onError: () => {
              setAudioNotice('تعذر تشغيل النطق الصوتي تلقائياً، اضغط على "إعادة النطق" أسفل الرسالة.');
              onSpeechEnd();
            },
          }
        );
      };

      try {
        // IMPORTANT (Requirement 5 & 10): Do NOT set isSpeaking(true) before audio arrives!
        // Keep mouth at rest while fetching TTS audio over the network.
        setIsSpeaking(false);
        setViseme('rest');
        setAmplitude(0);
        setCurrentEmotion('smile');

        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice: avatar.voiceName,
          }),
        });

        const data = await res.json();

        if (data.audioBase64) {
          await speechService.playGeminiAudio(
            data.audioBase64,
            {
              onStart: () => {
                setIsSpeaking(true);
                setIsSpeechPaused(false);
              },
              onViseme: (amp, v, telemetry) => {
                setAmplitude(amp);
                setViseme(v);
                if (telemetry) setLipSyncTelemetry(telemetry);
              },
              onEnd: onSpeechEnd,
              onError: () => {
                fallbackToBrowserSpeech();
              },
            },
            {
              rate: effectiveRate,
              pitch: avatar.speechPitch,
              text,
              calibration: calibrationPayload,
            }
          );
        } else {
          fallbackToBrowserSpeech();
        }
      } catch {
        fallbackToBrowserSpeech();
      }
    },
    [startMicRecognition, stopMicRecognition]
  );

  // Pause / Resume Active Speech Audio & Lip-Sync (Requirement 5)
  const handleTogglePauseSpeech = useCallback(async () => {
    if (!isSpeaking) return;
    if (isSpeechPaused) {
      await speechService.resume();
      setIsSpeechPaused(false);
    } else {
      await speechService.pause();
      setIsSpeechPaused(true);
      setViseme('rest');
      setAmplitude(0);
    }
  }, [isSpeaking, isSpeechPaused]);

  // Run Instant Web Audio Formant Pulse Test (بَا - مُو - فِي - قَيْس)
  const handleTestFormantPulse = useCallback(async () => {
    speechService.unlockAudioContext();
    stopMicRecognition();
    await speechService.playCalibrationTestSequence({
      onStart: () => {
        setIsSpeaking(true);
        setIsSpeechPaused(false);
      },
      onViseme: (amp, v, telemetry) => {
        setAmplitude(amp);
        setViseme(v);
        if (telemetry) setLipSyncTelemetry(telemetry);
      },
      onEnd: () => {
        setIsSpeaking(false);
        setIsSpeechPaused(false);
        setViseme('rest');
        setAmplitude(0);
      },
    });
  }, [stopMicRecognition]);

  // Run Arabic Phonetic Test Clip from Calibration Panel
  const handleTestArabicClip = useCallback(
    (testText: string, rate?: number) => {
      speakMessage(testText, selectedAvatarRef.current, rate);
    },
    [speakMessage]
  );

  // Reply to TikTok LIVE Comment with Real-Time Audio Lip-Sync
  const handleReplyToTikTokLiveComment = useCallback(
    async (viewerName: string, commentText: string) => {
      const prompt = `متابع في البث المباشر اسمه "${viewerName}" كتب تعليقاً يقول: "${commentText}". رد عليه الآن باسمه مباشرة بترحيب حيوي وجواب مختصر مناسب لبث تيك توك المباشر.`;
      await handleSendMessage(prompt, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, selectedAvatar]
  );

  // Toggle Continuous Voice Conversation On/Off (زر تشغيل وإيقاف المحادثة الصوتية)
  const toggleVoiceConversation = () => {
    speechService.unlockAudioContext();

    if (isVoiceSessionActive) {
      // Turn OFF voice conversation
      setIsVoiceSessionActive(false);
      isVoiceSessionActiveRef.current = false;
      stopMicRecognition();
      speechService.stop();
      setIsSpeaking(false);
      setViseme('rest');
      setAmplitude(0);
    } else {
      // Turn ON voice conversation
      setIsMuted(false);
      isMutedRef.current = false;
      setMicError(null);
      setAudioNotice(null);
      setIsVoiceSessionActive(true);
      isVoiceSessionActiveRef.current = true;
      speechService.stop();
      setIsSpeaking(false);
      startMicRecognition();
    }
  };

  // Single push-to-talk mic button in chat bar
  const toggleSingleMic = () => {
    speechService.unlockAudioContext();
    if (isListening) {
      stopMicRecognition();
    } else {
      speechService.stop();
      setIsSpeaking(false);
      startMicRecognition();
    }
  };

  // Send message to Gemini Server API
  const handleSendMessage = async (textToSend: string, fromVoice = false) => {
    const trimmed = textToSend.trim();
    if (!trimmed || isLoadingRef.current) return;

    speechService.unlockAudioContext();
    speechService.stop();
    stopMicRecognition();
    setIsSpeaking(false);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      viaVoice: fromVoice,
    };

    const currentAvatar = selectedAvatarRef.current;
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputQuery('');
    setIsLoading(true);
    isLoadingRef.current = true;
    setCurrentEmotion('thinking');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          avatarConfig: {
            name: currentAvatar.name,
            dialect: currentAvatar.dialect,
            role: currentAvatar.role,
            tone: currentAvatar.tone,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر استلام الرد من الخادم');
      }

      const botReply =
        data.reply || 'حياك الله! سمعت كلامك بكل وضوح، كيف أقدر أخدمك أكثر في هذا الموضوع؟';
      const emotion = data.emotion || 'smile';

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'model',
        content: botReply,
        emotion,
        time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMsg]);
      setCurrentEmotion(emotion);

      if (data.suggestedReplies && data.suggestedReplies.length > 0) {
        setSuggestedReplies(data.suggestedReplies);
      }

      setIsLoading(false);
      isLoadingRef.current = false;

      // Speak the reply with the new voice and lip-sync
      await speakMessage(botReply, currentAvatar);
    } catch (err: any) {
      console.error('Chat error:', err);
      setIsLoading(false);
      isLoadingRef.current = false;
      const fallbackReply = `أهلاً بك! أنا ${currentAvatar.name} معك على الخط. حدث انقطاع بسيط في الشبكة، تفضل بإعادة سؤالك وسأرد عليك فوراً.`;
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'model',
        content: fallbackReply,
        emotion: 'serious',
        time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
      await speakMessage(fallbackReply, currentAvatar);
    }
  };

  // Quick Upload Photo or Video directly to current Avatar (Preserving User's Real Face)
  const handleQuickMediaUpload = (file: File) => {
    setMicError(null);
    if (file.type.startsWith('video/')) {
      const videoObjectUrl = URL.createObjectURL(file);
      // Immediately update avatar with the uploaded video so it displays right away on all browsers
      const immediateUpdated: AvatarProfile = {
        ...selectedAvatar,
        videoUrl: videoObjectUrl,
        mediaType: 'video',
        isUserFace: true,
        mouthConfig: {
          x: selectedAvatar.mouthConfig?.x ?? 50,
          y: selectedAvatar.mouthConfig?.y ?? 54,
          scale: selectedAvatar.mouthConfig?.scale ?? 1,
          mode: 'natural-warp',
        },
      };
      persistAvatarUpdate(immediateUpdated);
      speakMessage(
        'تم رفع الفيديو بنجاح! يمكنك ضبط موضع الشفاه على الفيديو لتتزامن حركتها مع صوتي الجديد.',
        immediateUpdated
      );

      // Asynchronously extract poster frame for avatar thumbnail bar
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = videoObjectUrl;
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      tempVideo.currentTime = 0.1;
      tempVideo.onloadeddata = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = tempVideo.videoWidth || 480;
          canvas.height = tempVideo.videoHeight || 640;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
            const posterDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            persistAvatarUpdate({
              ...immediateUpdated,
              imageUrl: posterDataUrl,
            });
          }
        } catch {
          // ignore thumbnail extraction error
        }
      };
      tempVideo.load();
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const updated: AvatarProfile = {
            ...selectedAvatar,
            imageUrl: reader.result,
            videoUrl: undefined,
            mediaType: 'image',
            isUserFace: true,
          };
          persistAvatarUpdate(updated);
          speakMessage(
            'تم تحديث صورتك الحقيقية بنجاح! يمكنك أيضاً ضبط موضع الشفاه من الزر أعلى الصورة.',
            updated
          );
        }
      };
      reader.readAsDataURL(file);
    } else {
      setMicError('يرجى اختيار ملف صورة (JPG, PNG) أو ملف فيديو (MP4, WEBM, MOV).');
    }
  };

  const handleUpdateMouthConfig = (mouthConfig: MouthCalibration) => {
    speechService.setCalibration({
      sensitivity: mouthConfig.sensitivity ?? 1.15,
      noiseThreshold: mouthConfig.noiseThreshold ?? 0.032,
      smoothing: mouthConfig.smoothing ?? 0.55,
      latencyOffsetMs: mouthConfig.latencyOffsetMs ?? 0,
    });
    const updated: AvatarProfile = {
      ...selectedAvatar,
      mouthConfig,
    };
    persistAvatarUpdate(updated);
  };

  // Video Clip Recording Handler
  const handleRecordVideoClip = async (scriptText?: string) => {
    if (isRecording) {
      videoRecorder.stop();
      setIsRecording(false);
      return;
    }

    const lastText =
      scriptText || messages[messages.length - 1]?.content || selectedAvatar.welcomeMessage;
    setIsRecording(true);
    setRecordRemaining(10);

    speakMessage(lastText, selectedAvatar);

    await videoRecorder.startRecording(selectedAvatar.imageUrl, selectedAvatar.name, lastText, {
      durationSeconds: 10,
      onProgress: (remaining) => setRecordRemaining(remaining),
      onComplete: (blob, url) => {
        setIsRecording(false);
        setDownloadModalVideo({ url, blob });
      },
    });
  };

  const lastBotMessage = [...messages].reverse().find((m) => m.role === 'model')?.content;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Cairo',sans-serif] text-right"
    >
      {/* Hidden Input for Top Bar Quick Upload */}
      <input
        ref={quickUploadInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleQuickMediaUpload(f);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Top Navigation Header (100% Arabic RTL & Mobile Responsive) */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3 sm:px-4 py-2.5 select-none">
        <div className="max-w-7xl mx-auto flex flex-col gap-2.5">
          {/* Row 1: Brand + Primary Voice Conversation Toggle + Upload Media */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Brand Title */}
            <div className="flex items-center gap-2.5">
              <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
                <span
                  className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-slate-900 ${
                    isVoiceSessionActive || isSpeaking
                      ? 'bg-emerald-400 animate-ping'
                      : 'bg-red-500'
                  }`}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-black text-white">
                    استوديو قيس للشخصية الحقيقية الناطقة
                  </h1>
                  <span className="hidden sm:inline-block text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                    وجهك الحقيقي + صوت جديد
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  محادثة صوتية فورية • مزامنة الشفاه • تيك توك وواتساب
                </p>
              </div>
            </div>

            {/* Primary Action Buttons: Start/Stop Voice Conversation + Upload Photo/Video */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              {/* REQUIREMENT 4: Start / Stop Voice Conversation Button */}
              <button
                type="button"
                onClick={toggleVoiceConversation}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg active:scale-95 ${
                  isVoiceSessionActive
                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/30 ring-2 ring-red-400/50'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/25'
                }`}
              >
                {isVoiceSessionActive ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>إيقاف المحادثة الصوتية</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-4 h-4 animate-pulse" />
                    <span>تشغيل المحادثة الصوتية</span>
                  </>
                )}
              </button>

              {/* REQUIREMENT 5: Upload New Photo or Video Easily */}
              <button
                type="button"
                onClick={() => quickUploadInputRef.current?.click()}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95"
                title="ارفع صورتك أو فيديوهك الحقيقي"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                <span>رفع صورتي / فيديو</span>
              </button>

              {/* Voice Settings Button */}
              <button
                type="button"
                onClick={() => {
                  setEditingAvatar(selectedAvatar);
                  setIsCreatorModalOpen(true);
                }}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors"
                title="تغيير الصوت الجديد وإعدادات الوجه"
              >
                <Settings className="w-4 h-4" />
              </button>

              {/* Mute / Unmute Audio */}
              <button
                type="button"
                onClick={() => {
                  if (isSpeaking) {
                    speechService.stop();
                    setIsSpeaking(false);
                    setViseme('rest');
                    setAmplitude(0);
                  }
                  setIsMuted(!isMuted);
                }}
                className={`p-2 rounded-xl border transition-colors ${
                  isMuted
                    ? 'bg-red-500/20 border-red-500/40 text-red-400'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                }`}
                title={isMuted ? 'تفعيل الصوت' : 'كتم الصوت'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Row 2: Mode Navigation Tabs */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/70">
            <div className="flex items-center bg-slate-950 p-1 rounded-2xl border border-slate-800 overflow-x-auto scrollbar-none w-full sm:w-auto">
              {[
                { id: 'chat', label: 'المحادثة المباشرة', icon: MessageSquare },
                { id: 'whatsapp', label: 'مكالمة واتساب', icon: Phone },
                { id: 'tiktok', label: 'تيك توك لايف', icon: Film },
                { id: 'script', label: 'استوديو السيناريو', icon: Wand2 },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                      isActive
                        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Record Video Clip Button */}
            <button
              type="button"
              onClick={() => handleRecordVideoClip()}
              disabled={isRecording}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shrink-0 ${
                isRecording
                  ? 'bg-red-600 animate-pulse text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isRecording ? `تسجيل (${recordRemaining}ث)` : 'حفظ فيديو'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Active Voice Conversation Status Banner */}
      {isVoiceSessionActive && (
        <div className="bg-emerald-950/90 border-b border-emerald-500/40 px-4 py-2 text-xs text-emerald-200 flex items-center justify-between gap-2 max-w-7xl w-full mx-auto">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <span className="font-bold">
              {isSpeaking
                ? `🔊 ${selectedAvatar.name} يرد عليك الآن بالصوت الجديد...`
                : isLoading
                ? `⏳ جاري تجهيز الرد الصوتي من ${selectedAvatar.name}...`
                : isListening
                ? '🎙️ الميكروفون يستمع إليك الآن.. تحدث بحرية وسيرد عليك تلقائياً!'
                : '🎙️ المحادثة الصوتية نشطة..'}
            </span>
          </div>
          <button
            type="button"
            onClick={toggleVoiceConversation}
            className="px-2.5 py-1 rounded-lg bg-red-600/80 hover:bg-red-600 text-white font-bold text-[11px] shrink-0"
          >
            إيقاف
          </button>
        </div>
      )}

      {/* Microphone / Audio Error & Notice Banners (Requirement 7) */}
      {(micError || audioNotice) && (
        <div className="max-w-7xl w-full mx-auto px-4 pt-3">
          {micError && (
            <div className="p-3 rounded-2xl bg-red-950/90 border border-red-500/40 text-red-200 text-xs flex items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{micError}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setMicError(null);
                    startMicRecognition();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-white font-bold text-[11px] flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>إعادة المحاولة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMicError(null)}
                  className="p-1 text-red-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {audioNotice && !micError && (
            <div className="p-3 rounded-2xl bg-amber-950/90 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{audioNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsMuted(false);
                  isMutedRef.current = false;
                  setAudioNotice(null);
                  if (lastBotMessage) speakMessage(lastBotMessage, selectedAvatar);
                }}
                className="px-3 py-1 rounded-lg bg-amber-500 text-black font-bold text-[11px] shrink-0"
              >
                تشغيل الصوت الآن
              </button>
            </div>
          )}
        </div>
      )}

      {/* Character & Voice Selector Bar */}
      <section className="bg-slate-900/60 border-b border-slate-800/80 px-3 sm:px-4 py-2.5 select-none">
        <div className="max-w-7xl mx-auto flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="text-xs font-bold text-slate-400 whitespace-nowrap ml-1">
            الشخصية:
          </span>

          {avatarsList.map((av) => {
            const isSelected = selectedAvatar.id === av.id;
            return (
              <button
                key={av.id}
                type="button"
                onClick={() => setSelectedAvatar(av)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="relative">
                  <img
                    src={av.imageUrl}
                    alt={av.name}
                    className="w-7 h-7 rounded-full object-cover border border-white/20"
                  />
                  {isSelected && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border border-slate-950" />
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold leading-tight">{av.name}</div>
                  <div className="text-[10px] text-emerald-400/90">
                    {av.mediaType === 'video' ? 'فيديو حقيقي' : av.dialect}
                  </div>
                </div>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setEditingAvatar(null);
              setIsCreatorModalOpen(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-2xl border border-dashed border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold transition-all whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>شخصية جديدة</span>
          </button>
        </div>
      </section>

      {/* Main Content Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 flex flex-col justify-center">
        {/* TAB 1: LIVE CHAT & REAL FACE AVATAR STUDIO */}
        {activeTab === 'chat' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Right Column (in RTL): Realistic Avatar Stage + Quick Voice & Face Controls */}
            <div className="lg:col-span-5 flex flex-col items-center gap-3 w-full">
              <RealisticAvatar
                avatar={selectedAvatar}
                isSpeaking={isSpeaking && !isSpeechPaused}
                viseme={viseme}
                amplitude={amplitude}
                telemetry={lipSyncTelemetry}
                emotion={currentEmotion}
                aspectRatio="9:16"
                onQuickUploadMedia={handleQuickMediaUpload}
                onUpdateMouthConfig={handleUpdateMouthConfig}
                onTestArabicClip={handleTestArabicClip}
                onTestFormantPulse={handleTestFormantPulse}
                className="w-full max-h-[440px] sm:max-h-[540px]"
              />

              {/* Quick New Voice Switcher Card */}
              <div className="w-full max-w-sm p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>الصوت الجديد للشخصية:</span>
                  </span>
                  {isSpeaking && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleTogglePauseSpeech}
                        className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center gap-1"
                      >
                        {isSpeechPaused ? (
                          <>
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>استئناف</span>
                          </>
                        ) : (
                          <>
                            <Pause className="w-2.5 h-2.5 fill-current" />
                            <span>إيقاف مؤقت</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          speechService.stop();
                          setIsSpeaking(false);
                          setIsSpeechPaused(false);
                          setViseme('rest');
                          setAmplitude(0);
                        }}
                        className="px-2.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 text-[11px] font-bold flex items-center gap-1"
                      >
                        <Square className="w-2.5 h-2.5 fill-current" />
                        <span>إنهاء النطق</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Quick Voice Preset Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1">
                  {VOICE_PRESETS.map((vp) => {
                    const active = selectedAvatar.voiceName === vp.id;
                    return (
                      <button
                        key={vp.id}
                        type="button"
                        onClick={() => {
                          const updated: AvatarProfile = {
                            ...selectedAvatar,
                            voiceName: vp.id,
                            speechPitch: vp.defaultPitch,
                            speechRate: vp.defaultRate,
                          };
                          persistAvatarUpdate(updated);
                          speakMessage(`مرحباً، هذا هو صوتي الجديد: ${vp.label}`, updated);
                        }}
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap border transition-all ${
                          active
                            ? 'bg-emerald-500 text-white border-emerald-400 shadow-sm'
                            : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {vp.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Left Column (in RTL): Clear Conversation Thread & Voice/Text Input */}
            <div className="lg:col-span-7 flex flex-col h-[540px] sm:h-[640px] rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl overflow-hidden w-full">
              {/* Chat Header */}
              <div className="p-3.5 sm:p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <img
                      src={selectedAvatar.imageUrl}
                      alt={selectedAvatar.name}
                      className="w-10 h-10 rounded-full object-cover border border-emerald-500"
                    />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full border border-slate-900" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm flex items-center gap-1.5">
                      <span>{selectedAvatar.name}</span>
                      <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full">
                        {isSpeaking ? 'يتحدث الآن 🔊' : isListening ? 'يستمع إليك 🎙️' : 'متصل الآن'}
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      اللهجة: {selectedAvatar.dialect} • الصوت: {selectedAvatar.voiceName}
                    </p>
                  </div>
                </div>

                {/* Quick Mode Switchers */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleVoiceConversation}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition-all ${
                      isVoiceSessionActive
                        ? 'bg-red-600/20 border-red-500/40 text-red-300'
                        : 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30'
                    }`}
                  >
                    {isVoiceSessionActive ? (
                      <>
                        <MicOff className="w-3.5 h-3.5" />
                        <span>إيقاف الصوتية</span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5" />
                        <span>محادثة صوتية</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Conversation Messages Scroll Area (Requirement 7: Clear Display) */}
              <div
                ref={chatContainerRef}
                className="flex-1 p-3.5 sm:p-4 overflow-y-auto space-y-3.5"
              >
                {messages.map((msg) => {
                  const isBot = msg.role === 'model';
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-2.5 ${
                        isBot ? 'flex-row' : 'flex-row-reverse'
                      }`}
                    >
                      {isBot && (
                        <img
                          src={selectedAvatar.imageUrl}
                          alt={selectedAvatar.name}
                          className="w-8 h-8 rounded-full object-cover border border-emerald-400 shrink-0 mt-1"
                        />
                      )}

                      <div
                        className={`max-w-[85%] rounded-2xl p-3.5 shadow-md ${
                          isBot
                            ? 'bg-slate-800/95 border border-slate-700/80 text-slate-100 rounded-tr-none'
                            : 'bg-emerald-600 text-white rounded-tl-none'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1 text-[10px] opacity-80">
                          <span className="font-bold">
                            {isBot ? selectedAvatar.name : msg.viaVoice ? 'أنت (بالصوت 🎙️)' : 'أنت'}
                          </span>
                          <span>{msg.time}</span>
                        </div>

                        <p className="text-sm leading-relaxed whitespace-pre-line font-medium">
                          {msg.content}
                        </p>

                        {isBot && (
                          <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-end gap-3 text-[11px]">
                            <button
                              type="button"
                              onClick={() => speakMessage(msg.content, selectedAvatar)}
                              className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-bold"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>إعادة النطق بالصوت الجديد</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Live Interim Speech Preview Bubble while User is Talking */}
                {(isListening || interimTranscript) && (
                  <div className="flex items-center justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-emerald-900/50 border border-emerald-500/40 px-4 py-2.5 text-emerald-200 text-xs flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping shrink-0" />
                      <span>
                        {interimTranscript
                          ? `جاري الاستماع: "${interimTranscript}..."`
                          : 'جاري الاستماع لصوتك... تحدث الآن'}
                      </span>
                    </div>
                  </div>
                )}

                {isLoading && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 p-2.5 rounded-xl bg-slate-800/50 w-fit">
                    <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    <span>{selectedAvatar.name} يجهز الرد الصوتي...</span>
                  </div>
                )}
              </div>

              {/* Suggested Quick Replies */}
              <div className="px-3.5 py-2 border-t border-slate-800/80 flex items-center gap-1.5 overflow-x-auto scrollbar-none bg-slate-950/40">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                {suggestedReplies.map((reply, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(reply)}
                    className="whitespace-nowrap px-3 py-1 rounded-full bg-slate-800 hover:bg-emerald-950/50 hover:border-emerald-500/40 border border-slate-700 text-slate-300 hover:text-white text-xs transition-all active:scale-95"
                  >
                    {reply}
                  </button>
                ))}
              </div>

              {/* Chat Input & Mic Controls */}
              <div className="p-3 border-t border-slate-800 bg-slate-950">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage(inputQuery, false);
                  }}
                  className="flex items-center gap-2"
                >
                  {/* Mic Push Button */}
                  <button
                    type="button"
                    onClick={toggleSingleMic}
                    className={`p-3 rounded-2xl transition-all shrink-0 ${
                      isListening
                        ? 'bg-red-600 animate-pulse text-white shadow-lg shadow-red-600/30'
                        : 'bg-slate-800 text-slate-200 hover:text-white hover:bg-slate-700'
                    }`}
                    title={isListening ? 'إيقاف الاستماع' : 'تحدث بالصوت'}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  {/* Text Input */}
                  <input
                    type="text"
                    value={inputQuery}
                    onChange={(e) => setInputQuery(e.target.value)}
                    placeholder={`اكتب رسالتك أو اضغط الميكروفون للتحدث مع ${selectedAvatar.name}...`}
                    className="flex-1 px-4 py-3 rounded-2xl bg-slate-900 border border-slate-700 text-white text-xs sm:text-sm placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                  />

                  {/* Send Button */}
                  <button
                    type="submit"
                    disabled={!inputQuery.trim() || isLoading}
                    className="p-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white font-bold transition-transform active:scale-95 shadow-md shadow-emerald-500/20 shrink-0"
                    title="إرسال"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WHATSAPP VIDEO CALL MODE */}
        {activeTab === 'whatsapp' && (
          <div className="py-1">
            <WhatsAppCallMode
              avatar={selectedAvatar}
              isSpeaking={isSpeaking && !isSpeechPaused}
              viseme={viseme}
              amplitude={amplitude}
              emotion={currentEmotion}
              onSendMessage={(msg) => handleSendMessage(msg, false)}
              onEndCall={() => setActiveTab('chat')}
              lastMessageText={lastBotMessage}
              onRecordVideoClip={() => handleRecordVideoClip()}
              isRecording={isRecording}
            />
          </div>
        )}

        {/* TAB 3: TIKTOK LIVE & REELS MODE */}
        {activeTab === 'tiktok' && (
          <div className="py-1">
            <TikTokLiveMode
              avatar={selectedAvatar}
              isSpeaking={isSpeaking && !isSpeechPaused}
              isLoading={isLoading}
              viseme={viseme}
              amplitude={amplitude}
              emotion={currentEmotion}
              onReplyToLiveComment={handleReplyToTikTokLiveComment}
              lastMessageText={lastBotMessage}
              onRecordVideoClip={() => handleRecordVideoClip()}
              isRecording={isRecording}
            />
          </div>
        )}

        {/* TAB 4: SCRIPT & VIDEO CREATOR STUDIO */}
        {activeTab === 'script' && (
          <div className="py-1">
            <ScriptStudioMode
              avatar={selectedAvatar}
              onDeliverScript={(scriptText) => {
                setActiveTab('chat');
                handleSendMessage(`ألقِ هذا النص بصوتك الجديد: "${scriptText}"`, false);
              }}
              onRecordScriptVideo={(scriptText) => {
                handleRecordVideoClip(scriptText);
              }}
              isRecording={isRecording}
            />
          </div>
        )}
      </main>

      {/* Download Video Clip Modal */}
      {downloadModalVideo && (
        <div
          dir="rtl"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in select-none"
        >
          <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden p-6 text-center space-y-4">
            <button
              onClick={() => setDownloadModalVideo(null)}
              className="absolute top-4 left-4 p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <Film className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">تم تجهيز كليب الفيديو بنجاح! 🎬</h3>
              <p className="text-xs text-slate-400 mt-1">
                الفيديو جاهز الآن للتحميل أو المشاركة على تيك توك وواتساب
              </p>
            </div>

            <div className="rounded-2xl overflow-hidden bg-black aspect-[9/16] max-h-72 mx-auto border border-slate-800 shadow-inner">
              <video
                src={downloadModalVideo.url}
                controls
                autoPlay
                loop
                className="w-full h-full object-contain"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => {
                  videoRecorder.downloadVideo(
                    downloadModalVideo.url,
                    `${selectedAvatar.name.replace(/\s+/g, '_')}_video.webm`
                  );
                }}
                className="py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>تحميل الفيديو</span>
              </button>

              <button
                onClick={() => {
                  const shareText = encodeURIComponent(
                    `شاهد هذا الفيديو من الشخصية الناطقة ${selectedAvatar.name}!`
                  );
                  window.open(`https://wa.me/?text=${shareText}`, '_blank');
                }}
                className="py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                <Share2 className="w-4 h-4" />
                <span>مشاركة للواتساب</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Avatar & Voice Settings Modal */}
      <AvatarCreatorModal
        isOpen={isCreatorModalOpen}
        initialAvatar={editingAvatar}
        onClose={() => {
          setIsCreatorModalOpen(false);
          setEditingAvatar(null);
        }}
        onSaveAvatar={(newAv) => {
          setAvatarsList((prev) => {
            const exists = prev.some((a) => a.id === newAv.id);
            if (exists) {
              return prev.map((a) => (a.id === newAv.id ? newAv : a));
            }
            return [newAv, ...prev];
          });
          persistAvatarUpdate(newAv);
        }}
      />
    </div>
  );
}
