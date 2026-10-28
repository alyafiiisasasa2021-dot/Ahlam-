import { getGeminiClient } from './gemini';

// In-memory circuit breakers & caches to prevent 429 quota errors
let ttsQuotaExhaustedUntil = 0;
let imageQuotaExhaustedUntil = 0;
let chatPrimaryQuotaExhaustedUntil = 0;

const ttsAudioCache = new Map<string, { audioBase64: string; mimeType: string }>();

const CURATED_STUDIO_PORTRAITS = {
  male: [
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=1200&q=80',
  ],
  female: [
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=1200&q=80',
  ],
};

let portraitRotationIdx = 0;

function isQuotaError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return (
    err?.status === 429 ||
    err?.code === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota exceeded') ||
    msg.includes('quota')
  );
}

function ensureWavFormat(pcmOrWavBuffer: Buffer, sampleRate = 24000): Buffer {
  if (
    pcmOrWavBuffer.length >= 44 &&
    pcmOrWavBuffer[0] === 0x52 &&
    pcmOrWavBuffer[1] === 0x49 &&
    pcmOrWavBuffer[2] === 0x46 &&
    pcmOrWavBuffer[3] === 0x46
  ) {
    return pcmOrWavBuffer;
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmOrWavBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmOrWavBuffer]);
}

// Secondary server-side Arabic TTS audio generator when Gemini TTS free tier limit (10/day) is reached
async function synthesizeFallbackArabicAudio(
  text: string
): Promise<{ audioBase64: string; mimeType: string } | null> {
  try {
    // Split text into chunks <= 180 chars for clean synthesis
    const shortText = text.slice(0, 195);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ar&client=tw-ob&q=${encodeURIComponent(
      shortText
    )}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength < 100) return null;

    return {
      audioBase64: Buffer.from(arrayBuffer).toString('base64'),
      mimeType: 'audio/mpeg',
    };
  } catch {
    return null;
  }
}

function buildLocalChatFallback(userText: string, avatarName: string, dialect: string) {
  const q = userText.trim();
  const isGreeting = /سلام|مرحبا|هلا|اهلا|صباح|مساء|كيفك|اخبارك|شلونك/.test(q);
  const isWho = /من انت|عرفني|نفسك|اسمك/.test(q);

  if (isGreeting) {
    return {
      reply:
        dialect === 'مصري'
          ? `أهلاً بيك يا غالي! أنا ${avatarName}، منورني والله. قول لي تحب نتكلم في إيه النهارده؟`
          : dialect === 'شامي'
          ? `يا مية أهلاً وسهلاً فيك! أنا ${avatarName}، الحمد لله بألف خير. طمني عنك شو أخبارك؟`
          : `وعليكم السلام والرحمة، يا هلا والله ومسهلا! أنا ${avatarName} معك، بشرني عنك وكيف أقدر أسعدك اليوم؟`,
      emotion: 'greeting',
      suggestedReplies: ['عرفني بنفسك أكثر', 'أعطني نصيحة لليوم', 'نبي نسوي فيديو للتيك توك'],
    };
  }

  if (isWho) {
    return {
      reply: `أنا ${avatarName}، نسختك الرقمية الناطقة بالذكاء الاصطناعي. أحتفظ بملامح وجهك الحقيقية وأتفاعل معك بالصوت والصورة في أي وقت!`,
      emotion: 'smile',
      suggestedReplies: ['رائع جداً!', 'كيف أغير الصورة أو الفيديو؟', 'أعطني فكرة محتوى'],
    };
  }

  return {
    reply: `سمعتك بكل وضوح بخصوص "${q.slice(0, 45)}". موضوع مميز جداً! أنا معك على الخط، عطني تفاصيل أكثر أو قل لي كيف تحب نصيغ الفكرة بشكل إبداعي.`,
    emotion: 'nod',
    suggestedReplies: ['اشرح لي بالتفصيل', 'حولها لسيناريو فيديو', 'سؤال آخر'],
  };
}

