const express = require('express')
const cors = require('cors')
require('dotenv').config()

const connectDB = require('./db')
const joinRoutes = require('./routes/join')
const adminRoutes = require('./routes/admin')

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// DB接続！
connectDB()

// ルーティング
app.use('/api/join', joinRoutes)
app.use('/api/admin', adminRoutes)

app.get('/api/test', (req, res) => {
  res.json({ message: 'Expressサーバ動いてるよ！' })
})

app.listen(port, () => {
  console.log(`APIサーバが http://localhost:${port} で起動中`)
})
