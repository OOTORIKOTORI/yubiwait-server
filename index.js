// index.js — CI安定版 + readiness フラグ付き /api/ping
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');
const pino = require('pino');
const pinoHttp = require('pino-http');

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-internal-token"]',
      'res.headers["set-cookie"]',
      'req.body.cancelToken',
      'req.query.cancelToken',
      'req.body.subscription',
    ],
    censor: '[REDACTED]',
  },
});

const app = express();
const port = process.env.PORT || 3000;

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
    customLogLevel: (res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url, headers: req.headers }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  })
);

app.use(cors());
app.use(express.json());

// ---- readiness flag ----
let isReady = false;

// === /api/ping: boot前でも即応、readinessも返す ===
app.get('/api/ping', (_req, res) => res.json({ ok: true, ready: isReady, ts: new Date().toISOString() }));

function devOnly(req, res, next) {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not Found' });
  next();
}
function internalOnly(req, res, next) {
  if ((req.get('x-internal-token') || '') !== process.env.INTERNAL_TOKEN)
    return res.status(401).json({ error: 'unauthorized' });
  next();
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  console.log('[BOOT] Mongo connected');
}

function mountIfExists(path, modPath, ...mw) {
  try {
    const router = require(modPath);
    if (mw.length) app.use(path, ...mw, router);
    else app.use(path, router);
    console.log(`[BOOT] mounted ${path} from ${modPath}`);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.warn(`[BOOT] skip mount ${path} (module not found: ${modPath})`);
    } else {
      throw e;
    }
  }
}

async function boot() {
  await connectDB();

  try {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) {
      const webpush = require('web-push');
      webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      console.log('[BOOT] VAPID configured');
    } else {
      console.warn('[BOOT] VAPID not set – skip web-push');
    }
  } catch (e) {
    console.warn('[BOOT] web-push not installed or failed to configure – skipping');
  }

  // 必須ルート
  mountIfExists('/api/join', './join');
  // 任意ルート
  mountIfExists('/api/staff', './staff');
  mountIfExists('/api/store', './store');

  // 共通エラーハンドラ
  app.use((err, req, res, _next) => {
    req.log?.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal Server Error' });
  });

  try {
    if (process.env.AUTO_CALLER_ENABLED !== '0') {
      const { startAutoCaller } = require('./autoCaller');
      startAutoCaller();
      console.log('[BOOT] AutoCaller started');
    } else {
      console.log('[BOOT] AutoCaller disabled by env');
    }
  } catch (e) {
    console.warn('[BOOT] autoCaller not started:', e.message);
  }

  isReady = true;
  console.log('[BOOT] server ready (routes mounted)');
}

app.listen(port, '0.0.0.0', () => {
  console.log(`APIサーバが http://127.0.0.1:${port} で起動中`);
});

boot().catch((e) => {
  console.error('サーバ起動失敗:', e);
  process.exit(1);
});

module.exports = app;
