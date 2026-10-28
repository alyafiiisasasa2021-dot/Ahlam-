import React, { useState } from 'react';
import {
  Sparkles,
  Play,
  Download,
  Share2,
  Copy,
  Check,
  Video,
  Clock,
  Layers,
  Wand2,
  MessageSquare,
} from 'lucide-react';
import type { AvatarProfile } from '../data/avatars';

interface ScriptResult {
  title: string;
  hook: string;
  fullScript: string;
  callToAction: string;
  subtitles?: Array<{ time: string; text: string }>;
  caption?: string;
  hashtags?: string[];
}

interface ScriptStudioModeProps {
  avatar: AvatarProfile;
  onDeliverScript: (text: string) => void;
  onRecordScriptVideo: (text: string) => void;
  isRecording?: boolean;
}

const TEMPLATE_PROMPTS = [
  { label: '🔥 تريند تيك توك: 3 أسرار للنجاح', topic: '3 أسرار حقيقية للنجاح والانضباط ما أحد يقولها لك في السوشيال ميديا', platform: 'tiktok', duration: 30 },
  { label: '💚 تهنئة خاصة للواتساب', topic: 'تهنئة دافئة ومميزة لصديق أو قريب بمناسبة إنجاز كبير مع دعاء وتمنيات بالتوفيق', platform: 'whatsapp', duration: 20 },
  { label: '💡 معلومة تقنية مذهلة', topic: 'كيف سيغير الذكاء الاصطناعي وظائف المستقبل خلال السنة القادمة بطريقة مبسطة', platform: 'tiktok', duration: 45 },
  { label: '⚡ نصيحة صحية وطاقة إيجابية', topic: 'عادة بسيطة مدتها 5 دقائق في الصباح كفيلة تغير طاقتك ومزاجك طوال اليوم', platform: 'whatsapp', duration: 25 },
];

