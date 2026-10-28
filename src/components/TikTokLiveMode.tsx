import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Heart,
  Sparkles,
  Send,
  Download,
  Play,
  Pause,
  Trash2,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Radio,
  ShieldCheck,
  FlaskConical,
  ListOrdered,
  Clock,
  Eye,
  EyeOff,
  Smartphone,
  Link2,
  MessageSquare,
  Info,
  Volume2,
} from 'lucide-react';
import type { AvatarProfile, VisemeType } from '../data/avatars';
import { RealisticAvatar } from './RealisticAvatar';

export interface LiveCommentEvent {
  id: string;
  timestamp: number;
  user: string;
  uniqueId: string;
  avatar: string;
  text: string;
  source: 'tiktok-live' | 'test' | 'host';
  badge?: string;
  eventType: 'comment' | 'gift';
  giftName?: string;
  giftIcon?: string;
  status?: 'queued' | 'answering' | 'answered' | 'skipped-duplicate' | 'received';
}

interface FloatingHeart {
  id: number;
  x: number;
  color: string;
}

interface TikTokLiveModeProps {
  avatar: AvatarProfile;
  isSpeaking: boolean;
  isLoading: boolean;
  viseme: VisemeType;
  amplitude: number;
  emotion: any;
  onReplyToLiveComment: (viewerName: string, commentText: string) => Promise<void>;
  lastMessageText?: string;
  onRecordVideoClip?: () => void;
  isRecording?: boolean;
}

