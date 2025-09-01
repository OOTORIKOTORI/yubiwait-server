// models/AdminUser.js
const mongoose = require('mongoose');

const AdminUserSchema = new mongoose.Schema({
  email: { type: String, required: true },
  password_hash: { type: String, required: true },
  store_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true }],
  role: { type: String, enum: ['owner', 'manager'], default: 'owner' },
}, { timestamps: true });

module.exports = mongoose.model('AdminUser', AdminUserSchema);
