const mongoose = require('mongoose');
const Customer = require('./models/Customer');
const Store = require('./models/Store');
const webpush = require('web-push');

const DEBUG = process.env.DEBUG_AUTOCALLER === '1';

function asObjectId(v) {
  if (v instanceof mongoose.Types.ObjectId) return v;
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return v; // 失敗時はそのまま（まず無い想定）
  }
}

async function sendPush(customer, store, type) {
  if (!customer?.subscription) return;

  const nt = (store?.notificationTemplate || {});
  const title = type === 'ready'
    ? (nt.ready?.title || 'ご案内の順番になりました')
    : (nt.near?.title || 'まもなくご案内です');
  const body = type === 'ready'
    ? (nt.ready?.body || 'スタッフにお名前をお伝えください。')
    : (nt.near?.body || 'まもなくお呼びします。少々お待ちください。');

  const storeIdStr = String(store?._id || customer.storeId);
  const payload = JSON.stringify({
    type,
    title,
    body,
    url: `/join/${storeIdStr}`
  });

  try {
    await webpush.sendNotification(customer.subscription, payload);
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      // 無効購読は掃除
      await Customer.updateOne({ _id: customer._id }, { $unset: { subscription: "" } });
    } else {
      console.error('push error:', e);
    }
  }
}

/**
 * 1店舗を処理：
 * - waiting 上位の near 通知（ahead=3,1）を一度だけ送る
 * - 同時枠に空きがあれば waiting 先頭を serving に昇格（ready 通知）
 */
async function processStore(store) {
  // 店舗ごとの ON/OFF（未設定=ON）
  if (store.autoCallerEnabled === false) return;

  // storeId の型互換（ObjectId/文字列どちらのドキュメントにも当てる）
  const sidObj = asObjectId(store._id);
  const idQuery = { $in: [sidObj, String(sidObj)] };

  // waiting を上位4件だけ（0/1/2/3人前までの near 判定に十分）
  const waiting = await Customer.find({ storeId: idQuery, status: 'waiting' })
    .sort({ joinedAt: 1 })
    .limit(4)
    .lean();

  // near 通知（重複防止: notificationFlags に 3,1 を記録）
  for (let i = 0; i < waiting.length; i++) {
    const ahead = i; // 自分より前の waiting 人数
    if (ahead === 3 || ahead === 1) {
      const c = waiting[i];
      const flags = new Set(c.notificationFlags || []);
      if (!flags.has(ahead)) {
        await sendPush(c, store, 'near');
        await Customer.updateOne({ _id: c._id }, { $addToSet: { notificationFlags: ahead } });
      }
    }
  }

  // 同時枠（店舗設定 > env > 既定=1）
  const maxServing = Number((store.maxServing ?? process.env.MAX_SERVING ?? 1));
  const servingCount = await Customer.countDocuments({ storeId: idQuery, status: 'serving' });

  if (DEBUG) {
    console.log('[AutoCaller]',
      String(sidObj),
      `waiting=${waiting.length}`,
      `serving=${servingCount}`,
      `max=${maxServing}`
    );
  }

  if (servingCount >= maxServing) return;

  // 先頭がいれば ready（waiting→serving + calledAt + ready Push + flag 0）
  const head = waiting[0];
  if (!head) return;

  const res = await Customer.updateOne(
    { _id: head._id, status: 'waiting' }, // 競合時の二重昇格防止
    { $set: { status: 'serving', calledAt: new Date() }, $addToSet: { notificationFlags: 0 } }
  );
  if (res.modifiedCount === 1) {
    const fresh = await Customer.findById(head._id).lean();
    await sendPush(fresh, store, 'ready');
  }
}

let running = false;
async function tick() {
  // 未接続(1=connected)以外なら処理しない
  if (mongoose.connection.readyState !== 1) return;
  if (running) return;

  running = true;
  try {
    const stores = await Store.find(
      {},
      { _id: 1, notificationTemplate: 1, autoCallerEnabled: 1, maxServing: 1 }
    ).lean();

    for (const s of stores) {
      await processStore(s);
    }
  } catch (e) {
    console.error('autoCaller tick error:', e);
  } finally {
    running = false;
  }
}

function startAutoCaller(options = {}) {
  const intervalMs = Number(process.env.AUTO_CALLER_INTERVAL_MS || options.intervalMs || 10_000);
  console.log('[AutoCaller] start:', intervalMs);
  setInterval(tick, intervalMs);
  tick(); // 初回即時
}

module.exports = { startAutoCaller };