export async function handleChat(reqBody: any) {
  const { messages, avatarConfig, liveComment } = reqBody;
  const ai = getGeminiClient();

  const avatarName = avatarConfig?.name || 'أحلام';
  const dialect = avatarConfig?.dialect || 'خليجي / سعودي';
  const role = avatarConfig?.role || 'مضيفة بث مباشر على تيك توك وشخصية افتراضية ناطقة';
  const tone = avatarConfig?.tone || 'طبيعية، مرحة، دافئة وسريعة البديهة';

  const isLiveComment = Boolean(liveComment && liveComment.commentText);
  const viewerName = liveComment?.viewerName || 'المتابع';

  const systemInstruction = isLiveComment
    ? `أنتِ الشخصية الافتراضية "${avatarName}" في بث مباشر تفاعلي على TikTok LIVE.
دورك: ${role}.
لهجتك: ${dialect}.
نبرتك: ${tone}.
وصل الآن تعليق مباشر من المشاهد "${viewerName}" في البث.
قواعد الرد على تعليقات البث المباشر:
1. رحبي بالمشاهد "${viewerName}" أو اذكري اسمه بعفوية في بداية الرد.
2. اجعلي الرد قصيراً جداً ومباشراً باللغة العربية بلهجتك (${dialect}) بحيث لا يتجاوز جملة أو جملتين قصيرتين (15 إلى 30 كلمة كحد أقصى) ليناسب سرعة البث المباشر.
3. لا تذكري أبداً أنك روبوت أو ذكاء اصطناعي.
4. أجيبي بصيغة JSON صالحة فقط:
{
  "reply": "الرد العربي القصير الذي ستنطقينه في البث",
  "emotion": "smile" | "excited" | "greeting" | "nod",
  "suggestedReplies": []
}`
    : `أنت شخصية حقيقية ناطقة بالذكاء الاصطناعي اسمها "${avatarName}".
دورك: ${role}.
لهجتك في الحديث: ${dialect}.
نبرتك وشخصيتك: ${tone}.
تتحدث كأنك إنسان حقيقي 100% أمام الكاميرا في محادثة صوتية ومصوّرة مباشرة.
قواعد الرد:
1. تحدث باللغة العربية بلهجتك المحددة (${dialect}) بشكل طبيعي وجذاب وعفوي.
2. لا تذكر أبداً أنك روبوت أو نموذج ذكاء اصطناعي، بل تحدث بشخصية "${avatarName}" مباشرة.
3. اجعل ردودك واضحة، موجزة ومناسبة للنطق الصوتي المباشر (من جملتين إلى 4 جمل مفيدة وممتعة).
4. أجب دائماً بصيغة JSON صالحة فقط بهذا النمط الدقيق:
{
  "reply": "نص الرد الذي ستقوله بصوتك",
  "emotion": "smile" | "excited" | "thinking" | "serious" | "nod" | "greeting",
  "suggestedReplies": ["اقتراح رد 1", "اقتراح رد 2", "اقتراح رد 3"]
}`;

  const formattedContents = (messages || []).map((m: any) => ({
    role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || m.text || '' }],
  }));

  if (formattedContents.length === 0) {
    formattedContents.push({
      role: 'user',
      parts: [{ text: 'مرحباً! عرفني بنفسك باختصار.' }],
    });
  }

  const lastUserText =
    formattedContents[formattedContents.length - 1]?.parts?.[0]?.text || 'مرحباً';

  const modelsToTry =
    Date.now() < chatPrimaryQuotaExhaustedUntil
      ? ['gemini-3.1-flash-lite', 'gemini-3.8-flash']
      : ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: formattedContents,
        config: {
          systemInstruction,
          temperature: 0.85,
          responseMimeType: 'application/json',
        },
      });

      const rawText = response.text || '';
      try {
        const parsed = JSON.parse(rawText);
        return {
          reply: parsed.reply || rawText,
          emotion: parsed.emotion || 'smile',
          suggestedReplies: parsed.suggestedReplies || [
            'حدثني أكثر عن هذا الموضوع',
            'ما نصيحتك لي اليوم؟',
            'أعطني فكرة فيديو قصير',
          ],
        };
      } catch {
        return {
          reply: rawText,
          emotion: 'smile',
          suggestedReplies: ['خبرني أكثر!', 'ما رأيك في موضوع آخر؟', 'كيف أقدر أساعدك؟'],
        };
      }
    } catch (err: any) {
      if (isQuotaError(err) && modelName === 'gemini-3.8-flash') {
        chatPrimaryQuotaExhaustedUntil = Date.now() + 5 * 60 * 1000;
      }
      // Continue to next model or graceful fallback without throwing 500
    }
  }

  return buildLocalChatFallback(lastUserText, avatarName, dialect);
}

