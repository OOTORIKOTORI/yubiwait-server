const mongoose = require('mongoose')
require('dotenv').config()

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    })
    console.log('MongoDB接続成功！')
  } catch (err) {
    console.error('MongoDB接続失敗:', err)
  }
}

module.exports = connectDB
