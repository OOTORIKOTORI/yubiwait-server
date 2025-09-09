/**
 * AutoCaller (fixed)
 * - Sends 'near' (3人前/1人前) and 'ready' notifications.
 * - Promotes customers from waiting -> serving up to maxServing.
 * - Supports both legacy and new store settings:
 *    - store.autoCallerEnabled | store.autoCaller.enabled
 *    - store.maxServing        | store.autoCaller.maxServing
 *    - store.waitMinutesPerPerson (optional)
 * - Replaces {{n}} / {{minutes}} in templates.
 * - In‑memory de‑dupe for each process start.
 *   (Set DEBUG_AUTOCALLER=1 to enable verbose logs)
 */
const webpush = require('web-push');

// --- tiny logger ---
const DEBUG = ['1','true','on','yes'].includes(String(process.env.DEBUG_AUTOCALLER || '').toLowerCase());
const log  = (...a) => console.log('[AutoCaller]', ...a);
const dlog = (...a) => DEBUG && console.log('[AutoCaller:DEBUG]', ...a);

// --- utils ---
function render(tpl, ctx) {
  if (!tpl) return '';
  return String(tpl).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, k) => {
    const v = ctx[k];
    return (v === undefined || v === null) ? '' : String(v);
  });
}

// In-memory sent flags (reset on server restart)
const sentFlags = {
  near3: new Set(),   // `${storeId}:${customerId}`
  near1: new Set(),
  ready: new Set(),
};
const key = (s, c) => `${s}:${c}`;

// Lazily resolve models to avoid hard path coupling
function getModels() {
  let mongoose;
  try { mongoose = require('mongoose'); } catch (_) {}
  const candidates = [
    () => ({ Store: require('./models/Store'), Customer: require('./models/Customer') }),
    () => (mongoose ? { Store: mongoose.model('Store'), Customer: mongoose.model('Customer') } : null),
  ];
  for (const fn of candidates) {
    try {
      const got = fn();
      if (got && got.Store && got.Customer) return got;
    } catch (_) {}
  }
  throw new Error('AutoCaller: could not resolve Store/Customer models.');
}

async function sendPush(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return true;
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) return false; // expired
    dlog('Push send error', e && e.statusCode, e && e.body);
    return true; // don't prune for transient errors
  }
}

async function pruneInvalidSubscriptions(Customer, customerId, invalidEndpoints) {
  if (!invalidEndpoints || invalidEndpoints.size === 0) return;
  try {
    await Customer.updateOne(
      { _id: customerId },
      { $pull: { subscriptions: { endpoint: { $in: Array.from(invalidEndpoints) } } } }
    ).exec();
    dlog('Pruned', invalidEndpoints.size, 'subs for', customerId.toString());
  } catch (e) {
    dlog('Prune failed', e && e.message);
  }
}

async function notifyCustomer(Store, Customer, store, customer, type, context) {
  const tmpl = (store.notificationTemplate || {})[type] || {};
  const title = render(tmpl.title || (type === 'near' ? 'まもなくご案内です' : 'ご案内の順番になりました'), context);
  const body  = render(tmpl.body  || (type === 'near' ? '後{{n}}人で呼ばれます' : '受付でお名前をお伝えください'), context);

  const subs = []
    .concat(customer.subscriptions || [])        // new schema (array)
    .concat(customer.subscription ? [customer.subscription] : []) // legacy single
    .filter(Boolean);

  if (subs.length === 0) return;

  const payload = { title, body };
  const invalid = new Set();
  await Promise.all(subs.map(async (s) => {
    const ok = await sendPush(s, payload);
    if (!ok && s && s.endpoint) invalid.add(s.endpoint);
  }));
  if (invalid.size) await pruneInvalidSubscriptions(Customer, customer._id, invalid);
}

// --- core per-store processing ---
async function processStore(Store, Customer, store) {
  const enabled = !!(store.autoCallerEnabled || (store.autoCaller && store.autoCaller.enabled));
  if (!enabled) return;

  const maxServing = Number(store.maxServing || (store.autoCaller && store.autoCaller.maxServing) || 1) || 1;
  const minutesPerPerson = Number(store.waitMinutesPerPerson || 0) || 0;

  // current serving count
  const servingCount = await Customer.countDocuments({
    storeId: store._id,
    status: 'serving',
  }).exec();

  // current waiting ordered by arrival
  const waiting = await Customer.find({
    storeId: store._id,
    status: { $in: ['waiting', 'queued', 'queued_wait'] },
  }).sort({ createdAt: 1, _id: 1 }).lean().exec();

  dlog('Store', String(store._id), 'waiting=', waiting.length, 'serving=', servingCount, 'max=', maxServing);

  // --- near notifications (3 & 1 ahead) ---
  for (let i = 0; i < waiting.length; i++) {
    const ahead = servingCount + i;               // absolute position including those already serving
    const remaining = Math.max(0, ahead - (maxServing - 1));
    if (remaining === 3 || remaining === 1) {
      const c = waiting[i];
      const k = key(store._id, c._id);
      const flagSet = (remaining === 3) ? sentFlags.near3 : sentFlags.near1;
      if (!flagSet.has(k)) {
        const ctx = { n: remaining, minutes: minutesPerPerson ? remaining * minutesPerPerson : undefined };
        dlog('send NEAR(', remaining, ') to', k);
        await notifyCustomer(Store, Customer, store, c, 'near', ctx);
        flagSet.add(k);
      }
    }
  }

  // --- promote to serving (and send READY) ---
  const need = Math.max(0, maxServing - servingCount);
  for (let j = 0; j < need; j++) {
    const head = waiting[j];
    if (!head) break;

    const res = await Customer.updateOne(
      { _id: head._id, status: { $in: ['waiting', 'queued', 'queued_wait'] } },
      { $set: { status: 'serving', calledAt: new Date() } }
    ).exec();

    if (res.modifiedCount === 1) {
      const ctx = { n: 0, minutes: 0 };
      dlog('promoted -> serving', String(head._id));
      await notifyCustomer(Store, Customer, store, head, 'ready', ctx);
      sentFlags.ready.add(key(store._id, head._id));
    }
  }
}

// --- scheduler ---
let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const { Store, Customer } = getModels();
    const stores = await Store.find({}).lean().exec();
    for (const s of stores) {
      try {
        await processStore(Store, Customer, s);
      } catch (e) {
        console.error('[AutoCaller] store error:', e && e.message, e && e.stack);
      }
    }
  } catch (e) {
    console.error('[AutoCaller] tick error:', e && e.message, e && e.stack);
  } finally {
    running = false;
  }
}

function start(intervalMs) {
  const ms = Number(intervalMs || process.env.AUTO_CALLER_INTERVAL_MS || process.env.AUTOCALLER_INTERVAL_MS || 10000);
  stop();
  log('start:', ms);
  timer = setInterval(tick, ms);
  setTimeout(tick, 100); // run first tick soon
  return true;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// 既存: start(), stop() の下あたりに追加
async function runOnce() {
  // 内部の tick を一回だけ実行
  await tick();
}

module.exports = { start, stop, runOnce };
