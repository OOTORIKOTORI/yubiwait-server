const { verifyStaff } = require('../utils/jwt') // パスはプロジェクト構成に合わせて

function authenticateStore(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '認証トークンが必要です' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = verifyStaff(token)
    req.storeId = decoded.storeId
    next()
  } catch (err) {
    return res.status(401).json({ message: 'トークンが無効です' })
  }
}

module.exports = authenticateStore
