import type { IncomingMessage, ServerResponse } from 'http';
import {
  handleChat,
  handleTTS,
  handleScriptGenerate,
  handleAvatarGenerate,
} from './handlers';
import {
  handleTikTokWebhook,
  handleTikTokTestComment,
  handleTikTokGetEvents,
  handleTikTokConfig,
} from './tiktokLive';

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export async function apiMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) {
  const url = req.url || '';

  if (!url.startsWith('/api/')) {
    return next();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-webhook-secret, x-tiktok-secret, x-webhook-signature, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const [cleanUrl, queryString = ''] = url.split('?');
    const searchParams = new URLSearchParams(queryString);

    if (cleanUrl === '/api/chat' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await handleChat(body);
      return sendJson(res, 200, result);
    }

    if (cleanUrl === '/api/tts' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await handleTTS(body);
      return sendJson(res, 200, result);
    }

    if (cleanUrl === '/api/script' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await handleScriptGenerate(body);
      return sendJson(res, 200, result);
    }

    if (cleanUrl === '/api/avatar-generate' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await handleAvatarGenerate(body);
      return sendJson(res, 200, result);
    }

    // TikTok LIVE Integration Routes
    if (cleanUrl === '/api/tiktok/webhook' && req.method === 'POST') {
      const body = await parseBody(req);
      const querySecret = searchParams.get('secret') || undefined;
      const result = handleTikTokWebhook(body, req.headers as any, querySecret);
      return sendJson(res, result.statusCode, result.data);
    }

    if (cleanUrl === '/api/tiktok/test-comment' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = handleTikTokTestComment(body);
      return sendJson(res, 200, result);
    }

    if (cleanUrl === '/api/tiktok/events' && req.method === 'GET') {
      const since = Number(searchParams.get('since') || '0');
      const result = handleTikTokGetEvents(isNaN(since) ? 0 : since);
      return sendJson(res, 200, result);
    }

    if (cleanUrl === '/api/tiktok/config' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = handleTikTokConfig(body);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'مسار غير موجود' });
  } catch (error: any) {
    return sendJson(res, 500, {
      error: error.message || 'حدث خطأ غير متوقع في الخادم',
    });
  }
}
