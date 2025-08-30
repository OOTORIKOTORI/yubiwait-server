// middlewares/validate.js
const { z } = require('zod');

/**
 * ObjectId(…) / クォート / 不可視文字 / 余計な断片が混ざっても
 * 「最初に現れる 24-hex の塊」を安全に取り出してから厳密検証する。
 *
 * 例:
 * - '687e4062912938dd2558db4f'            -> OK
 * - '"687e4062912938dd2558db4f"'          -> OK
 * - "ObjectId('687e4062912938dd2558db4f')"-> OK
 * - '687e4062912938dd2558db4f?status=all' -> OK（先頭の24hexを抽出）
 */
const id24 = z.preprocess((v) => {
  if (v == null) return v;
  let s = String(v).trim();

  // ObjectId("...") / ObjectId('...') を許容
  const mObj = s.match(/^ObjectId\((.+)\)$/i);
  if (mObj) s = mObj[1];

  // 先頭末尾のクォートを除去
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  // 文字列中から 24-hex を最初の1個だけ抽出（クエリ断片・不可視文字対策）
  const m24 = s.match(/[0-9a-fA-F]{24}/);
  if (m24) s = m24[0];

  return s;
}, z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be 24-hex ObjectId'));

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const coerceInt = (min, max) =>
  z.coerce.number().int().min(min).max(max);

const coerceBool = z.preprocess((v) => {
  if (typeof v === 'string') return v === 'true' || v === '1';
  return !!v;
}, z.boolean());

function toHttp400(err) {
  const fieldErrors = {};
  const formErrors = [];
  for (const issue of err.issues) {
    const path = issue.path.join('.');
    if (path) {
      (fieldErrors[path] ||= []).push(issue.message);
    } else {
      formErrors.push(issue.message);
    }
  }
  return { error: 'Bad Request', fieldErrors, formErrors };
}

// 失敗時にデバッグログを出したい場合は環境変数 VALIDATE_DEBUG=1 を設定
const DEBUG = process.env.VALIDATE_DEBUG === '1';

const validate = (schema) => (req, res, next) => {
  try {
    const input = { params: req.params, query: req.query, body: req.body, headers: req.headers };
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      if (DEBUG) {
        console.warn('[validate] 400', {
          url: req.originalUrl,
          method: req.method,
          rawParams: req.params,
          rawQuery: req.query,
          errors: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
        });
      }
      return res.status(400).json(toHttp400(parsed.error));
    }
    if (parsed.data.params)  req.params  = parsed.data.params;
    if (parsed.data.query)   req.query   = parsed.data.query;
    if (parsed.data.body)    req.body    = parsed.data.body;
    if (parsed.data.headers) req.headers = parsed.data.headers;
    next();
  } catch (e) {
    console.error('validate middleware error:', e);
    res.status(500).json({ error: 'Validation middleware error' });
  }
};

module.exports = { z, validate, id24, dateOnly, coerceInt, coerceBool };