export async function handleTTS(reqBody: any) {
  const { text, voice } = reqBody;
  if (!text || typeof text !== 'string') {
    return { fallback: true, reason: 'النص مطلوب' };
  }

  const voiceName = voice || 'Fenrir';
  const cleanText = text
    .replace(/[#*`_~]/g, '')
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
      ''
    )
    .trim()
    .slice(0, 500);

  if (!cleanText) {
    return { fallback: true, reason: 'النص فارغ' };
  }

  const cacheKey = `${voiceName}:${cleanText}`;
  const cached = ttsAudioCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 1. Try Gemini TTS if quota circuit-breaker is not tripped
  if (Date.now() >= ttsQuotaExhaustedUntil) {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [{ text: cleanText }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const rawBuffer = Buffer.from(base64Audio, 'base64');
        const wavBuffer = ensureWavFormat(rawBuffer, 24000);
        const result = {
          audioBase64: wavBuffer.toString('base64'),
          mimeType: 'audio/wav',
        };
        if (ttsAudioCache.size > 50) {
          const firstKey = ttsAudioCache.keys().next().value;
          if (firstKey) ttsAudioCache.delete(firstKey);
        }
        ttsAudioCache.set(cacheKey, result);
        return result;
      }
    } catch (err: any) {
      if (isQuotaError(err)) {
        // Trip circuit breaker for 1 hour so we don't spam 429 errors
        ttsQuotaExhaustedUntil = Date.now() + 60 * 60 * 1000;
      }
    }
  }

  // 2. Fallback to secondary server-side Arabic TTS audio stream (supports full FFT lip-sync!)
  const fallbackAudio = await synthesizeFallbackArabicAudio(cleanText);
  if (fallbackAudio) {
    if (ttsAudioCache.size > 50) {
      const firstKey = ttsAudioCache.keys().next().value;
      if (firstKey) ttsAudioCache.delete(firstKey);
    }
    ttsAudioCache.set(cacheKey, fallbackAudio);
    return fallbackAudio;
  }

  // 3. Final fallback to client-side Web Speech API
  return { fallback: true, quotaExhausted: true };
}