export const TikTokLiveMode: React.FC<TikTokLiveModeProps> = ({
  avatar,
  isSpeaking,
  isLoading,
  viseme,
  amplitude,
  emotion,
  onReplyToLiveComment,
  lastMessageText,
  onRecordVideoClip,
  isRecording = false,
}) => {
  // Connection & Server Event Polling States
  const [connectedToRealWebhook, setConnectedToRealWebhook] = useState(false);
  const [webhookSecretConfigured, setWebhookSecretConfigured] = useState(false);
  const [targetUsername, setTargetUsername] = useState('@ahlam.live');
  const [usernameInput, setUsernameInput] = useState('@ahlam.live');
  const [usernameSaved, setUsernameSaved] = useState(false);
  const [totalRealEvents, setTotalRealEvents] = useState(0);
  const [totalTestEvents, setTotalTestEvents] = useState(0);

  // Comments Stream & Queue States (Task 5)
  const [comments, setComments] = useState<LiveCommentEvent[]>([]);
  const [commentQueue, setCommentQueue] = useState<LiveCommentEvent[]>([]);
  const [activeCommentBeingAnswered, setActiveCommentBeingAnswered] =
    useState<LiveCommentEvent | null>(null);
  const [isAutoReplyEnabled, setIsAutoReplyEnabled] = useState(true);
  const [cooldownSeconds, setCooldownSeconds] = useState(5);
  const [skippedDuplicatesCount, setSkippedDuplicatesCount] = useState(0);
  const [serverSkippedDuplicates, setServerSkippedDuplicates] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Stage Separation & Clean 9:16 Broadcast Mode (Task 7)
  const [isCleanStageMode, setIsCleanStageMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('stage') === '1';
    }
    return false;
  });
  const [showStageOverlays, setShowStageOverlays] = useState(true);

  // Local Test Mode Inputs (Task 6)
  const [testViewerName, setTestViewerName] = useState('عبدالله السبيعي');
  const [testCommentText, setTestCommentText] = useState('يا هلا بأحلام! وش أهم نصيحة لليوم؟');
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Control Panel Sub-tabs
  const [controlTab, setControlTab] = useState<'queue' | 'test' | 'connect' | 'mobile'>('test');
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedBridgeScript, setCopiedBridgeScript] = useState(false);

  // Visual Hearts & Gifts
  const [hearts, setHearts] = useState<FloatingHeart[]>([]);
  const [activeGift, setActiveGift] = useState<{ name: string; icon: string; user: string } | null>(
    null
  );

  // Refs for Queue, Deduplication & Non-overlapping speech synchronization
  const lastPolledTimestampRef = useRef<number>(0);
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const recentContentHashesRef = useRef<Map<string, number>>(new Map());
  const isProcessingQueueRef = useRef<boolean>(false);
  const lastReplyFinishedAtRef = useRef<number>(0);
  const wasSpeakingRef = useRef<boolean>(false);
  const heartCounterRef = useRef<number>(0);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/tiktok/webhook`
      : '/api/tiktok/webhook';

  const addHeart = useCallback(() => {
    const colors = ['#f43f5e', '#ec4899', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const id = ++heartCounterRef.current;
    const x = Math.random() * 80 - 40;
    setHearts((prev) => [...prev.slice(-12), { id, x, color: randomColor }]);
    setTimeout(() => {
      setHearts((prev) => prev.filter((h) => h.id !== id));
    }, 1800);
  }, []);

  // Track when avatar finishes speaking to start rate-limit cooldown accurately
  useEffect(() => {
    if (wasSpeakingRef.current && !isSpeaking && !isLoading) {
      lastReplyFinishedAtRef.current = Date.now();
      isProcessingQueueRef.current = false;
      if (activeCommentBeingAnswered) {
        const finishedId = activeCommentBeingAnswered.id;
        setComments((prev) =>
          prev.map((c) => (c.id === finishedId ? { ...c, status: 'answered' } : c))
        );
        setAnsweredCount((c) => c + 1);
        setActiveCommentBeingAnswered(null);
      }
    }
    wasSpeakingRef.current = isSpeaking || isLoading;
  }, [isSpeaking, isLoading, activeCommentBeingAnswered]);

  // Cooldown countdown display timer
  useEffect(() => {
    const timer = setInterval(() => {
      if (isSpeaking || isLoading || lastReplyFinishedAtRef.current === 0) {
        setCooldownRemaining(0);
        return;
      }
      const elapsedSec = (Date.now() - lastReplyFinishedAtRef.current) / 1000;
      const rem = Math.max(0, Math.ceil(cooldownSeconds - elapsedSec));
      setCooldownRemaining(rem);
    }, 300);
    return () => clearInterval(timer);
  }, [cooldownSeconds, isSpeaking, isLoading]);

  // Enqueue incoming events with Deduplication (Task 5)
  const ingestIncomingEvents = useCallback(
    (incoming: LiveCommentEvent[]) => {
      if (!incoming || incoming.length === 0) return;

      const now = Date.now();
      // Clean up hashes older than 2 minutes
      for (const [hash, ts] of recentContentHashesRef.current.entries()) {
        if (now - ts > 120_000) {
          recentContentHashesRef.current.delete(hash);
        }
      }

      const newDisplayComments: LiveCommentEvent[] = [];
      const newQueueItems: LiveCommentEvent[] = [];

      for (const evt of incoming) {
        if (processedEventIdsRef.current.has(evt.id)) continue;
        processedEventIdsRef.current.add(evt.id);

        if (evt.timestamp > lastPolledTimestampRef.current) {
          lastPolledTimestampRef.current = evt.timestamp;
        }

        if (evt.eventType === 'gift') {
          setActiveGift({
            name: evt.giftName || 'هدية بث',
            icon: evt.giftIcon || '🎁',
            user: evt.user,
          });
          setTimeout(() => setActiveGift(null), 3500);
        }

        // Normalize content hash for deduplication (user + normalized text)
        const normalizedText = evt.text.trim().replace(/\s+/g, ' ').toLowerCase();
        const dedupKey = `${evt.user.trim().toLowerCase()}:${normalizedText}`;
        const lastSeenAt = recentContentHashesRef.current.get(dedupKey);

        if (lastSeenAt && now - lastSeenAt < 120_000) {
          // Duplicate comment detected within 2-minute window!
          setSkippedDuplicatesCount((c) => c + 1);
          newDisplayComments.push({
            ...evt,
            status: 'skipped-duplicate',
          });
          continue;
        }

        recentContentHashesRef.current.set(dedupKey, now);

        const status: LiveCommentEvent['status'] = isAutoReplyEnabled ? 'queued' : 'received';
        const enriched: LiveCommentEvent = { ...evt, status };
        newDisplayComments.push(enriched);

        if (isAutoReplyEnabled) {
          newQueueItems.push(enriched);
        }
      }

      if (newDisplayComments.length > 0) {
        setComments((prev) => [...prev.slice(-30), ...newDisplayComments]);
        addHeart();
      }

      if (newQueueItems.length > 0) {
        setCommentQueue((prev) => [...prev, ...newQueueItems].slice(0, 25));
      }
    },
    [isAutoReplyEnabled, addHeart]
  );

  // Poll server for incoming TikTok LIVE webhook & test events
  useEffect(() => {
    let isMounted = true;

    const pollServerEvents = async () => {
      try {
        const res = await fetch(
          `/api/tiktok/events?since=${lastPolledTimestampRef.current}`
        );
        if (!res.ok || !isMounted) return;
        const data = await res.json();
        if (!isMounted) return;

        setConnectedToRealWebhook(Boolean(data.connectedToRealWebhook));
        setWebhookSecretConfigured(Boolean(data.webhookSecretConfigured));
        if (data.targetUsername) {
          setTargetUsername(data.targetUsername);
        }
        setTotalRealEvents(data.totalRealEvents || 0);
        setTotalTestEvents(data.totalTestEvents || 0);
        if (typeof data.serverSkippedDuplicates === 'number') {
          setServerSkippedDuplicates(data.serverSkippedDuplicates);
        }

        if (Array.isArray(data.events) && data.events.length > 0) {
          ingestIncomingEvents(data.events);
        }
      } catch {
        // silent poll retry
      }
    };

    pollServerEvents();
    const interval = setInterval(pollServerEvents, 1800);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [ingestIncomingEvents]);

  // Queue Processor: Strictly non-overlapping speech + rate limit cooldown (Task 4 & 5)
  useEffect(() => {
    if (!isAutoReplyEnabled) return;
    if (commentQueue.length === 0) return;
    if (isSpeaking || isLoading || isProcessingQueueRef.current) return;

    const now = Date.now();
    const timeSinceLastReply = now - lastReplyFinishedAtRef.current;
    const requiredCooldownMs =
      lastReplyFinishedAtRef.current === 0 ? 0 : cooldownSeconds * 1000;

    if (timeSinceLastReply < requiredCooldownMs) {
      const waitMs = requiredCooldownMs - timeSinceLastReply + 100;
      const timer = setTimeout(() => {
        // Trigger re-check after cooldown expires
        setCooldownRemaining(0);
      }, waitMs);
      return () => clearTimeout(timer);
    }

    // Pop the first comment in FIFO order and reply to it
    const nextComment = commentQueue[0];
    isProcessingQueueRef.current = true;
    setCommentQueue((prev) => prev.slice(1));
    setActiveCommentBeingAnswered(nextComment);
    setComments((prev) =>
      prev.map((c) => (c.id === nextComment.id ? { ...c, status: 'answering' } : c))
    );

    onReplyToLiveComment(nextComment.user, nextComment.text).catch(() => {
      isProcessingQueueRef.current = false;
      setActiveCommentBeingAnswered(null);
    });
  }, [
    commentQueue,
    isAutoReplyEnabled,
    isSpeaking,
    isLoading,
    cooldownSeconds,
    cooldownRemaining,
    onReplyToLiveComment,
  ]);

  // Trigger Local Test Comment(s) via Server API (Task 6)
  const sendLocalTestComments = async (
    items: Array<{ nickname: string; comment: string }>
  ) => {
    setIsSendingTest(true);
    try {
      const res = await fetch('/api/tiktok/test-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: items }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.events)) {
          ingestIncomingEvents(data.events);
        }
      }
    } finally {
      setIsSendingTest(false);
    }
  };

  // Helper to send a single test comment from the input field
  const handleSendSingleTestComment = async () => {
    const trimmed = testCommentText.trim();
    if (!trimmed || isSendingTest) return;
    const name = testViewerName.trim() || 'مشاهد تجريبي';
    setIsAutoReplyEnabled(true);
    await sendLocalTestComments([{ nickname: name, comment: trimmed }]);
    setTestCommentText('');
  };

  // Manual immediate reply to a specific comment
  const handleManualReply = (comment: LiveCommentEvent) => {
    if (isSpeaking || isLoading) return;
    setCommentQueue((prev) => prev.filter((c) => c.id !== comment.id));
    setActiveCommentBeingAnswered(comment);
    setComments((prev) =>
      prev.map((c) => (c.id === comment.id ? { ...c, status: 'answering' } : c))
    );
    isProcessingQueueRef.current = true;
    onReplyToLiveComment(comment.user, comment.text).catch(() => {
      isProcessingQueueRef.current = false;
      setActiveCommentBeingAnswered(null);
    });
  };

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleSaveTargetUsername = async () => {
    const clean = usernameInput.trim();
    if (!clean) return;
    try {
      const res = await fetch('/api/tiktok/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUsername: clean }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.targetUsername) {
          setTargetUsername(data.targetUsername);
          setUsernameInput(data.targetUsername);
        }
        setUsernameSaved(true);
        setTimeout(() => setUsernameSaved(false), 2000);
      }
    } catch {
      // ignore
    }
  };

  const cloudBridgeCode = `// cloud-bridge.mjs - جسر سحابي لاستقبال تعليقات TikTok LIVE العامة وإرسالها إلى خادم أحلام
