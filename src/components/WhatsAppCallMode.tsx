import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  MessageCircle,
  Share2,
  Volume2,
  VolumeX,
  Camera,
  RefreshCw,
  Send,
  Sparkles,
  Download,
} from 'lucide-react';
import type { AvatarProfile, VisemeType } from '../data/avatars';
import { RealisticAvatar } from './RealisticAvatar';

interface WhatsAppCallModeProps {
  avatar: AvatarProfile;
  isSpeaking: boolean;
  viseme: VisemeType;
  amplitude: number;
  emotion: any;
  onSendMessage: (msg: string) => void;
  onEndCall: () => void;
  lastMessageText?: string;
  onRecordVideoClip?: () => void;
  isRecording?: boolean;
}

export const WhatsAppCallMode: React.FC<WhatsAppCallModeProps> = ({
  avatar,
  isSpeaking,
  viseme,
  amplitude,
  emotion,
  onSendMessage,
  onEndCall,
  lastMessageText,
  onRecordVideoClip,
  isRecording = false,
}) => {
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [showChatDrawer, setShowChatDrawer] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [userWebcamActive, setUserWebcamActive] = useState(false);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);

  // Call duration counter
  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Toggle user camera PiP
  const toggleUserCamera = async () => {
    if (userWebcamActive) {
      if (userVideoRef.current && userVideoRef.current.srcObject) {
        const stream = userVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        userVideoRef.current.srcObject = null;
      }
      setUserWebcamActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (userVideoRef.current) {
          userVideoRef.current.srcObject = stream;
        }
        setUserWebcamActive(true);
      } catch (err) {
        console.warn('Camera access denied or unavailable', err);
        setUserWebcamActive(false);
      }
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendMessage(chatInput.trim());
    setChatInput('');
  };

  const shareToWhatsApp = () => {
    const text = encodeURIComponent(
      `مرحباً! أتحدث الآن في مكالمة فيديو مباشرة مع ${avatar.name} (${avatar.role}). جرب التحدث مع الشخصية الافتراضية الذكية الآن!`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="relative w-full max-w-md mx-auto aspect-[9/16] rounded-3xl overflow-hidden bg-slate-950 shadow-2xl border-4 border-slate-800/80 flex flex-col justify-between select-none">
      {/* Background Avatar Video Stream */}
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

      {/* Top Header: WhatsApp Call Info */}
      <div className="relative z-20 pt-6 px-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-8">
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={avatar.imageUrl}
                alt={avatar.name}
                className="w-12 h-12 rounded-full object-cover border-2 border-emerald-500 shadow-md"
              />
              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-black rounded-full" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 font-bold text-lg text-white">
                <span>{avatar.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  واتساب
                </span>
              </div>
              <p className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                مكالمة فيديو • {formatTime(callDuration)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={shareToWhatsApp}
              title="مشاركة على واتساب"
              className="p-2.5 rounded-full bg-emerald-600/80 hover:bg-emerald-500 text-white backdrop-blur-md transition-transform active:scale-95 shadow-md flex items-center gap-1 text-xs"
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">مشاركة</span>
            </button>
          </div>
        </div>

        {/* WhatsApp End-to-End Encryption Banner */}
        <div className="mt-3 py-1 px-3 rounded-lg bg-black/40 backdrop-blur-sm border border-white/5 text-center">
          <p className="text-[10px] text-slate-300 flex items-center justify-center gap-1">
            🔒 مكالمة فيديو ذكية مشفرة تماماً • تفاعل صوتي ومصوّر فوري
          </p>
        </div>
      </div>

      {/* Center Subtitles & Speech Bubble (WhatsApp Message Style) */}
      <div className="relative z-20 px-4 my-auto pointer-events-none">
        {lastMessageText && (
          <div className="max-w-[85%] mr-auto rounded-2xl rounded-tr-none bg-emerald-900/85 backdrop-blur-md p-3.5 border border-emerald-500/30 text-white shadow-xl pointer-events-auto transition-all animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between text-[11px] text-emerald-300/80 mb-1">
              <span className="font-semibold">{avatar.name}</span>
              <span>الآن</span>
            </div>
            <p className="text-sm font-medium leading-relaxed">{lastMessageText}</p>
          </div>
        )}
      </div>

      {/* Picture-in-Picture User Camera */}
      <div className="absolute top-28 left-4 z-20 w-24 h-32 rounded-2xl overflow-hidden bg-slate-800/90 border-2 border-white/20 shadow-xl backdrop-blur-md">
        <video
          ref={userVideoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${userWebcamActive ? 'block' : 'hidden'}`}
        />
        {!userWebcamActive && (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-2 text-slate-300">
            <Camera className="w-6 h-6 text-slate-400 mb-1" />
            <span className="text-[10px] font-medium leading-tight">كاميرتك</span>
          </div>
        )}
        <button
          onClick={toggleUserCamera}
          className="absolute bottom-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-black text-[10px]"
          title="تشغيل/إيقاف الكاميرا"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Bottom WhatsApp Floating Action Bar */}
      <div className="relative z-20 pb-6 px-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-6">
        {/* Quick Suggestions when idle */}
        <div className="flex items-center gap-2 overflow-x-auto pb-3 scrollbar-none">
          {['كيف حالك اليوم؟', 'عطني نصيحة سريعة', 'سولف معي باللهجة السعودية', 'سوي لي فيديو للتيك توك'].map(
            (suggestion, i) => (
              <button
                key={i}
                onClick={() => onSendMessage(suggestion)}
                className="whitespace-nowrap px-3 py-1 rounded-full bg-white/10 hover:bg-emerald-500/30 text-white text-xs border border-white/10 transition-all active:scale-95 flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-emerald-400" />
                <span>{suggestion}</span>
              </button>
            )
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-around gap-2 pt-2">
          {/* Mute Button */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-3.5 rounded-full transition-transform active:scale-95 ${
              isMuted ? 'bg-red-500/80 text-white' : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
            title={isMuted ? 'إلغاء كتم الصوت' : 'كتم الصوت'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Video Toggle */}
          <button
            onClick={() => setIsVideoOn(!isVideoOn)}
            className={`p-3.5 rounded-full transition-transform active:scale-95 ${
              !isVideoOn ? 'bg-red-500/80 text-white' : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
            title="تبديل الكاميرا"
          >
            {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          {/* Record Video Clip */}
          {onRecordVideoClip && (
            <button
              onClick={onRecordVideoClip}
              className={`p-3.5 rounded-full transition-transform active:scale-95 ${
                isRecording
                  ? 'bg-red-600 animate-pulse text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30'
              }`}
              title="تسجيل رسالة فيديو واتساب"
            >
              <Download className="w-5 h-5" />
            </button>
          )}

          {/* Chat Drawer Toggle */}
          <button
            onClick={() => setShowChatDrawer(!showChatDrawer)}
            className={`p-3.5 rounded-full transition-transform active:scale-95 ${
              showChatDrawer ? 'bg-emerald-600 text-white' : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
            title="الدردشة النصية"
          >
            <MessageCircle className="w-5 h-5" />
          </button>

          {/* End Call Button */}
          <button
            onClick={onEndCall}
            className="p-3.5 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/40 transition-transform active:scale-95"
            title="إنهاء المكالمة"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>

        {/* Expandable Chat Input in Call */}
        {showChatDrawer && (
          <form onSubmit={handleSend} className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="اكتب رسالتك لترد عليك بالفيديو..."
              className="flex-1 px-4 py-2.5 rounded-full bg-slate-900/90 border border-slate-700 text-white text-xs placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="p-2.5 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 transition-transform active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
