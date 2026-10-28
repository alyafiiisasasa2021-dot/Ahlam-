import crypto from 'crypto';

export interface TikTokLiveCommentEvent {
  id: string;
  externalId?: string;
  timestamp: number;
  user: string;
  uniqueId: string;
  avatar: string;
  text: string;
  source: 'tiktok-live' | 'test';
  badge?: string;
  eventType: 'comment' | 'gift';
  giftName?: string;
  giftIcon?: string;
}

const DEFAULT_VIEWER_AVATAR =
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&q=80';

// In-memory ring buffer of incoming TikTok LIVE events (max 100 events)
const MAX_BUFFER_SIZE = 100;
const DEDUP_WINDOW_MS = 120_000; // 2 minutes deduplication window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute rate-limit window
const MAX_WEBHOOK_REQ_PER_MIN = 60;
const MAX_BATCH_ITEMS = 20;

let eventBuffer: TikTokLiveCommentEvent[] = [];
let lastRealEventAt: number | null = null;
let totalRealEvents = 0;
let totalTestEvents = 0;
let serverSkippedDuplicates = 0;
let targetUsername = process.env.TIKTOK_LIVE_USERNAME || '@ahlam.live';

// Server-side Deduplication Maps
const recentExternalIds = new Map<string, number>();
const recentContentHashes = new Map<string, number>();

// Server-side Rate Limit Map (IP -> timestamps[])
const ipRequestTimestamps = new Map<string, number[]>();

function pushEvent(evt: TikTokLiveCommentEvent) {
  eventBuffer.push(evt);
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer = eventBuffer.slice(-MAX_BUFFER_SIZE);
  }
}

function cleanupExpiredMaps(now: number) {
  for (const [id, ts] of recentExternalIds.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) {
      recentExternalIds.delete(id);
    }
  }
  for (const [hash, ts] of recentContentHashes.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) {
      recentContentHashes.delete(hash);
    }
  }
}

export function checkWebhookRateLimit(clientKey = 'global'): boolean {
  const now = Date.now();
  const prev = ipRequestTimestamps.get(clientKey) || [];
  const recent = prev.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= MAX_WEBHOOK_REQ_PER_MIN) {
    ipRequestTimestamps.set(clientKey, recent);
    return false;
  }
  recent.push(now);
  ipRequestTimestamps.set(clientKey, recent);
  return true;
}

function safeCompareStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Normalizes incoming webhook payloads from authorized TikTok LIVE connectors:
 * 1. Cloud Bridge / tiktok-live-connector: { uniqueId, nickname, comment, msgId, profilePictureUrl }
 * 2. EulerStream Webcast Webhook: { type: "chat", data: { msgId, comment, user: { uniqueId, nickname, profilePictureUrl } } }
 * 3. TikFinity Web/Desktop Webhook (or IFTTT style): { value1, value2, value3 } or { event: "chat", data: { ... } }
 * 4. Generic JSON Connector: { user, text } / { username, message }
 */
function parseConnectorPayload(body: any): {
  externalId?: string;
  user: string;
  uniqueId: string;
  avatar: string;
  text: string;
  badge?: string;
  eventType: 'comment' | 'gift';
  giftName?: string;
  giftIcon?: string;
} | null {
  if (!body || typeof body !== 'object') return null;

  // Unwrap nested 'data' or 'event.data' if sent by EulerStream or TikFinity Web
  const payload =
    body.data && typeof body.data === 'object'
      ? body.data
      : body.event && typeof body.event === 'object' && body.event.data
      ? body.event.data
      : body;

  const userObj = payload.user && typeof payload.user === 'object' ? payload.user : null;

  const externalIdRaw =
    payload.msgId ||
    payload.id ||
    payload.eventId ||
    body.msgId ||
    body.id ||
    body.eventId ||
    undefined;
  const externalId = externalIdRaw ? String(externalIdRaw).trim() : undefined;

  const uniqueId = String(
    userObj?.uniqueId ||
      userObj?.username ||
      payload.uniqueId ||
      payload.username ||
      payload.handle ||
      payload.value1 ||
      body.uniqueId ||
      body.username ||
      'tiktok_viewer'
  )
    .trim()
    .slice(0, 60);

  const user = String(
    userObj?.nickname ||
      userObj?.displayName ||
      payload.nickname ||
      payload.displayName ||
      (typeof payload.user === 'string' ? payload.user : '') ||
      payload.value1 ||
      uniqueId
  )
    .trim()
    .slice(0, 60);

  const avatar = String(
    userObj?.profilePictureUrl ||
      userObj?.avatarUrl ||
      payload.profilePictureUrl ||
      payload.avatarUrl ||
      payload.avatar ||
      payload.value3 ||
      DEFAULT_VIEWER_AVATAR
  ).trim();

  // Check if it's a gift event
  const rawType = String(
    body.type || body.event || payload.eventType || payload.type || 'comment'
  ).toLowerCase();
  if (rawType.includes('gift') || payload.giftName || payload.gift?.name) {
    const giftName = String(payload.giftName || payload.gift?.name || 'هدية بث مباشر').slice(0, 60);
    return {
      externalId,
      user,
      uniqueId,
      avatar: avatar.startsWith('http') ? avatar : DEFAULT_VIEWER_AVATAR,
      text: `أرسل هدية: ${giftName}`,
      badge: 'داعم البث 🎁',
      eventType: 'gift',
      giftName,
      giftIcon: String(payload.giftIcon || '🎁'),
    };
  }

  const text = String(
    payload.comment ||
      payload.text ||
      payload.message ||
      payload.content ||
      payload.chatMessage ||
      payload.value2 ||
      body.comment ||
      body.text ||
      body.message ||
      body.content ||
      ''
  )
    .trim()
    .slice(0, 300);

  if (!text) return null;

  const badge = payload.isSubscriber
    ? 'مشترك ⭐'
    : payload.isModerator
    ? 'مشرف 🛡️'
    : payload.badge
    ? String(payload.badge).slice(0, 30)
    : 'مشاهد TikTok LIVE';

  return {
    externalId,
    user,
    uniqueId,
    avatar: avatar.startsWith('http') ? avatar : DEFAULT_VIEWER_AVATAR,
    text,
    badge,
    eventType: 'comment',
  };
}

