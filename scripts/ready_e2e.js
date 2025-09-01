// ready_e2e.js — ready(0) が一度だけ付くかのE2E（非破壊） Node18+
//
// 使い方（PowerShell等）:
//   $env:BASE_URL="http://127.0.0.1:3000/api"
//   $env:STORE_ID="<24hexのStoreId>"
//   # 内部トークン（dev-flags / dev-reset 使用時に必須）
//   $env:INTERNAL_TOKEN="<内部トークン>"
//   # Optional: AUTO_CALLER_INTERVAL_MS はサーバ側で 1000ms 等に短縮しておくと早い
//   node ready_e2e.js

const API = process.env.BASE_URL || 'http://127.0.0.1:3000/api';
const STORE = process.env.STORE_ID;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const TIMEOUT = Number(process.env.READY_TIMEOUT_MS || 20000);
const POLL = Number(process.env.READY_POLL_MS || 600);

async function req(method, path, body, headers = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, url };
}
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
const rnd = ()=>Math.random().toString(36).slice(2);

async function register(name) {
  const r = await req('POST', `/join/${STORE}`, { name });
  if (r.status !== 200 || !r.json?.customerId) {
    throw new Error(`register failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json; // { customerId, cancelToken, ... }
}
async function waitingTime(customerId) {
  return req('GET', `/join/${STORE}/waiting-time?customerId=${customerId}`);
}
async function cancelWrongToken(customerId) {
  // 間違いトークンで状態だけ確認（waiting:403 / serving:409）
  return req('DELETE', `/join/${STORE}/cancel`, { customerId, cancelToken: '__WRONG__' });
}
async function devFlags() {
  if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN is required for dev-flags');
  return req('GET', `/join/${STORE}/dev-flags`, null, { 'x-internal-token': INTERNAL_TOKEN });
}
async function devReset() {
  if (!INTERNAL_TOKEN) return { skipped: true };
  return req('POST', `/join/${STORE}/dev-reset`, {}, { 'x-internal-token': INTERNAL_TOKEN });
}
function assert(c, msg){ if(!c) throw new Error('ASSERT: '+msg); console.log('✔', msg); }

(async()=>{
  if (!STORE || STORE.length !== 24) {
    console.error('ERROR: STORE_ID (24hex) を環境変数で指定してください'); process.exit(1);
  }
  console.log('API =', API);
  console.log('STORE_ID =', STORE);

  // 0) 行列クリア（開発専用）
  const reset = await devReset();
  console.log('[RESET]', reset.status ?? '(skip)', reset.json ?? reset);

  // 1) 先頭（待ち0）で1人登録
  const a = await register('READY-A-' + rnd());
  const wt = await waitingTime(a.customerId);
  console.log('[T0] waiting-time:', wt.status, wt.json);
  assert(wt.status === 200, 'waiting-time 200');
  assert(wt.json?.waitingCount === 0, '先行待ち0で開始');

  // 2) AutoCaller による昇格（serving）を待つ：cancel(wrong)=409 で判定（非破壊）
  const t0 = Date.now();
  let promoted = false;
  while (Date.now() - t0 < TIMEOUT) {
    const r = await cancelWrongToken(a.customerId);
    if (r.status === 409) { // serving自己キャンセル不可
      console.log('[T1] cancel(wrong):', r.status, r.json);
      promoted = true;
      break;
    }
    await sleep(POLL);
  }
  assert(promoted, 'AutoCaller により serving 昇格（409検知）');

  // 3) dev-flags で serving 中のAに flag=0 が一度だけ付与されていることを確認
  const f1 = await devFlags();
  if (f1.status !== 200) throw new Error('dev-flags failed: '+f1.status);
  const s1 = f1.json.serving || [];
  const a1 = s1.find(x => x.customerId === a.customerId);
  assert(a1, 'A が serving リストに存在');
  const set1 = [...new Set(a1.notificationFlags || [])];
  console.log('[FLAGS1] A:', set1);
  assert(set1.includes(0), 'A に flag=0 が付与');

  // 4) しばらく待って再読（同じ人に 0 が重複しない = 一度だけ）
  await sleep(3000);
  const f2 = await devFlags();
  const s2 = f2.json.serving || [];
  const a2 = s2.find(x => x.customerId === a.customerId);
  assert(a2, 'A が引き続き serving');
  const set2 = [...new Set(a2.notificationFlags || [])];
  console.log('[FLAGS2] A:', set2);
  assert(JSON.stringify(set1) === JSON.stringify(set2), '同じ人への ready(0) が再付与されていない（一度だけ）');

  console.log('\nALL DONE ✅');
})().catch(e=>{ console.error('\nFAILED ❌', e); process.exit(1); });
