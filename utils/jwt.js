// utils/jwt.js
const jwt = require('jsonwebtoken');

// 既存の動作を壊さないため、まずは STAFF_JWT_SECRET に JWT_SECRET をフォールバック
const STAFF_JWT_SECRET = process.env.STAFF_JWT_SECRET || process.env.JWT_SECRET || 'dev_secret_key';
// Admin 用は分離（本番では必ず環境変数で設定）
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'change-me-admin';

const signStaff = (payload, opts = { expiresIn: '2h' }) =>
  jwt.sign(payload, STAFF_JWT_SECRET, opts);
const verifyStaff = (token) => jwt.verify(token, STAFF_JWT_SECRET);

const signAdmin = (payload, opts = { expiresIn: '12h' }) =>
  jwt.sign(payload, ADMIN_JWT_SECRET, opts);
const verifyAdmin = (token) => jwt.verify(token, ADMIN_JWT_SECRET);

module.exports = { signStaff, verifyStaff, signAdmin, verifyAdmin };
