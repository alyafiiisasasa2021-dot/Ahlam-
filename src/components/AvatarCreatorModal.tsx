import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Sparkles,
  Wand2,
  Check,
  Upload,
  Film,
  Camera,
  Volume2,
} from 'lucide-react';
import type { AvatarProfile } from '../data/avatars';

interface AvatarCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAvatar: (newAvatar: AvatarProfile) => void;
  initialAvatar?: AvatarProfile | null;
}

export const VOICE_PRESETS: Array<{
  id: 'Fenrir' | 'Zephyr' | 'Charon' | 'Puck' | 'Kore';
  label: string;
  desc: string;
  gender: 'male' | 'female';
  defaultPitch: number;
  defaultRate: number;
}> = [
  {
    id: 'Fenrir',
    label: 'صوت قيس (رجالي عميق وواثق)',
    desc: 'نبرة رخيمة وطبيعية مناسبة للمحادثات الشخصية',
    gender: 'male',
    defaultPitch: 0.94,
    defaultRate: 1.0,
  },
  {
    id: 'Zephyr',
    label: 'صوت شبابي حيوي (تيك توك)',
    desc: 'نبرة سريعة وعفوية لصناع المحتوى والرياديين',
    gender: 'male',
    defaultPitch: 1.0,
    defaultRate: 1.05,
  },
  {
    id: 'Charon',
    label: 'صوت رسمي وإعلامي رزين',
    desc: 'نبرة هادئة وفصيحة للبرامج والتقارير',
    gender: 'male',
    defaultPitch: 0.88,
    defaultRate: 0.95,
  },
  {
    id: 'Puck',
    label: 'صوت حماسي ورياضي',
    desc: 'طاقة عالية ونبرة مشجعة وقوية',
    gender: 'male',
    defaultPitch: 0.92,
    defaultRate: 1.08,
  },
  {
    id: 'Kore',
    label: 'صوت نسائي دافئ وواضح',
    desc: 'نبرة أنيقة ومريحة للمحاورة وتقديم المحتوى',
    gender: 'female',
    defaultPitch: 1.06,
    defaultRate: 0.98,
  },
];