export function verifyWebhookSecret(
  headers: Record<string, string | string[] | undefined>,
  querySecret?: string,
  rawBodyObj?: any
): boolean {
  const configuredSecret = (process.env.TIKTOK_WEBHOOK_SECRET || '').trim();
  if (!configuredSecret) {
    // No secret required if TIKTOK_WEBHOOK_SECRET is not set
    return true;
  }

  const headerSecretRaw =
    headers['x-webhook-secret'] ||
    headers['x-tiktok-secret'] ||
    (typeof headers['authorization'] === 'string'
      ? headers['authorization'].replace(/^Bearer\s+/i, '')
      : '');

  const headerSecret = Array.isArray(headerSecretRaw)
    ? headerSecretRaw[0] || ''
    : String(headerSecretRaw || '');

  if (headerSecret && safeCompareStrings(headerSecret.trim(), configuredSecret)) {
    return true;
  }

  if (querySecret && safeCompareStrings(querySecret.trim(), configuredSecret)) {
    return true;
  }

  // Also support EulerStream HMAC-SHA256 signature verification (x-webhook-signature)
  const signatureHeader = headers['x-webhook-signature'];
  const sigStr = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (sigStr && rawBodyObj) {
    try {
      const serialized = JSON.stringify(rawBodyObj);
      const expectedHmac = crypto
        .createHmac('sha256', configuredSecret)
        .update(serialized)
        .digest('hex');
      const cleanSig = sigStr.replace(/^sha256=/i, '').trim();
      if (safeCompareStrings(cleanSig, expectedHmac)) {
        return true;
      }
    } catch {
      // ignore hmac error
    }
  }

  return false;
}

