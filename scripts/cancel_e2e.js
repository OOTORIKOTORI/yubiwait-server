// cancel_e2e.js — キャンセル本人性 E2E（serving昇格の前提を担保）
// 使い方（PowerShell例）:
//   $env:BASE_URL="http://localhost:3000/api"
//   $env:STORE_ID="あなたの24hex"
//   $env:INTERNAL_TOKEN="内部トークン"   # あれば Test#6 実行
//   node cancel_e2e.js

const API = process.env.BASE_URL || 'http://localhost:3000/api';
const STORE = process.env.STORE_ID;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

if (!STORE || STORE.length !== 24) {
  console.error('ERROR: STORE_ID (24hex) を環境変数で指定してください');
  process.exit(1);
}

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
  return r.json; // { success, message, customerId, cancelToken, ... }
}
async function subscribe(customerId, endpoint) {
  const r = await req('POST', `/join/${STORE}/subscribe`, {
    customerId,
    subscription: { endpoint, keys: { p256dh: 'x', auth: 'y' } },
  });
  if (r.status !== 201) throw new Error(`subscribe failed: ${r.status} ${JSON.stringify(r.json)}`);
}
async function cancelByToken(customerId, cancelToken) {
  return req('DELETE', `/join/${STORE}/cancel`, { customerId, cancelToken });
}
async function cancelByEndpoint(customerId, endpoint) {
  return req('DELETE', `/join/${STORE}/cancel`, { customerId, subscription: { endpoint } });
}
async function internalNotify(customerId) {
  return req('POST', `/join/${STORE}/notify`, { customerId }, { 'x-internal-token': INTERNAL_TOKEN });
}
async function waitingAhead(customerId) {
  // 先行人数（自分より先にjoinしたwaiting数）を取得
  return req('GET', `/join/${STORE}/waiting-time?customerId=${customerId}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('✔', msg);
}

(async () => {
  console.log('API =', API);
  console.log('STORE_ID =', STORE);

  // --- Test#1: token成功 ---
  const a = await register('Alice-' + rnd());
  let r = await cancelByToken(a.customerId, a.cancelToken);
  console.log('[T1] status/body:', r.status, r.json);
  assert(r.status === 200 && r.json?.ok === true, 'tokenでキャンセル成功 (200)');

  // --- Test#2: endpoint成功 ---
  const b = await register('Bob-' + rnd());
  const epB = `https://example.com/push/${rnd()}`;
  await subscribe(b.customerId, epB);
  r = await cancelByEndpoint(b.customerId, epB);
  console.log('[T2] status/body:', r.status, r.json);
  assert(r.status === 200 && r.json?.ok === true, 'endpoint一致でキャンセル成功 (200)');

  // --- Test#3: token不一致→403（※ここで作った Dave を必ず後片付け！） ---
  const c = await register('Carol-' + rnd());
  const d = await register('Dave-' + rnd());
  r = await cancelByToken(c.customerId, d.cancelToken);
  console.log('[T3] status/body:', r.status, r.json);
  assert(r.status === 403, 'トークン不一致で403');
  // 後片付け
  await cancelByToken(c.customerId, c.cancelToken);
  await cancelByToken(d.customerId, d.cancelToken);  // ←これが重要！

  // --- Test#4: endpoint不一致→403 ---
  const e = await register('Eve-' + rnd());
  const epE = `https://example.com/push/${rnd()}`;
  await subscribe(e.customerId, epE);
  r = await cancelByEndpoint(e.customerId, `https://example.com/push/${rnd()}`);
  console.log('[T4] status/body:', r.status, r.json);
  assert(r.status === 403, 'endpoint不一致で403');
  await cancelByToken(e.customerId, e.cancelToken);

  // --- Test#5: token/endpoint無し→400 ---
  const f = await register('Frank-' + rnd());
  r = await req('DELETE', `/join/${STORE}/cancel`, { customerId: f.customerId });
  console.log('[T5] status/body:', r.status, r.json);
  assert(r.status === 400, 'token/endpoint無しで400');
  await cancelByToken(f.customerId, f.cancelToken);

// --- Test#6: servingで自己キャンセル不可→409 ---
if (!INTERNAL_TOKEN) {
  console.log('（INTERNAL_TOKEN 未設定のため Test#6 をスキップ）');
} else {
  const g = await register('Grace-' + rnd());
  // ★ 購読を付与（昇格条件に必要）
  const epG = `https://example.com/push/${rnd()}`;
  await subscribe(g.customerId, epG);

  // 先行人数を確認（0であることが理想）
  const w0 = await waitingAhead(g.customerId);
  console.log('[T6 pre] waiting-time status/body:', w0.status, w0.json);

  // 昇格トリガ
  const n6 = await internalNotify(g.customerId);
  console.log('[T6 notify] status/body:', n6.status, n6.json);
  assert(n6.status === 200, '/notify 実行 200');
  assert(n6.json?.waitingCount === 0, 'waitingCount==0 で呼出し（serving昇格）');

  // 少し待つ（DB反映）
  await sleep(200);

  // 自己キャンセル（409期待）
  const t6 = await cancelByToken(g.customerId, g.cancelToken);
  console.log('[T6 cancel] status/body:', t6.status, t6.json);
  assert(t6.status === 409, 'servingで自己キャンセル不可 409');
}

  // --- Test#7: store mismatch→404 ---
  const h = await register('Heidi-' + rnd());
  const FAKE_STORE = '000000000000000000000000';
  r = await req('DELETE', `/join/${FAKE_STORE}/cancel`, { customerId: h.customerId, cancelToken: h.cancelToken });
  console.log('[T7] status/body:', r.status, r.json);
  assert(r.status === 404, 'store mismatch で404');
  await cancelByToken(h.customerId, h.cancelToken);

  console.log('\nALL DONE ✅');
})().catch(err => {
  console.error('\nFAILED ❌', err);
  process.exit(1);
});
