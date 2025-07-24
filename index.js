const express = require('express')
const cors = require('cors')
require('dotenv').config()

const connectDB = require('./db')
const joinRoutes = require('./routes/join')
const adminRoutes = require('./routes/admin')
const storeRoutes = require('./routes/store')

const app = express()
const port = process.env.PORT || 3000

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8080', // ← これ追加！
  'https://yubiwait-client.onrender.com'
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

// DB接続！
connectDB()

const webpush = require('web-push');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ルーティング
app.use('/api/join', joinRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/store', storeRoutes)

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