export async function handleScriptGenerate(reqBody: any) {
  const { topic, platform, duration, dialect, avatarName } = reqBody;
  const ai = getGeminiClient();

  const platformName =
    platform === 'whatsapp'
      ? 'رسالة فيديو للواتساب'
      : platform === 'tiktok'
      ? 'فيديو تيك توك ترند (9:16)'
      : 'ريلز / ستوري قصير';
  const targetSeconds = duration || 30;
  const cleanTopic = topic || 'نصيحة ذهبية للنجاح وتطوير الذات';

  const prompt = `أنت كاتب محتوى إبداعي محترف ومؤثر سوشيال ميديا.
اكتب سيناريو فيديو متكامل وجذاب للشخصية "${avatarName || 'قيس'}".
الموضوع: "${cleanTopic}"
المنصة المستهدفة: ${platformName}
المدة التقريبية: ${targetSeconds} ثانية
اللهجة المطلوبة: ${dialect || 'خليجي سعودي معاصر'}

المطلوب إخراج النتيجة بتنسيق JSON حصراً:
{
  "title": "عنوان جذاب ومثير للاهتمام",
  "hook": "الجملة الافتتاحية الصادمة أو الجذابة لأول 3 ثوانٍ",
  "fullScript": "النص الكامل والمفصل الذي ستقوله الشخصية أمام الكاميرا كلمة بكلمة بطريقة عفوية وممتعة",
  "callToAction": "الدعوة لاتخاذ إجراء في النهاية (مثل: علق برأيك، شارك مع أصحابك في الواتساب، تابع الحساب)",
  "subtitles": [
    { "time": "0-3s", "text": "نص الجزء الأول" },
    { "time": "4-15s", "text": "نص الجزء الثاني" },
    { "time": "16-30s", "text": "نص الجزء الثالث" }
  ],
  "caption": "نص الكابشن المقترح للنشر مع الهاشتاقات المناسبة",
  "hashtags": ["#هاشتاق1", "#هاشتاق2", "#هاشتاق3", "#هاشتاق4"]
}`;

  const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];
  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.8,
        },
      });

      const raw = response.text || '{}';
      return JSON.parse(raw);
    } catch {
      // try next model or fallback
    }
  }

  return {
    title: `سر مهم حول: ${cleanTopic}`,
    hook: `توقف لحظة! هذا أهم شيء تحتاج تعرفه اليوم عن ${cleanTopic}...`,
    fullScript: `يا هلا والله! كثير يسألوني عن ${cleanTopic}. السر الحقيقي يبدأ من خطوة بسيطة جداً تقدر تطبقها من اليوم وبتشوف فرق كبير في نتائجك اليومية. جربها وشاركني تجربتك!`,
    callToAction: 'شارك الفيديو مع أصدقائك في الواتساب واكتب رأيك في التعليقات!',
    subtitles: [
      { time: '0-3s', text: `أهم سر حول ${cleanTopic}` },
      { time: '4-15s', text: 'خطوة عملية بسيطة تغير نتائجك' },
      { time: '16-30s', text: 'جربها اليوم وشاركنا رأيك!' },
    ],
    caption: `نصيحة سريعة ومجربة حول ${cleanTopic} 🚀`,
    hashtags: ['#قيس', '#تطوير_الذات', '#تيك_توك', '#نصائح'],
  };
}

export async function handleAvatarGenerate(reqBody: any) {
  const { prompt, style } = reqBody;
  const promptStr = String(prompt || '').toLowerCase();
  const isFemale =
    promptStr.includes('woman') ||
    promptStr.includes('female') ||
    promptStr.includes('أنثى') ||
    promptStr.includes('فتاة') ||
    promptStr.includes('امرأة') ||
    promptStr.includes('مذيعة');

  // Only call image generation model if quota wasn't marked exhausted
  if (Date.now() >= imageQuotaExhaustedUntil) {
    try {
      const ai = getGeminiClient();
      const fullPrompt = `Ultra-realistic 8k portrait photo of an Arabic presenter, ${
        prompt ||
        'charismatic Arabic presenter with warm friendly expression, modern studio lighting, looking directly at the camera, photorealistic'
      }. Style: ${style || 'photorealistic cinematic studio portrait'}.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: {
          parts: [{ text: fullPrompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: '1:1',
          },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) {
          return {
            imageUrl: `data:image/png;base64,${part.inlineData.data}`,
          };
        }
      }
    } catch (err: any) {
      if (isQuotaError(err)) {
        // Free tier has limit: 0 for gemini-3.1-flash-lite-image; trip circuit breaker
        imageQuotaExhaustedUntil = Date.now() + 12 * 60 * 60 * 1000;
      }
    }
  }

  // Graceful fallback to curated high-res studio portraits without throwing 500 error
  const pool = isFemale ? CURATED_STUDIO_PORTRAITS.female : CURATED_STUDIO_PORTRAITS.male;
  const chosenUrl = pool[portraitRotationIdx % pool.length];
  portraitRotationIdx++;

  return {
    imageUrl: chosenUrl,
    isFallbackPreset: true,
    notice:
      'تم اختيار صورة استوديو احترافية عالية الدقة (ويمكنك دائماً رفع صورتك أو فيديوهك الحقيقي مباشرة من جهازك).',
  };
}
