// middlewares/dev.js
function devOnly(req, res, next) {
  // 本番では存在しないことにする（情報を漏らさないため 404）
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not Found' });
  }
  next();
}

module.exports = { devOnly };
