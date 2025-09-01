// autocaller_e2e.js — AutoCaller E2E（非破壊プローブ版） Node18+
// 目的: 待ち0で受付 → AutoCallerにより serving 昇格 → cancel=409 を検知
// ※ waiting中に正しいトークンでDELETEすると客が消えるので、"わざと間違ったトークン"で判定する

const API = process.env.BASE_URL || 'http://127.0.0.1:3000/api';
const STORE = process.env.STORE_ID;
const TIMEOUT = Number(process.env.AUTOCALLER_TIMEOUT_MS || 20000); // 既定20s
const POLL = Number(process.env.AUTOCALLER_POLL_MS || 600);        // 既定0.6s
const WITH_SUBSCRIBE = process.env.AUTOCALLER_SUBSCRIBE === '1';   // 必要なら購読も付与

async function req(method, path, body, headers = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, url };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2);

async function register(name) {
  const r = await req('POST', `/join/${STORE}`, { name });
  if (r.status !== 200 || !r.json?.customerId) {
    throw new Error(`register failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json; // { customerId, cancelToken, ... }
}
async function subscribe(customerId, endpoint) {
  const r = await req('POST', `/join/${STORE}/subscribe`, {
    customerId,
    subscription: { endpoint, keys: { p256dh: 'x', auth: 'y' } },
  });
  if (r.status !== 201) throw new Error(`subscribe failed: ${r.status} ${JSON.stringify(r.json)}`);
}
async function waitingTime(customerId) {
  return req('GET', `/join/${STORE}/waiting-time?customerId=${customerId}`);
}
async function cancelByToken(customerId, cancelToken) {
  return req('DELETE', `/join/${STORE}/cancel`, { customerId, cancelToken });
}
function assert(c, msg) { if (!c) throw new Error('ASSERT: ' + msg); console.log('✔', msg); }

(async () => {
  if (!STORE || STORE.length !== 24) {
    console.error('ERROR: STORE_ID (24hex) を環境変数で指定してください'); process.exit(1);
  }
  console.log('API =', API);
  console.log('STORE_ID =', STORE);

  // 1) 先頭（待ち0）で客を1人登録
  const a = await register('AC-A-' + rnd());
  console.log('[T0] registered A:', a.customerId);

  if (WITH_SUBSCRIBE) {
    const ep = `https://example.com/push/${rnd()}`;
    await subscribe(a.customerId, ep);
    console.log('[T0] subscribed A:', ep);
  }

  // 事前チェック: 自分より前がいないこと
  const w0 = await waitingTime(a.customerId);
  console.log('[T0] waiting-time:', w0.status, w0.json);
  assert(w0.status === 200, 'waiting-time 200');
  if (w0.json.waitingCount !== 0) {
    console.log('SKIP: 既に待機があるため前提を満たさず終了（waitingCount=', w0.json.waitingCount, '）');
    process.exit(0);
  }

  // 2) AutoCallerの昇格を非破壊に検知（間違いトークンで /cancel をポーリング）
  const t0 = Date.now();
  let promoted = false;
  while (Date.now() - t0 < TIMEOUT) {
    const r = await cancelByToken(a.customerId, '__WRONG_TOKEN__'); // ←ここ重要
    if (r.status === 409) { // serving中は自己キャンセル不可
      console.log('[T1] cancel-by-token (wrong):', r.status, r.json);
      promoted = true;
      break;
    }
    // 403などはまだwaitingを示す。少し待って再試行。
    await sleep(POLL);
  }
  assert(promoted, 'AutoCaller により serving 昇格（cancel=409）');

  // 3) 追加観測（任意）— もう数人並べて尾の客の待ち人数の推移を見る
  const mk = async (label) => {
    const x = await register(label + '-' + rnd());
    if (WITH_SUBSCRIBE) await subscribe(x.customerId, `https://example.com/push/${rnd()}`);
    return x;
  };
  const b = await mk('AC-B');
  const c = await mk('AC-C');
  const d = await mk('AC-D');

  console.log('[OBS] Dの待ち人数を観測（2回）');
  for (let i = 0; i < 2; i++) {
    const wd = await waitingTime(d.customerId);
    console.log(`  [OBS${i}] waitingCount=${wd.json?.waitingCount}, estimated=${wd.json?.estimatedMinutes}`);
    await sleep(6000);
  }

  console.log('\nALL DONE ✅');
})().catch(err => {
  console.error('\nFAILED ❌', err);
  process.exit(1);
});
