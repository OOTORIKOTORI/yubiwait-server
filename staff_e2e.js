// staff_e2e.js — Staff一覧 E2E（並びとステータスを検証） Node18+
//
// 目的:
//  1) waiting の並びが joinedAt 昇順（= 登録順）になっていること
//  2) serving の並びが calledAt 昇順（= 先に呼び出した順）になっていること
//  3) 状態遷移（waiting→serving）を内部通知でドライブしつつ検証
//
// 使い方（PowerShell 例）:
//   $env:BASE_URL="http://127.0.0.1:3000/api"
//   $env:STORE_ID="<24hexのStoreId>"
//   $env:INTERNAL_TOKEN="<内部トークン>"   # dev-reset / dev-flags / notify 用に必須推奨
//   # （もし本番の staff API を使いたい場合）:
//   # $env:STAFF_BEARER="eyJ..."  ← Authorization: Bearer で送る
//   node staff_e2e.js
//
// 備考:
//  - 認証済みの /api/staff が使えない環境では、開発専用の /dev-flags を読み取りとして利用します（内部トークン必須）。
//  - 破壊は dev-reset と internal notify のみ。顧客の削除は行いません。

const API = process.env.BASE_URL || 'http://127.0.0.1:3000/api';
const STORE = process.env.STORE_ID;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const STAFF_BEARER = process.env.STAFF_BEARER || ''; // 任意: /api/staff を試す

function assert(c, msg){ if(!c) throw new Error('ASSERT: ' + msg); console.log('✔', msg); }
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
const rnd = ()=>Math.random().toString(36).slice(2);

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, url: `${API}${path}` };
}

async function register(name){
  const r = await req('POST', `/join/${STORE}`, { name });
  if (r.status !== 200 || !r.json?.customerId) throw new Error('register failed: '+r.status);
  return r.json;
}
async function internalNotify(customerId){
  if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN is required for /notify in this E2E');
  return req('POST', `/join/${STORE}/notify`, { customerId }, { 'x-internal-token': INTERNAL_TOKEN });
}
async function devReset(){
  if (!INTERNAL_TOKEN) return { skipped:true };
  return req('POST', `/join/${STORE}/dev-reset`, {}, { 'x-internal-token': INTERNAL_TOKEN });
}

// Staff一覧 取得（認証付き /api/staff を優先。無ければ dev-flags を使って近似）
async function fetchStaff(){
  // 1) まず /api/staff を試す（STAFF_BEARER がある場合のみ）
  if (STAFF_BEARER) {
    const r = await req('GET', `/staff/${STORE}?status=all`, null, { 'authorization': `Bearer ${STAFF_BEARER}` });
    if (r.status === 200 && r.json) {
      // 想定: { waiting:[{_id, joinedAt, ...}], serving:[{_id, calledAt, ...}] }
      const waiting = (r.json.waiting || []).map((c,i)=>({ customerId: String(c._id || c.customerId), pos:i }));
      const serving = (r.json.serving || []).map((c,i)=>({ customerId: String(c._id || c.customerId), pos:i }));
      return { waiting, serving, source: 'staff' };
    }
    // 401等は dev-flags にフォールバック
  }

  // 2) dev-flags で代替（開発モード）
  const h = INTERNAL_TOKEN ? { 'x-internal-token': INTERNAL_TOKEN } : {};
  const r2 = await req('GET', `/join/${STORE}/dev-flags`, null, h);
  if (r2.status !== 200 || !r2.json) throw new Error('fetch staff failed (dev-flags): '+r2.status);
  // すでに pos が付与されている
  return { waiting: r2.json.waiting, serving: r2.json.serving, source: 'dev-flags' };
}

(async ()=>{
  if (!STORE || STORE.length !== 24) {
    console.error('ERROR: STORE_ID (24hex) を環境変数で指定してください'); process.exit(1);
  }
  console.log('API =', API);
  console.log('STORE_ID =', STORE);

  // 0) クリーン開始
  const reset = await devReset();
  console.log('[RESET]', reset.status ?? '(skip)', reset.json ?? reset);

  // 1) 3人登録（A,B,C）→ waiting の並び（登録順）を検証
  const A = await register('STAFF-A-'+rnd());
  await sleep(50);
  const B = await register('STAFF-B-'+rnd());
  await sleep(50);
  const C = await register('STAFF-C-'+rnd());

  const s1 = await fetchStaff();
  console.log('[S1 src=', s1.source, '] waiting=', s1.waiting.map(w=>w.customerId));
  // 期待: waiting の先頭3が [A,B,C]（登録順）
  const first3 = s1.waiting.slice(0,3).map(w=>w.customerId);
  assert(first3[0] === A.customerId && first3[1] === B.customerId && first3[2] === C.customerId, 'waiting が登録順（A,B,C）');

  // 2) A を serving に昇格（内部通知）→ serving が [A] で先頭になる
  const nA = await internalNotify(A.customerId);
  assert(nA.status === 200, 'A を serving へ昇格');
  await sleep(200); // calledAt 順の安定化

  let s2 = await fetchStaff();
  console.log('[S2] serving=', s2.serving.map(w=>w.customerId), 'waiting=', s2.waiting.map(w=>w.customerId));
  assert(s2.serving.length >= 1, 'serving に少なくとも1名');
  assert(s2.serving[0].customerId === A.customerId, 'serving 先頭が A');

  // 3) B も昇格 → serving の順序が [A,B]（calledAt 昇順）になる
  let promotedB = false;
  try {
    const nB = await internalNotify(B.customerId);
    if (nB.status === 200) promotedB = true;
  } catch {}
  await sleep(250);

  s2 = await fetchStaff();
  console.log('[S3] serving=', s2.serving.map(w=>w.customerId), 'waiting=', s2.waiting.map(w=>w.customerId));

  if (promotedB && s2.serving.length >= 2) {
    // maxServing>=2 の環境向け: calledAt の順で A が先
    assert(s2.serving[0].customerId === A.customerId && s2.serving[1].customerId === B.customerId, 'serving の順序が A, B（calledAt 昇順）');
    if (s2.waiting.length >= 1) {
      assert(s2.waiting[0].customerId === C.customerId, 'waiting の先頭が C（残り）');
    }
  } else {
    // maxServing=1 等でBが昇格できなかった場合: Aのみ serving、waiting は B, C の順を保持
    assert(s2.serving[0].customerId === A.customerId, 'serving 先頭が A（single slot）');
    assert(s2.waiting[0].customerId === B.customerId && s2.waiting[1] && s2.waiting[1].customerId === C.customerId, 'waiting の順序が B, C を維持');
  }

  console.log('\nALL DONE ✅');
})().catch(e=>{ console.error('\nFAILED ❌', e); process.exit(1); });