export function handleTikTokWebhook(
  body: any,
  headers: Record<string, string | string[] | undefined>,
  querySecret?: string
) {
  const forwardedFor = headers['x-forwarded-for'];
  const clientIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : 'webhook-client';

  if (!checkWebhookRateLimit(clientIp)) {
    return {
      statusCode: 429,
      data: {
        error: 'تم تجاوز الحد الأقصى لطلبات الويب هوك في الدقيقة (60 طلب/دقيقة). يرجى التهدئة.',
      },
    };
  }

  if (!verifyWebhookSecret(headers, querySecret, body)) {
    return {
      statusCode: 401,
      data: { error: 'مفتاح التحقق من الويب هوك (TIKTOK_WEBHOOK_SECRET) غير مطابق' },
    };
  }

  const now = Date.now();
  cleanupExpiredMaps(now);

  // Support batch array of events or single event object (capped at MAX_BATCH_ITEMS)
  const rawItems = (
    Array.isArray(body)
      ? body
      : Array.isArray(body?.events)
      ? body.events
      : [body]
  ).slice(0, MAX_BATCH_ITEMS);

  const added: TikTokLiveCommentEvent[] = [];
  let duplicatesInBatch = 0;

  for (let idx = 0; idx < rawItems.length; idx++) {
    const item = rawItems[idx];
    const parsed = parseConnectorPayload(item);
    if (!parsed) continue;

    // 1. Server-side Deduplication by external message ID (msgId)
    if (parsed.externalId && recentExternalIds.has(parsed.externalId)) {
      duplicatesInBatch++;
      serverSkippedDuplicates++;
      continue;
    }

    // 2. Server-side Deduplication by (uniqueId + normalized text) within 120s window
    const normalizedText = parsed.text.trim().replace(/\s+/g, ' ').toLowerCase();
    const contentKey = `${parsed.uniqueId.toLowerCase()}:${normalizedText}`;
    const lastSeen = recentContentHashes.get(contentKey);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
      duplicatesInBatch++;
      serverSkippedDuplicates++;
      continue;
    }

    if (parsed.externalId) {
      recentExternalIds.set(parsed.externalId, now);
    }
    recentContentHashes.set(contentKey, now);

    const evtTimestamp = now + idx;
    const evt: TikTokLiveCommentEvent = {
      id: `tt-real-${evtTimestamp}-${Math.random().toString(36).slice(2, 7)}`,
      externalId: parsed.externalId,
      timestamp: evtTimestamp,
      user: parsed.user,
      uniqueId: parsed.uniqueId,
      avatar: parsed.avatar,
      text: parsed.text,
      source: 'tiktok-live',
      badge: parsed.badge,
      eventType: parsed.eventType,
      giftName: parsed.giftName,
      giftIcon: parsed.giftIcon,
    };

    pushEvent(evt);
    added.push(evt);
    lastRealEventAt = evtTimestamp;
    totalRealEvents++;
  }

  if (added.length === 0 && duplicatesInBatch === 0) {
    return {
      statusCode: 400,
      data: {
        error:
          'لم يتم العثور على حقل تعليق صالح. الصيغ المدعومة: { "uniqueId": "user", "nickname": "الاسم", "comment": "نص التعليق" } أو صيغة EulerStream / TikFinity.',
      },
    };
  }

  return {
    statusCode: 200,
    data: {
      ok: true,
      received: added.length,
      skippedDuplicates: duplicatesInBatch,
      events: added,
    },
  };
}

export function handleTikTokTestComment(body: any) {
  const items = (Array.isArray(body?.comments) ? body.comments : [body]).slice(
    0,
    MAX_BATCH_ITEMS
  );
  const added: TikTokLiveCommentEvent[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const text = String(
      item.comment || item.text || 'السلام عليكم يا أحلام! كيف حالك اليوم؟'
    )
      .trim()
      .slice(0, 300);
    const user = String(item.nickname || item.user || 'مشاهد تجريبي')
      .trim()
      .slice(0, 60);
    const uniqueId = String(item.uniqueId || 'test_viewer')
      .trim()
      .slice(0, 60);

    const now = Date.now() + i;
    const evt: TikTokLiveCommentEvent = {
      id: `tt-test-${now}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      user,
      uniqueId,
      avatar: item.avatar || DEFAULT_VIEWER_AVATAR,
      text,
      source: 'test',
      badge: 'تعليق اختبار محلي 🧪',
      eventType: 'comment',
    };

    pushEvent(evt);
    added.push(evt);
    totalTestEvents++;
  }

  return {
    ok: true,
    received: added.length,
    events: added,
  };
}

export function handleTikTokGetEvents(sinceTimestamp = 0) {
  const newEvents =
    sinceTimestamp > 0
      ? eventBuffer.filter((e) => e.timestamp > sinceTimestamp)
      : eventBuffer.slice(-30);

  const isRealWebhookActive =
    lastRealEventAt !== null && Date.now() - lastRealEventAt < 10 * 60 * 1000;

  return {
    connectedToRealWebhook: isRealWebhookActive,
    webhookSecretConfigured: Boolean((process.env.TIKTOK_WEBHOOK_SECRET || '').trim()),
    targetUsername,
    lastRealEventAt,
    totalRealEvents,
    totalTestEvents,
    serverSkippedDuplicates,
    events: newEvents,
  };
}

export function handleTikTokConfig(body: any) {
  if (typeof body?.targetUsername === 'string' && body.targetUsername.trim()) {
    const clean = body.targetUsername.trim().slice(0, 50);
    targetUsername = clean.startsWith('@') ? clean : `@${clean}`;
  }
  if (body?.clearEvents === true) {
    eventBuffer = [];
    lastRealEventAt = null;
    totalRealEvents = 0;
    totalTestEvents = 0;
    serverSkippedDuplicates = 0;
    recentExternalIds.clear();
    recentContentHashes.clear();
  }
  return {
    ok: true,
    targetUsername,
    webhookSecretConfigured: Boolean((process.env.TIKTOK_WEBHOOK_SECRET || '').trim()),
  };
}
