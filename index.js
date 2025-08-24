const express = require('express')
const cors = require('cors')
require('dotenv').config()

const connectDB = require('./db')
const joinRoutes = require('./routes/join')
const staffRoutes = require('./routes/staff')
const storeRoutes = require('./routes/store')
const adminPinRoutes = require('./routes/adminPin');
const adminMetricsRoutes = require('./routes/adminMetrics');
const adminHistoryRoutes = require('./routes/adminHistory');

// ★ 追加：レートリミット（/api/join 用）
const rateLimit = require('express-rate-limit')
const joinLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1分
  max: 60,                 // 同一IPあたり 60 リクエスト/分
  standardHeaders: true,   // RateLimit-* を返す
  legacyHeaders: false,
})

// ★ 追加：Admin用ルート（ファイルはこのあと作る or 既に作成済みのものを参照）
const adminAuthRoutes = require('./routes/adminAuth')        // POST /api/admin/auth/login など
const adminSettingsRoutes = require('./routes/adminSettings') // GET/PATCH /api/admin/stores/:storeId/settings

const app = express()
const port = process.env.PORT || 3000

// CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8080',
  'https://yubiwait-client.onrender.com',
  'https://www.yubiwait.com',
  'https://api.yubiwait.com',
  // 'https://admin.yubiwait.com', // ← Adminを別ドメインで配信するなら必要に応じて追加
]
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('CORS not allowed for this origin: ' + origin))
    }
  },
  credentials: true
}))

app.use(express.json())

// DB接続
connectDB()

// Web Push(VAPID)
const webpush = require('web-push')
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// ルーティング
app.use('/api/join', joinLimiter, joinRoutes)
app.use('/api/staff', staffRoutes)
app.use('/api/store', storeRoutes)


// === Admin（独立ポータル用API） ===
// 例: POST /api/admin/auth/login, GET/PATCH /api/admin/stores/:storeId/settings
app.use('/api/admin', adminAuthRoutes)
app.use('/api/admin', adminSettingsRoutes)
app.use('/api/admin', adminPinRoutes);

app.use('/api/admin', adminMetricsRoutes);
app.use('/api/admin', adminHistoryRoutes);

// DB接続とルータのセット後、最後の方で
if (process.env.AUTO_CALLER_ENABLED !== '0') {
  const { startAutoCaller } = require('./autoCaller')
  startAutoCaller() // 10秒間隔（AUTO_CALLER_INTERVAL_MS で変更可）
}

// 動作確認用
app.get('/api/test', (req, res) => {
  res.json({ message: 'Expressサーバ動いてるよ！' })
})

// app.get('/my-ip', async (req, res) => {
//   const ipRes = await fetch('https://api.ipify.org?format=json')
//   const ipData = await ipRes.json()
//   res.send(`Server's outbound IP is: ${ipData.ip}`)
// })

app.listen(port, () => {
  console.log(`APIサーバが http://localhost:${port} で起動中`)
})
