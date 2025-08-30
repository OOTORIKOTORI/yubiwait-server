const express = require('express');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./db');

// ルート
const joinRoutes = require('./routes/join');
const staffRoutes = require('./routes/staff');
const storeRoutes = require('./routes/store');
const adminAuthRoutes = require('./routes/adminAuth');
const adminSettingsRoutes = require('./routes/adminSettings');
const adminPinRoutes = require('./routes/adminPin');
const adminMetricsRoutes = require('./routes/adminMetrics');
const adminHistoryRoutes = require('./routes/adminHistory');

// レートリミット（/api/join 用）
const rateLimit = require('express-rate-limit');
const joinLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1分
  max: 60,                 // 同一IPあたり 60 リクエスト/分
  standardHeaders: true,   // RateLimit-* を返す
  legacyHeaders: false,
});

const app = express();
const port = process.env.PORT || 3000;

// CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8080',
  'https://yubiwait-client.onrender.com',
  'https://www.yubiwait.com',
  'https://api.yubiwait.com',
  // 'https://admin.yubiwait.com', // Adminを別ドメインで配信するなら追加
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed for this origin: ' + origin));
    }
  },
  credentials: true,
}));

app.use(express.json());

// ===== 起動シーケンス（DB接続完了後に AutoCaller を起動）=====
async function boot() {
  // 1) DB接続（失敗時は throw して落とす）
  await connectDB();

  // 2) Web Push(VAPID)
  const webpush = require('web-push');
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  // 3) ルーティング
  app.use('/api/join', joinLimiter, joinRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/store', storeRoutes);

  // Admin API
  app.use('/api/admin', adminAuthRoutes);
  app.use('/api/admin', adminSettingsRoutes);
  app.use('/api/admin', adminPinRoutes);
  app.use('/api/admin', adminMetricsRoutes);
  app.use('/api/admin', adminHistoryRoutes);

  // 4) AutoCaller は「DB接続完了後」に起動
  if (process.env.AUTO_CALLER_ENABLED !== '0') {
    const { startAutoCaller } = require('./autoCaller');
    startAutoCaller(); // 間隔: AUTO_CALLER_INTERVAL_MS（既定 10秒）
  }

  // 5) 動作確認用
  app.get('/api/test', (_req, res) => {
    res.json({ message: 'Expressサーバ動いてるよ！' });
  });

  app.listen(port, () => {
    console.log(`APIサーバが http://localhost:${port} で起動中`);
  });
}

boot().catch((e) => {
  console.error('サーバ起動失敗:', e);
  process.exit(1);
});
