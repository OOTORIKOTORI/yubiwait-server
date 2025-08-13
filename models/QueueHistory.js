// 追記（置き換えでもOK）
const mongoose = require('mongoose');

const QueueHistorySchema = new mongoose.Schema({
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, required: true },
  customer_name: { type: String, default: '' },
  joined_at: { type: Date, required: true },
  completed_at: { type: Date, required: true },
  wait_minutes: { type: Number, required: true },   // ← 待ち: calledAt - joinedAt
  service_minutes: { type: Number, default: 0 },    // ← 追加: 対応: completedAt - calledAt
}, { timestamps: true });

module.exports = mongoose.model('QueueHistory', QueueHistorySchema);
