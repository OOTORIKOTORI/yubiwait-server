const jwt = require('jsonwebtoken')
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key'

function authenticateStore(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '認証トークンが必要です' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.storeId = decoded.storeId
    next()
  } catch (err) {
    return res.status(401).json({ message: 'トークンが無効です' })
  }
}

module.exports = authenticateStore