// يعمل على Render / Railway / Fly.io / Cloud Run أو أي خادم Node.js بدون الحاجة لتطبيق سطح مكتب
// التثبيت: npm install tiktok-live-connector
import { WebcastPushConnection } from 'tiktok-live-connector';

const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || '${targetUsername.replace(/^@/, '')}';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '${webhookUrl}';
const WEBHOOK_SECRET = process.env.TIKTOK_WEBHOOK_SECRET || ''; // يُقرأ من بيئة الخادم السحابي بأمان

const tiktokLive = new WebcastPushConnection(TIKTOK_USERNAME, {
  processInitialData: false,
  enableExtendedGiftInfo: true,
});

async function forwardToAhlamServer(payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (WEBHOOK_SECRET) headers['x-webhook-secret'] = WEBHOOK_SECRET;
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error('Webhook HTTP status:', res.status);
}

tiktokLive.connect().then((state) => {
  console.log(\`Connected to TikTok LIVE roomId \${state.roomId} (@\${TIKTOK_USERNAME})\`);
}).catch((err) => {
  console.error('Failed to connect to TikTok LIVE:', err);
});

tiktokLive.on('chat', (data) => {
  forwardToAhlamServer({
    event: 'chat',
    msgId: data.msgId,
    uniqueId: data.uniqueId,
    nickname: data.nickname,
    comment: data.comment,
    profilePictureUrl: data.profilePictureUrl,
  });
});

tiktokLive.on('gift', (data) => {
  if (data.giftType === 1 && !data.repeatEnd) return;
  forwardToAhlamServer({
    event: 'gift',
    msgId: data.msgId,
    uniqueId: data.uniqueId,
    nickname: data.nickname,
    giftName: data.giftName,
  });
});`;

  const handleCopyBridgeScript = () => {
    navigator.clipboard.writeText(cloudBridgeCode);
    setCopiedBridgeScript(true);
    setTimeout(() => setCopiedBridgeScript(false), 2000);
  };

  // RENDER 1: Pure 9:16 Clean Broadcast Stage (Task 7: Separated Avatar Stage for Mobile Screen Capture)
  const renderBroadcastStage = () => (
    <div
      className={`relative w-full max-w-[390px] mx-auto aspect-[9/16] rounded-3xl overflow-hidden bg-slate-950 shadow-2xl border-2 ${
        isCleanStageMode ? 'border-transparent rounded-none max-w-md h-screen' : 'border-slate-800'
      } flex flex-col justify-between select-none`}
      onClick={() => addHeart()}
    >
      {/* 9:16 Realistic Avatar Video Stream */}
      <div className="absolute inset-0">
        <RealisticAvatar
          avatar={avatar}
          isSpeaking={isSpeaking}
          viseme={viseme}
          amplitude={amplitude}
          emotion={emotion}
          aspectRatio="full"
          showStudioBadge={false}
          className="rounded-none h-full"
        />
      </div>

      {/* Floating Hearts */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
        {hearts.map((h) => (
          <div
            key={h.id}
            className="absolute bottom-24 left-10 animate-float-heart"
            style={{ transform: `translateX(${h.x}px)`, color: h.color }}
          >
            <Heart className="w-7 h-7 fill-current drop-shadow-lg" />
          </div>
        ))}
      </div>

      {/* Exit Clean Stage Mode Floating Button (Subtle top-left corner) */}
      {isCleanStageMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsCleanStageMode(false);
          }}
          className="absolute top-3 left-3 z-50 px-2.5 py-1 rounded-full bg-black/50 hover:bg-black/80 text-white/80 text-[10px] font-bold backdrop-blur-md border border-white/15 flex items-center gap-1"
        >
          <Minimize2 className="w-3 h-3" />
          <span>إظهار لوحة التحكم</span>
        </button>
      )}

      {/* Gift Celebration Popup */}
      {activeGift && (
        <div className="absolute top-24 inset-x-4 z-40 p-3 rounded-2xl bg-gradient-to-r from-amber-500/90 via-pink-600/90 to-purple-600/90 text-white backdrop-blur-md shadow-2xl flex items-center justify-between border border-white/30">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl animate-bounce">{activeGift.icon}</span>
            <div>
              <p className="text-[11px] font-semibold text-amber-200">
                هدية من {activeGift.user}
              </p>
              <p className="text-xs font-bold">{activeGift.name}</p>
            </div>
          </div>
          <Sparkles className="w-5 h-5 text-yellow-300 animate-spin" />
        </div>
      )}

      {/* Top Stage Header (Hidden if user turns off stage overlays for 100% clean feed) */}
      {showStageOverlays ? (
        <div className="relative z-20 pt-4 px-3 bg-gradient-to-b from-black/80 via-black/30 to-transparent pb-5 pointer-events-auto">
          <div className="flex items-center justify-between gap-2">
            {/* Host Profile Pill */}
            <div className="flex items-center gap-2 p-1 pr-2.5 pl-3 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white">
              <img
                src={avatar.imageUrl}
                alt={avatar.name}
                className="w-8 h-8 rounded-full object-cover border border-emerald-400"
              />
              <div className="flex flex-col">
                <span className="font-bold text-xs">{avatar.name}</span>
                <span className="text-[10px] text-emerald-300">{targetUsername}</span>
              </div>
            </div>

            {/* Real vs Standby Connection Status Badge */}
            <div
              className={`px-2.5 py-1 rounded-full backdrop-blur-md border text-[10px] font-bold flex items-center gap-1.5 ${
                connectedToRealWebhook
                  ? 'bg-emerald-950/80 border-emerald-400/40 text-emerald-300'
                  : 'bg-amber-950/80 border-amber-400/40 text-amber-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  connectedToRealWebhook ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
                }`}
              />
              <span>{connectedToRealWebhook ? 'بث حقيقي متصل' : 'وضع الاختبار / الاستعداد'}</span>
            </div>
          </div>
        </div>
      ) : (
        <div />
      )}

      {/* Center/Lower-Middle: Active Comment Question + Ahlam's Spoken Subtitle */}
      <div className="relative z-20 px-3.5 my-auto pointer-events-none space-y-2">
        {activeCommentBeingAnswered && (
          <div className="p-2.5 rounded-2xl bg-rose-950/85 backdrop-blur-md border border-rose-400/30 text-white shadow-xl">
            <div className="flex items-center justify-between text-[10px] text-rose-300 mb-0.5">
              <span className="font-bold">💬 سؤال {activeCommentBeingAnswered.user}:</span>
              <span>
                {activeCommentBeingAnswered.source === 'tiktok-live'
                  ? 'تعليق بث حقيقي 🔴'
                  : 'تعليق اختبار 🧪'}
              </span>
            </div>
            <p className="text-xs font-bold text-white">{activeCommentBeingAnswered.text}</p>
          </div>
        )}

        {lastMessageText && (
          <div className="p-3.5 rounded-2xl bg-black/80 backdrop-blur-lg border border-emerald-500/30 text-white shadow-2xl text-center">
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-emerald-400 mb-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  isSpeaking ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
                }`}
              />
              <span>{isSpeaking ? `${avatar.name} تتحدث الآن:` : `آخر رد لـ ${avatar.name}:`}</span>
            </div>
            <p className="text-sm sm:text-base font-bold leading-relaxed text-amber-100">
              "{lastMessageText}"
            </p>
          </div>
        )}
      </div>

      {/* Bottom Stage Area: Real-Time Incoming Comments Ticker & Mobile In-Stage Input */}
      {showStageOverlays ? (
        <div
          className="relative z-20 pb-3 px-3 bg-gradient-to-t from-black/95 via-black/75 to-transparent pt-3 pointer-events-auto space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Incoming Comments Ticker */}
          <div className="max-h-28 overflow-y-auto space-y-1.5 scrollbar-none flex flex-col justify-end">
            {comments.length === 0 ? (
              <div className="px-3 py-2 rounded-xl bg-black/60 backdrop-blur-sm border border-white/10 text-[11px] text-slate-300 text-center">
                لا توجد تعليقات بعد. اكتب تعليقاً تجريبياً بالأسفل لاختبار رد «{avatar.name}» بالصوت وحركة الشفاه.
              </div>
            ) : (
              comments.slice(-5).map((c) => (
                <div
                  key={c.id}
                  className={`flex items-start gap-2 px-2.5 py-1.5 rounded-xl backdrop-blur-sm text-xs text-white border ${
                    c.source === 'tiktok-live'
                      ? 'bg-rose-950/70 border-rose-500/30'
                      : 'bg-indigo-950/70 border-indigo-500/30'
                  }`}
                >
                  <img
                    src={c.avatar}
                    alt={c.user}
                    className="w-5 h-5 rounded-full object-cover mt-0.5 shrink-0"
                  />
                  <div className="leading-snug flex-1">
                    <span className="font-bold text-amber-300 ml-1">{c.user}:</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded ml-1.5 font-bold ${
                        c.source === 'tiktok-live'
                          ? 'bg-rose-500/40 text-rose-200 border border-rose-500/50'
                          : 'bg-indigo-500/40 text-indigo-200 border border-indigo-500/50'
                      }`}
                    >
                      {c.source === 'tiktok-live' ? '🔴 بث حقيقي' : '🧪 تعليق تجريبي'}
                    </span>
                    <span className="text-slate-100">{c.text}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Quick In-Stage Test Comment Bar (Mobile-friendly direct input right on the video stage) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendSingleTestComment();
            }}
            className="flex items-center gap-1.5 pt-1"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={testCommentText}
                onChange={(e) => setTestCommentText(e.target.value)}
                placeholder={`اكتب تعليقًا تجريبيًا لـ ${avatar.name}...`}
                className="w-full py-2 px-3 pr-8 rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-white text-xs placeholder:text-slate-400 focus:outline-none focus:border-emerald-400"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none" title="وضع الاختبار التجريبي">
                🧪
              </span>
            </div>
            <button
              type="submit"
              disabled={isSendingTest || !testCommentText.trim()}
              className="p-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white font-bold transition-transform active:scale-95 shadow-lg shadow-emerald-500/30 shrink-0"
              title="إرسال التعليق التجريبي"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      ) : (
        <div className="pb-4" />
      )}
    </div>
  );

  // If in Clean 9:16 Stage Mode, show only the 9:16 stage for mobile screen capture
  if (isCleanStageMode) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        {renderBroadcastStage()}
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start select-none">
      {/* RIGHT COLUMN (in RTL): 9:16 Broadcast Stage + Primary Test Comment Card */}
      <div className="lg:col-span-5 flex flex-col items-center gap-3 w-full">
        {renderBroadcastStage()}

        {/* Stage Capture & Overlay Controls */}
        <div className="w-full max-w-[390px] p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsCleanStageMode(true)}
            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95"
            title="عرض الشخصية في وضع 9:16 صافٍ لالتقاط الشاشة في البث"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>شاشة بث صافية 9:16</span>
          </button>

          <button
            type="button"
            onClick={() => setShowStageOverlays(!showStageOverlays)}
            className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 border border-slate-700"
          >
            {showStageOverlays ? (
              <>
                <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                <span>إخفاء العناصر</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 text-emerald-400" />
                <span>إظهار العناصر</span>
              </>
            )}
          </button>

          {onRecordVideoClip && (
            <button
              type="button"
              onClick={onRecordVideoClip}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center gap-1 ${
                isRecording
                  ? 'bg-red-600 animate-pulse text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isRecording ? 'يسجل...' : 'تسجيل'}</span>
            </button>
          )}
        </div>

        {/* PRIMARY TEST COMMENT INPUT CARD (Requirement 2, 3, 4, 5, 6, 7) */}
        {/* Prominently placed directly below the avatar stage for instant mobile access */}
        <div className="w-full max-w-[390px] p-4 rounded-3xl bg-slate-900/95 border-2 border-indigo-500/50 shadow-2xl space-y-3.5">
          {/* Card Header & Badges */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-white">اكتب تعليقًا تجريبيًا</h3>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/25 text-indigo-300 border border-indigo-500/40">
                🧪 وضع الاختبار
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-snug">
              أرسل تعليقاً لاختبار رد «{avatar.name}» المباشر بالصوت العربي وحركة الشفاه.
            </p>
          </div>

          {/* Explicit Distinction Note (Requirement 5 & 6) */}
          <div className="p-2.5 rounded-2xl bg-indigo-950/60 border border-indigo-500/30 text-[11px] text-indigo-200 leading-relaxed flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-indigo-300">ملاحظة تمييزية: </span>
              <span>
                هذا تعليق تجريبي محلي يتم إرساله إلى خادم التطبيق (<code>/api/tiktok/test-comment</code>) لتجربة الرد، ويتم وسمه بـ [🧪 تعليق تجريبي] ولا يُعرض كتعليق حقيقي من تطبيق TikTok.
              </span>
            </div>
          </div>

          {/* Form with Inputs & Submit Button */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendSingleTestComment();
            }}
            className="space-y-3"
          >
            {/* Viewer Name Input */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
                <span>اسم المشاهد التجريبي:</span>
                <span className="text-[10px] text-slate-400 font-normal">(يمكنك تعديله)</span>
              </label>
              <input
                type="text"
                value={testViewerName}
                onChange={(e) => setTestViewerName(e.target.value)}
                placeholder="اسم المشاهد (مثال: عبدالله السبيعي أو نورة)"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>

            {/* Comment Text Area */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 mb-1 block">
                نص التعليق التجريبي:
              </label>
              <textarea
                rows={2}
                value={testCommentText}
                onChange={(e) => setTestCommentText(e.target.value)}
                placeholder={`اكتب سؤالك أو تعليقك التجريبي لـ ${avatar.name}...`}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-indigo-400 transition-colors resize-none"
              />
            </div>

            {/* Submit Button (Clear, prominent & mobile-touch friendly) */}
            <button
              type="submit"
              disabled={isSendingTest || !testCommentText.trim()}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-emerald-600 to-teal-600 hover:from-indigo-500 hover:to-teal-500 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 active:scale-95 transition-all cursor-pointer"
            >
              {isSendingTest ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>جاري إرسال التعليق وتشغيل الرد...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>إرسال التعليق (تجريبي) 🚀</span>
                </>
              )}
            </button>
          </form>

          {/* Quick One-Click Prompt Suggestions */}
          <div className="space-y-1.5 pt-1">
            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>اقتراحات سريعة بنقرة واحدة:</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[
                `يا ${avatar.name} وش أهم نصيحة لليوم؟`,
                `عرفينا بنفسك وبصوتك الجديد يا ${avatar.name}`,
                'أعطيني فكرة فيديو تيك توك ينتشر سريعاً',
                'ما شاء الله حركة الشفاه متقنة ومتزامنة!',
              ].map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setTestCommentText(sample)}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 text-[10px] text-slate-300 hover:text-white transition-all text-right"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          {/* Live Q&A Result & Audio Status (Requirement 4) */}
          {(activeCommentBeingAnswered || lastMessageText) && (
            <div className="mt-3 p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-slate-300 flex items-center gap-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isSpeaking ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
                    }`}
                  />
                  <span>
                    {isSpeaking
                      ? `🔊 «${avatar.name}» ترد الآن بالصوت:`
                      : `✅ آخر رد من «${avatar.name}»:`}
                  </span>
                </span>
                {isSpeaking && (
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    حركة الشفاه نشطة 👄
                  </span>
                )}
              </div>

              {activeCommentBeingAnswered && (
                <div className="p-2 rounded-xl bg-indigo-950/40 border border-indigo-500/20 text-[11px]">
                  <span className="text-indigo-300 font-bold ml-1">
                    [🧪 سؤال {activeCommentBeingAnswered.user}]:
                  </span>
                  <span className="text-slate-200">{activeCommentBeingAnswered.text}</span>
                </div>
              )}

              {lastMessageText && (
                <div className="p-2.5 rounded-xl bg-slate-900 border border-emerald-500/20 text-xs font-medium text-emerald-100 leading-relaxed">
                  "{lastMessageText}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* LEFT COLUMN (in RTL): Separated TikTok LIVE Control Panel (Tasks 3, 4, 5, 6, 9) */}
      <div className="lg:col-span-7 flex flex-col rounded-3xl bg-slate-900/95 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Control Panel Top Header: Auto-Reply Master Switch & Status */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/60 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Radio
                  className={`w-5 h-5 ${
                    connectedToRealWebhook ? 'text-emerald-400 animate-pulse' : 'text-rose-500'
                  }`}
                />
                <h2 className="text-base sm:text-lg font-black text-white">
                  لوحة تحكم بث TikTok LIVE لـ «{avatar.name}»
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                إدارة طابور التعليقات، منع التكرار، وضع الاختبار المحلي، وربط البث الحقيقي
              </p>
            </div>

            {/* Task 5: Clear Auto-Reply ON / OFF Toggle */}
            <button
              type="button"
              onClick={() => setIsAutoReplyEnabled(!isAutoReplyEnabled)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 ${
                isAutoReplyEnabled
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/20'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
            >
              {isAutoReplyEnabled ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>الردود التلقائية: مُفعّلة (إيقاف)</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>الردود التلقائية: متوقفة (تشغيل)</span>
                </>
              )}
            </button>
          </div>

          {/* DUAL MODE INDICATOR BANNER (Requirement 5 & 6) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
            {/* Mode 1: Local Test Mode */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
                <div>
                  <div className="text-xs font-bold text-indigo-200">وضع الاختبار المحلي (Test Mode)</div>
                  <div className="text-[10px] text-indigo-300/80">متاح وجاهز للتجربة عبر الخادم</div>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 font-bold">
                نشط 🧪
              </span>
            </div>

            {/* Mode 2: Real TikTok LIVE Webhook */}
            <div
              className={`flex items-center justify-between p-2.5 rounded-xl border ${
                connectedToRealWebhook
                  ? 'bg-emerald-950/40 border-emerald-500/40'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    connectedToRealWebhook ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
                  }`}
                />
                <div>
                  <div className="text-xs font-bold text-white">بث TikTok LIVE الحقيقي</div>
                  <div className="text-[10px] text-slate-400">
                    {connectedToRealWebhook
                      ? 'متصل بالويب هوك العام 🔴'
                      : 'غير متصل (استخدم وضع الاختبار)'}
                  </div>
                </div>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  connectedToRealWebhook
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {connectedToRealWebhook ? 'متصل 🟢' : 'استعداد ⚪'}
              </span>
            </div>
          </div>

          {/* Live Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
              <div className="text-[11px] text-slate-400">في الطابور حالياً</div>
              <div className="text-base font-black text-amber-400">{commentQueue.length}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
              <div className="text-[11px] text-slate-400">تم الرد عليها</div>
              <div className="text-base font-black text-emerald-400">{answeredCount}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
              <div className="text-[11px] text-slate-400">مكرر تم منعه</div>
              <div className="text-base font-black text-rose-400">
                {skippedDuplicatesCount + serverSkippedDuplicates}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
              <div className="text-[11px] text-slate-400">حالة النطق والفاصل</div>
              <div className="text-xs font-bold text-indigo-300 mt-1">
                {isSpeaking || isLoading
                  ? '🔊 تتحدث الآن...'
                  : cooldownRemaining > 0
                  ? `⏳ فاصل (${cooldownRemaining}ث)`
                  : '✅ جاهزة للرد'}
              </div>
            </div>
          </div>
        </div>

        {/* Control Panel Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 overflow-x-auto scrollbar-none">
          {[
            { id: 'test', label: '🧪 وضع الاختبار المحلي', icon: FlaskConical },
            { id: 'queue', label: `📋 الطابور والتعليقات (${commentQueue.length})`, icon: ListOrdered },
            { id: 'connect', label: '🔗 ربط بث TikTok الحقيقي', icon: Link2 },
            { id: 'mobile', label: '📱 دليل البث من الجوال', icon: Smartphone },
          ].map((t) => {
            const Icon = t.icon;
            const active = controlTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setControlTab(t.id as any)}
                className={`flex-1 py-3 px-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-all whitespace-nowrap ${
                  active
                    ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Control Panel Body */}
        <div className="p-4 sm:p-5 space-y-4 max-h-[520px] overflow-y-auto">
          {/* SUB-TAB 1: LOCAL TEST MODE (Task 6) */}
          {controlTab === 'test' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-200 leading-relaxed">
                <strong className="text-white block mb-1">
                  🧪 اختبار دورة (التعليق ← الطابور ← الذكاء الاصطناعي ← الصوت ← حركة الشفاه):
                </strong>
                يرسل هذا الوضع تعليقاً تجريبياً إلى الخادم المحلي (`/api/tiktok/test-comment`) ليختبر استجابة «{avatar.name}» بالصوت وحركة الشفاه دون الحاجة لفتح بث حقيقي.
              </div>

              {/* Custom Test Comment Form */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 mb-1 block">
                      اسم المشاهد التجريبي:
                    </label>
                    <input
                      type="text"
                      value={testViewerName}
                      onChange={(e) => setTestViewerName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-bold text-slate-400 mb-1 block">
                      نص التعليق التجريبي:
                    </label>
                    <input
                      type="text"
                      value={testCommentText}
                      onChange={(e) => setTestCommentText(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSendingTest || !testCommentText.trim()}
                  onClick={() =>
                    sendLocalTestComments([
                      {
                        nickname: testViewerName || 'مشاهد تجريبي',
                        comment: testCommentText.trim(),
                      },
                    ])
                  }
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>إرسال التعليق التجريبي واختبار رد «{avatar.name}» صوتياً</span>
                </button>
              </div>

              {/* Automated Verification Scenarios (Queue + Deduplication + Rate Limit) */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 block">
                  سيناريوهات تحقق جاهزة بنقرة واحدة:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      sendLocalTestComments([
                        {
                          nickname: 'سلمان العتيبي',
                          comment: 'مساء الخير يا أحلام! نورتي البث اليوم',
                        },
                        {
                          nickname: 'سلمان العتيبي',
                          comment: 'مساء الخير يا أحلام! نورتي البث اليوم',
                        },
                      ])
                    }
                    className="p-3 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-rose-500/40 text-right transition-all"
                  >
                    <div className="text-xs font-bold text-rose-400 mb-1">
                      🛡️ اختبار منع التكرار (Deduplication)
                    </div>
                    <p className="text-[11px] text-slate-400">
                      يرسل نفس التعليق مرتين متتاليتين للتأكد من الرد مرة واحدة فقط وتجاهل المكرر.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      sendLocalTestComments([
                        {
                          nickname: 'نورة القحطاني',
                          comment: 'أهلاً يا أحلام كيف حالك؟',
                        },
                        {
                          nickname: 'فهد الشمري',
                          comment: 'عطينا نصيحة سريعة للنجاح',
                        },
                        {
                          nickname: 'ريم الدوسري',
                          comment: 'ما شاء الله صوتك واضح جداً!',
                        },
                      ])
                    }
                    className="p-3 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-right transition-all"
                  >
                    <div className="text-xs font-bold text-amber-400 mb-1">
                      📋 اختبار الطابور وعدم التداخل (3 تعليقات)
                    </div>
                    <p className="text-[11px] text-slate-400">
                      يرسل 3 تعليقات دفعة واحدة لترتيبها في الطابور والرد عليها بالتتابع دون تداخل صوتي.
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SUB-TAB 2: QUEUE & RATE LIMIT SETTINGS (Task 5) */}
          {controlTab === 'queue' && (
            <div className="space-y-4">
              {/* Rate Limit Cooldown Selector */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-white">
                      الحد الزمني بين الردود التلقائية (Rate Limit):
                    </div>
                    <div className="text-[11px] text-slate-400">
                      تنتظر «{avatar.name}» انتهاء الصوت الحالي ثم تنتظر هذا الفاصل قبل الرد التالي
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {[3, 5, 10, 15].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setCooldownSeconds(sec)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        cooldownSeconds === sec
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {sec} ثوانٍ
                    </button>
                  ))}
                </div>
              </div>

              {/* Queue Header & Clear Button */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">
                  طابور الانتظار الحالي ({commentQueue.length} تعليق):
                </span>
                {commentQueue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCommentQueue([])}
                    className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[11px] font-bold flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>تفريغ الطابور</span>
                  </button>
                )}
              </div>

              {/* Recent & Queued Comments List */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {comments.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400">
                    لا توجد تعليقات واردة بعد. استخدم «وضع الاختبار المحلي» أو اربط البث المباشر.
                  </div>
                ) : (
                  [...comments].reverse().map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5 text-right">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-amber-300">{item.user}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              item.source === 'tiktok-live'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-indigo-500/20 text-indigo-300'
                            }`}
                          >
                            {item.source === 'tiktok-live' ? 'بث حقيقي' : 'اختبار محلي'}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              item.status === 'answering'
                                ? 'bg-emerald-500/30 text-emerald-300 animate-pulse'
                                : item.status === 'answered'
                                ? 'bg-slate-800 text-emerald-400'
                                : item.status === 'skipped-duplicate'
                                ? 'bg-rose-950 text-rose-400'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {item.status === 'answering'
                              ? '🔊 يتم الرد الآن'
                              : item.status === 'answered'
                              ? '✅ تم الرد'
                              : item.status === 'skipped-duplicate'
                              ? '🚫 مكرر (تم تخطيه)'
                              : '⏳ في الطابور'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-200">{item.text}</p>
                      </div>

                      {item.status !== 'answered' && item.status !== 'answering' && (
                        <button
                          type="button"
                          disabled={isSpeaking || isLoading}
                          onClick={() => handleManualReply(item)}
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white text-[11px] font-bold shrink-0 disabled:opacity-40"
                        >
                          رد الآن
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* SUB-TAB 3: REAL TIKTOK LIVE CONNECTOR SETUP (Task 2 & 3) */}
          {controlTab === 'connect' && (
            <div className="space-y-4 text-xs leading-relaxed">
              {/* Critical Technical Notice about TikFinity Mobile */}
              <div className="p-3.5 rounded-2xl bg-amber-950/60 border border-amber-500/40 text-amber-100 space-y-1.5">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>حقيقة تقنية مهمة لمستخدمي تطبيق TikFinity Mobile على الهاتف:</span>
                </div>
                <p className="text-[11px] text-amber-100/90">
                  تطبيق <strong>TikFinity Mobile</strong> على الهاتف (Android / iOS) مصمم لتشغيل التنبيهات الصوتية المحلية (Sound Alerts & Local TTS) على الجوال فقط، و<strong>لا يدعم</strong> إرسال طلبات Webhook خارجية ولا يحتوي على واجهة Event API / WebSocket (حيث تقتصر ميزة Webhook وWebSocket `ws://localhost:21213` على نسخة TikFinity Desktop للكمبيوتر أو لوحة الويب الكاملة).
                </p>
                <p className="text-[11px] text-emerald-300 font-bold">
                  ✅ الحل العملي بدون كمبيوتر: استخدام «الجسر السحابي (Cloud Bridge)» الجاهز بالأسفل أو خدمة EulerStream Webcast Webhook لالتقاط تعليقات بثك العام وإرسالها مباشرة إلى خادم «{avatar.name}».
                </p>
              </div>

              {/* Target TikTok Account Username Config */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="text-xs font-bold text-slate-300 block">
                  معرف حساب TikTok LIVE المستهدف (@username):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    placeholder="@ahlam.live"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs dir-ltr text-left focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveTargetUsername}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shrink-0"
                  >
                    {usernameSaved ? '✓ تم الحفظ' : 'حفظ الحساب'}
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    <span>نقطة استقبال تعليقات البث الحقيقي (Webhook Endpoint):</span>
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      webhookSecretConfigured
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {webhookSecretConfigured
                      ? '🔒 محمي بـ TIKTOK_WEBHOOK_SECRET (في الخادم فقط)'
                      : 'مفتوح للاستقبال (أضف TIKTOK_WEBHOOK_SECRET للحماية)'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-emerald-300 font-mono text-[11px] overflow-x-auto dir-ltr text-left">
                    POST {webhookUrl}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 shrink-0"
                  >
                    {copiedWebhook ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>تم النسخ</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>نسخ الرابط</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Ready-to-Deploy Cloud Bridge Code */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2 text-slate-300">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-white">
                      ☁️ البديل السحابي الجاهز (Cloud Bridge - بدون كمبيوتر):
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyBridgeScript}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1"
                    >
                      {copiedBridgeScript ? (
                        <>
                          <Check className="w-3 h-3" />
                          <span>تم نسخ الكود السحابي</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>نسخ كود Cloud Bridge</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    يعتمد هذا الجسر السحابي على مكتبة <code>tiktok-live-connector</code> (نفس المحرك الذي يعتمد عليه TikFinity)، ويمكن استضافته مجاناً على Render أو Railway أو Cloud Run ليتصل ببثك العام (<code>{targetUsername}</code>) فور بدء البث من جوالك ويرسل التعليقات والهدايا بأمان إلى <code>POST /api/tiktok/webhook</code>:
                  </p>
                  <pre className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[10px] text-emerald-200 font-mono dir-ltr text-left overflow-x-auto max-h-40">
                    {cloudBridgeCode}
                  </pre>

                  <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 space-y-1">
                    <div className="font-bold text-amber-300">
                      🔒 الحماية، منع التكرار، وحدود الطلبات المطبقة في الخادم:
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                      <li>
                        <strong>المصادقة:</strong> التحقق الآمن عبر <code>x-webhook-secret</code> أو <code>Authorization: Bearer</code> أو توقيع HMAC-SHA256 (<code>x-webhook-signature</code>) دون كشف أي سر في المتصفح.
                      </li>
                      <li>
                        <strong>منع التكرار (Server + Client):</strong> فلترة مزدوجة بمعرف الرسالة <code>msgId</code> وبصمة النص لنفس المستخدم خلال 120 ثانية.
                      </li>
                      <li>
                        <strong>حدود الطلبات (Rate Limiting):</strong> بحد أقصى 60 طلباً/دقيقة لكل عنوان، و20 حدثاً لكل دفعة، بالإضافة إلى طابور صوتي متسلسل بفاصل زمني قابل للضبط.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SUB-TAB 4: MOBILE BROADCASTING GUIDE & CONSTRAINTS (Task 9) */}
          {controlTab === 'mobile' && (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 text-xs text-slate-300 leading-relaxed">
              <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span>تقرير شامل: ما يمكن إنجازه من الجوال وحده مقابل ما يحتاج خدمة سحابية أو كمبيوتر</span>
              </h4>

              <div className="space-y-2.5 pt-1">
                <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30">
                  <div className="font-bold text-emerald-400 mb-1">
                    ✅ أولاً: ما يعمل من الجوال وحده (100% بدون كمبيوتر وبدون خدمات خارجية):
                  </div>
                  <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-1">
                    <li>
                      تشغيل شخصية <strong>«{avatar.name}»</strong> أو رفع صورتك/فيديوهك الحقيقي مع التحدث الصوتي الفوري ومزامنة الشفاه (60FPS Canvas Lip-Sync).
                    </li>
                    <li>
                      تفعيل وضع <strong>«شاشة بث صافية 9:16»</strong> وبثها مباشرة لجمهور TikTok عبر ميزة <strong>مشاركة الشاشة / ألعاب الجوال (Screen Share)</strong> في تطبيق TikTok الرسمي أو تطبيق <strong>PRISM Live Studio</strong> على الهاتف.
                    </li>
                    <li>
                      اختبار دورة البث الكاملة (التعليق ← الطابور ← الذكاء الاصطناعي ← الصوت ← حركة الشفاه) عبر <strong>وضع الاختبار المحلي</strong> أو إدخال الأسئلة يدوياً/صوتياً.
                    </li>
                  </ul>
                </div>

                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30">
                  <div className="font-bold text-amber-400 mb-1">
                    ☁️ ثانياً: ما يحتاج إلى خدمة سحابية خارجية (أو كمبيوتر) لقراءة تعليقات الجمهور تلقائياً:
                  </div>
                  <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-1">
                    <li>
                      <strong>السبب التقني:</strong> تطبيق <strong>TikFinity Mobile</strong> على الهاتف يشغل أصوات التنبيهات محلياً فقط ولا يرسل Webhooks إلى خوادم خارجية، كما أن متصفح الهاتف لا يمكنه سحب تعليقات TikTok LIVE مباشرة بسبب قيود TikTok CORS/Protobuf.
                    </li>
                    <li>
                      <strong>الحل بدون كمبيوتر (باستضافة سحابية):</strong> نشر سكريبت <strong>Cloud Bridge</strong> الموجود في تبويب «ربط بث TikTok الحقيقي» على خدمة سحابية (مثل Render أو Railway أو Cloud Run)، أو استخدام خدمة <strong>EulerStream Webcast Webhook</strong> لالتقاط تعليقات البث العام لحسابك وإرسالها تلقائياً إلى <code>POST /api/tiktok/webhook</code>.
                    </li>
                    <li>
                      <strong>الحل باستخدام كمبيوتر (اختياري):</strong> تشغيل <strong>TikFinity Desktop</strong> على الكمبيوتر وتفعيل <code>Actions & Events → Webhook</code> إلى رابط الويب هوك.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