export const ScriptStudioMode: React.FC<ScriptStudioModeProps> = ({
  avatar,
  onDeliverScript,
  onRecordScriptVideo,
  isRecording = false,
}) => {
  const [topic, setTopic] = useState('3 أسرار لتطوير مهاراتك والتميز في عملك');
  const [platform, setPlatform] = useState<'tiktok' | 'whatsapp' | 'reels'>('tiktok');
  const [duration, setDuration] = useState<number>(30);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scriptData, setScriptData] = useState<ScriptResult | null>({
    title: '3 أسرار لتبدأ يومك بقمة الإنجاز',
    hook: 'تخيل تصحى كل يوم وعندك طاقة تخلص كل مهامك قبل الظهر! السر مو في القهوة...',
    fullScript: 'يا هلا والله! تبي الصدق؟ معظم الناس يضيعون أول ساعتين من يومهم في تصفح الجوال بدون هدف. جرّب هالثلاث شغلات: أولاً، لا تلمس جوالك أول نصف ساعة. ثانياً، اكتب أهم 3 مهام بورقة وقلم. وثالثاً، ابدأ بالأصعب وأنت في قمة تركيزك. طبقها أسبوع وشوف الفرق!',
    callToAction: 'وش أول عادة حابب تغيرها في روتينك؟ شاركني في التعليقات وشارك الفيديو مع صاحبك الكسول!',
    caption: 'كيف تبدأ يومك بنشاط وتنجز أكثر في وقت أقل؟ 🚀 جرب هذه العادات الثلاث وشاركنا رأيك في التعليقات!',
    hashtags: ['#تطوير_الذات', '#عادات_الصباح', '#إنتاجية', '#تيك_توك_عرب', '#نصائح_سريعة'],
  });
  const [copied, setCopied] = useState(false);

  const handleGenerateScript = async (customTopic?: string, customPlatform?: 'tiktok' | 'whatsapp' | 'reels', customDuration?: number) => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: customTopic || topic,
          platform: customPlatform || platform,
          duration: customDuration || duration,
          dialect: avatar.dialect,
          avatarName: avatar.name,
        }),
      });

      if (!res.ok) throw new Error('فشل توليد السيناريو');
      const data = await res.json();
      setScriptData(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCaption = () => {
    if (!scriptData) return;
    const textToCopy = `${scriptData.caption || scriptData.fullScript}\n\n${(scriptData.hashtags || []).join(' ')}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareToWhatsApp = () => {
    if (!scriptData) return;
    const text = encodeURIComponent(
      `🎥 رسالة فيديو مميزة من ${avatar.name}:\n\n"${scriptData.fullScript}"\n\nشاهد الشخصية الافتراضية تتحدث مباشرة!`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 select-none">
      {/* Studio Banner */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-emerald-950/80 via-slate-900 to-indigo-950/80 border border-emerald-500/20 backdrop-blur-md shadow-2xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Wand2 className="w-5 h-5" />
              </span>
              <h2 className="text-xl font-bold text-white">
                استوديو سيناريو الفيديو الذكي لـ {avatar.name}
              </h2>
            </div>
            <p className="text-sm text-slate-300">
              اكتب فكرتك أو اختر قالباً جاهزاً وسيقوم الذكاء الاصطناعي بتأليف سيناريو فيديو احترافي
              للتيك توك أو الواتساب، وتلقيه الشخصية الافتراضية أمامك بالفيديو فوراً!
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs px-3 py-1.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              اللهجة: <strong className="text-emerald-400">{avatar.dialect}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Quick Template Chips */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>قوالب أفكار سريعة وجاهزة:</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {TEMPLATE_PROMPTS.map((tmpl, idx) => (
            <button
              key={idx}
              onClick={() => {
                setTopic(tmpl.topic);
                setPlatform(tmpl.platform as any);
                setDuration(tmpl.duration);
                handleGenerateScript(tmpl.topic, tmpl.platform as any, tmpl.duration);
              }}
              className="text-right p-3 rounded-2xl bg-slate-900/80 hover:bg-emerald-950/40 border border-slate-800 hover:border-emerald-500/40 transition-all text-xs text-slate-200 group"
            >
              <div className="font-bold text-white mb-1 group-hover:text-emerald-400 transition-colors">
                {tmpl.label}
              </div>
              <div className="text-[11px] text-slate-400 line-clamp-2">{tmpl.topic}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Script Generator Controls */}
      <div className="p-5 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
        {/* Topic Input */}
        <div>
          <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
            موضوع الفيديو أو الرسالة:
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="مثال: 5 أسرار للتسويق على تيك توك، أو رسالة صباح الخير دافئة..."
            className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Platform & Duration Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Target Platform */}
          <div>
            <label className="text-xs font-semibold text-slate-300 mb-1.5 block">المنصة المستهدفة:</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'tiktok', name: 'تيك توك 9:16' },
                { id: 'whatsapp', name: 'فيديو واتساب' },
                { id: 'reels', name: 'إنستغرام ريلز' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id as any)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                    platform === p.id
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="text-xs font-semibold text-slate-300 mb-1.5 block flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>مدة الفيديو التقديرية:</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[15, 30, 60].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                    duration === d
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {d} ثانية
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={() => handleGenerateScript()}
          disabled={isGenerating}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-sm shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>جاري صياغة السيناريو الذكي...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>تأليف وتوليد السيناريو بالفيديو</span>
            </>
          )}
        </button>
      </div>

      {/* Generated Script Display & Action Buttons */}
      {scriptData && (
        <div className="p-6 rounded-3xl bg-slate-900 border border-emerald-500/30 shadow-2xl space-y-5 animate-in fade-in slide-in-from-bottom-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                سيناريو جاهز للإلقاء بالفيديو
              </span>
              <h3 className="text-lg font-bold text-white mt-1.5">{scriptData.title}</h3>
            </div>

            {/* Main Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Deliver Now */}
              <button
                onClick={() => onDeliverScript(scriptData.fullScript)}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>تحدث بالفيديو الآن</span>
              </button>

              {/* Record Video Clip */}
              <button
                onClick={() => onRecordScriptVideo(scriptData.fullScript)}
                className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-lg active:scale-95 transition-all ${
                  isRecording
                    ? 'bg-red-600 animate-pulse text-white'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isRecording ? 'جاري التسجيل...' : 'تسجيل وتصدير فيديو'}</span>
              </button>

              {/* Share to WhatsApp */}
              <button
                onClick={shareToWhatsApp}
                className="px-3 py-2 rounded-xl bg-emerald-700/80 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>واتساب</span>
              </button>
            </div>
          </div>

          {/* Hook (0-3s) */}
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
            <span className="text-xs font-bold text-amber-400 block mb-1">
              ⚡ الهوك الافتتاحي (أول 3 ثوانٍ لجذب المشاهد):
            </span>
            <p className="text-sm font-semibold text-amber-100">{scriptData.hook}</p>
          </div>

          {/* Full Script */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
            <span className="text-xs font-bold text-slate-400 block mb-2">
              📜 النص الكامل الذي ستقوله الشخصية الافتراضية أمام الكاميرا:
            </span>
            <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-line font-medium">
              {scriptData.fullScript}
            </p>
          </div>

          {/* Call To Action */}
          <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30">
            <span className="text-xs font-bold text-indigo-400 block mb-1">
              🎯 خاتمة ودعوة التفاعل (Call To Action):
            </span>
            <p className="text-sm text-indigo-200">{scriptData.callToAction}</p>
          </div>

          {/* Caption & Hashtags for TikTok */}
          {scriptData.caption && (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-400">
                  📱 كابشن جاهز للنشر على تيك توك والإنستغرام:
                </span>
                <button
                  onClick={handleCopyCaption}
                  className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'تم النسخ!' : 'نسخ الكابشن'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-300 mb-2">{scriptData.caption}</p>
              <div className="flex flex-wrap gap-1.5">
                {(scriptData.hashtags || []).map((ht, i) => (
                  <span
                    key={i}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  >
                    {ht}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