export const AvatarCreatorModal: React.FC<AvatarCreatorModalProps> = ({
  isOpen,
  onClose,
  onSaveAvatar,
  initialAvatar = null,
}) => {
  const [name, setName] = useState('قيس');
  const [role, setRole] = useState('نسختي الرقمية الناطقة بالذكاء الاصطناعي');
  const [dialect, setDialect] = useState<'خليجي / سعودي' | 'مصري' | 'شامي' | 'فصحى معاصرة'>('خليجي / سعودي');
  const [gender, setGender] = useState<'female' | 'male'>('male');
  const [tone, setTone] = useState('طبيعي، ذكي، واثق وعفوي');
  const [voiceName, setVoiceName] = useState<'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir'>('Fenrir');
  const [speechPitch, setSpeechPitch] = useState(0.95);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [imageUrl, setImageUrl] = useState('https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1200&q=80');
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [prompt, setPrompt] = useState('شخصية عربية في استوديو بث حديث، إضاءة سينمائية');
  const [isGeneratingFace, setIsGeneratingFace] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (initialAvatar) {
      setName(initialAvatar.name);
      setRole(initialAvatar.role);
      setDialect(initialAvatar.dialect);
      setGender(initialAvatar.gender);
      setTone(initialAvatar.tone);
      setVoiceName(initialAvatar.voiceName);
      setSpeechPitch(initialAvatar.speechPitch);
      setSpeechRate(initialAvatar.speechRate);
      setImageUrl(initialAvatar.imageUrl);
      setVideoUrl(initialAvatar.videoUrl);
      setMediaType(initialAvatar.mediaType || 'image');
    }
  }, [initialAvatar, isOpen]);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('video/')) {
      const objUrl = URL.createObjectURL(file);
      setVideoUrl(objUrl);
      setMediaType('video');
      // Also capture a poster frame from the video so thumbnails look great
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = objUrl;
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
            setImageUrl(canvas.toDataURL('image/jpeg', 0.85));
          }
        } catch {
          // ignore poster extraction error
        }
      };
      tempVideo.load();
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setImageUrl(reader.result);
          setVideoUrl(undefined);
          setMediaType('image');
        }
      };
      reader.onerror = () => {
        setUploadError('تعذر قراءة ملف الصورة، يرجى اختيار صورة بصيغة JPG أو PNG.');
      };
      reader.readAsDataURL(file);
    } else {
      setUploadError('يرجى اختيار ملف صورة (JPG, PNG, WEBP) أو ملف فيديو (MP4, WEBM, MOV).');
    }
    e.target.value = '';
  };

  const handleGenerateFace = async () => {
    setIsGeneratingFace(true);
    setUploadError(null);
    try {
      const res = await fetch('/api/avatar-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${prompt}, ${
            gender === 'female'
              ? 'Arabic woman presenter looking directly at camera'
              : 'Arabic man presenter looking directly at camera'
          }`,
          style: 'hyperrealistic 8k studio photography, cinematic lighting',
        }),
      });
      const data = await res.json();
      if (data.imageUrl) {
        setImageUrl(data.imageUrl);
        setVideoUrl(undefined);
        setMediaType('image');
        if (data.notice) {
          setUploadError(data.notice);
        }
      } else {
        setUploadError(data.error || 'تعذر توليد صورة بالذكاء الاصطناعي حالياً، يمكنك رفع صورتك مباشرة.');
      }
    } catch {
      setUploadError('تعذر الاتصال بخدمة توليد الصور، يمكنك رفع صورتك أو فيديوهك مباشرة من جهازك.');
    } finally {
      setIsGeneratingFace(false);
    }
  };

  const handleSave = () => {
    const finalName = name.trim() || 'قيس';
    const newAvatar: AvatarProfile = {
      id: initialAvatar?.id || `custom-${Date.now()}`,
      name: finalName,
      title: mediaType === 'video' ? 'شخصية فيديو حقيقية ناطقة' : 'شخصية حقيقية ناطقة بالذكاء الاصطناعي',
      role,
      dialect,
      dialectCode:
        dialect === 'مصري'
          ? 'ar-EG'
          : dialect === 'شامي'
          ? 'ar-SY'
          : dialect === 'فصحى معاصرة'
          ? 'ar'
          : 'ar-SA',
      tone,
      gender,
      voiceName,
      speechPitch,
      speechRate,
      imageUrl,
      videoUrl,
      mediaType,
      isUserFace: true,
      mouthConfig: initialAvatar?.mouthConfig || {
        x: 50,
        y: 53,
        scale: 1,
        mode: 'natural-warp',
      },
      bgUrl:
        initialAvatar?.bgUrl ||
        'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=1600&q=80',
      category: 'social',
      socialHandle: `@${finalName.replace(/\s+/g, '')}`,
      verified: true,
      welcomeMessage: `أهلاً بك! أنا ${finalName}. أحتفظ بملامح وجهي الحقيقية وأرد على أي حديث بصوتي الجديد المتزامن مع حركة الشفاه!`,
      bio: 'شخصية ناطقة بالذكاء الاصطناعي تحتفظ بملامح الوجه الحقيقية وتستجيب للمحادثات الصوتية والنصية.',
      tags: ['وجه حقيقي', 'صوت جديد', 'تيك توك', 'واتساب'],
    };

    onSaveAvatar(newAvatar);
    onClose();
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in select-none"
    >
      <div className="relative w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col text-right">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-bold text-white text-base">
                {initialAvatar ? `تعديل بيانات وصورة ${initialAvatar.name}` : 'إعداد شخصيتك الحقيقية وصوتها الجديد'}
              </h3>
              <p className="text-xs text-slate-400">
                ارفع صورتك أو فيديوهك الحقيقي واختر الصوت الجديد واللهجة المناسبة
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">
          {/* 1. Real Face Upload (Photo or Video) */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/30 space-y-3">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* Preview Box */}
              <div className="relative w-28 h-36 rounded-2xl overflow-hidden border-2 border-emerald-500 shadow-lg shrink-0 bg-slate-900">
                {mediaType === 'video' && videoUrl ? (
                  <video
                    src={videoUrl}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img src={imageUrl} alt="معاينة الوجه" className="w-full h-full object-cover" />
                )}
                <span className="absolute bottom-1 inset-x-1 px-1.5 py-0.5 rounded bg-black/75 text-[10px] text-emerald-300 font-bold text-center">
                  {mediaType === 'video' ? '🎬 فيديو حقيقي' : '📸 صورة حقيقية'}
                </span>
              </div>

              {/* Upload Controls */}
              <div className="flex-1 space-y-2.5 w-full">
                <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-emerald-400" />
                  <span>الاحتفاظ بوجهك الحقيقي (صورة أو فيديو)</span>
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  ارفع صورة واضحة لوجهك أو مقطع فيديو قصير لك، وسيتم الاحتفاظ بملامحك الحقيقية وتحريك الشفاه مع الصوت الجديد.
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                  >
                    <Upload className="w-4 h-4" />
                    <span>رفع صورة أو فيديو من جهازك</span>
                  </button>
                </div>

                {uploadError && (
                  <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                    {uploadError}
                  </p>
                )}
              </div>
            </div>

            {/* Optional AI Face Generator Collapsible */}
            <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-center gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="أو اكتب وصفاً لتوليد وجه افتراضي بالذكاء الاصطناعي..."
                className="flex-1 w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={handleGenerateFace}
                disabled={isGeneratingFace}
                className="w-full sm:w-auto px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 whitespace-nowrap"
              >
                <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isGeneratingFace ? 'جاري التوليد...' : 'توليد وجه بالذكاء الاصطناعي'}</span>
              </button>
            </div>
          </div>

          {/* 2. Name & Role */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-300 mb-1 block">اسم الشخصية:</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: قيس"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300 mb-1 block">الدور أو الوصف:</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="مثال: متحدث شخصي وصانع محتوى"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* 3. New Voice Selection & Pitch/Rate Controls */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
            <label className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <Volume2 className="w-4 h-4" />
              <span>اختر الصوت الجديد الذي ستتحدث به الشخصية:</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {VOICE_PRESETS.map((vp) => {
                const isSelected = voiceName === vp.id;
                return (
                  <button
                    key={vp.id}
                    type="button"
                    onClick={() => {
                      setVoiceName(vp.id);
                      setGender(vp.gender);
                      setSpeechPitch(vp.defaultPitch);
                      setSpeechRate(vp.defaultRate);
                    }}
                    className={`p-2.5 rounded-xl border text-right transition-all ${
                      isSelected
                        ? 'bg-emerald-500/20 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold">{vp.label}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{vp.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Fine-tune Pitch & Speed */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
              <div>
                <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                  <span>طبقة الصوت (عميق ↔ حاد):</span>
                  <span className="font-bold text-emerald-400">{speechPitch.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.65"
                  max="1.35"
                  step="0.05"
                  value={speechPitch}
                  onChange={(e) => setSpeechPitch(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                  <span>سرعة التحدث:</span>
                  <span className="font-bold text-emerald-400">{speechRate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.75"
                  max="1.3"
                  step="0.05"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* 4. Dialect Selection */}
          <div>
            <label className="text-xs font-bold text-slate-300 mb-1.5 block">اللهجة المعتمدة في الردود:</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['خليجي / سعودي', 'مصري', 'شامي', 'فصحى معاصرة'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDialect(d)}
                  className={`py-2 px-2 rounded-xl text-xs font-bold transition-all ${
                    dialect === d
                      ? 'bg-emerald-500 text-white shadow-md'
                      : 'bg-slate-950 text-slate-400 border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-950">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 transition-all"
          >
            <Check className="w-4 h-4" />
            <span>حفظ واعتماد الوجه والصوت</span>
          </button>
        </div>
      </div>
    </div>
  );
};
