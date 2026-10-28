import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  handleChat,
  handleTTS,
  handleScriptGenerate,
  handleAvatarGenerate,
} from './server/handlers.ts';
import {
  handleTikTokWebhook,
  handleTikTokTestComment,
  handleTikTokGetEvents,
  handleTikTokConfig,
} from './server/tiktokLive.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Core AI endpoints
app.post('/api/chat', async (req, res) => {
  try {
    const result = await handleChat(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const result = await handleTTS(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/script', async (req, res) => {
  try {
    const result = await handleScriptGenerate(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/avatar-generate', async (req, res) => {
  try {
    const result = await handleAvatarGenerate(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// TikTok LIVE Integration endpoints
app.post('/api/tiktok/webhook', (req, res) => {
  const querySecret = typeof req.query.secret === 'string' ? req.query.secret : undefined;
  const result = handleTikTokWebhook(req.body, req.headers as any, querySecret);
  res.status(result.statusCode).json(result.data);
});

app.post('/api/tiktok/test-comment', (req, res) => {
  const result = handleTikTokTestComment(req.body);
  res.json(result);
});

app.get('/api/tiktok/events', (req, res) => {
  const since = Number(req.query.since || '0');
  const result = handleTikTokGetEvents(isNaN(since) ? 0 : since);
  res.json(result);
});

app.post('/api/tiktok/config', (req, res) => {
  const result = handleTikTokConfig(req.body);
  res.json(result);
});

// Serve static frontend assets from dist in production
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
