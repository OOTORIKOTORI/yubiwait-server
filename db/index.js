const mongoose = require('mongoose');

// Connection event logs (optional but helpful)
mongoose.connection.on('connected', () => console.log('[MongoDB] connected'));
mongoose.connection.on('error', (e) => console.error('[MongoDB] error:', e));
mongoose.connection.on('disconnected', () => console.error('[MongoDB] disconnected'));

async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URL が未設定です');

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      // family: 4, // ← IPv6で詰まる環境なら一時的に有効化
    });
    console.log('MongoDB接続成功！');
  } catch (err) {
    console.error('MongoDB接続失敗:', err);
    throw err; // ← ここ重要：呼び出し元に失敗を伝える
  }
}

module.exports = connectDB;
