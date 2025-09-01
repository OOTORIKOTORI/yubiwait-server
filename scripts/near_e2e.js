// near_e2e.js — 近接通知E2E（ポジション基準・非破壊） Node18+
// 実行例:
//   $env:BASE_URL="http://127.0.0.1:3000/api"
//   $env:STORE_ID="<24hex>"
//   $env:INTERNAL_TOKEN="<内部トークン>"   # あると安定（reset & block可）
//   node near_e2e.js

const API = process.env.BASE_URL || 'http://127.0.0.1:3000/api';
const STORE = process.env.STORE_ID;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const TIMEOUT = Number(process.env.NEAR_TIMEOUT_MS || 20000);
const POLL = Number(process.env.NEAR_POLL_MS || 600);

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
  return r.json;
}
async function internalNotify(customerId) {
  return req('POST', `/join/${STORE}/notify`, { customerId }, { 'x-internal-token': INTERNAL_TOKEN });
}
async function devFlags() {
  const headers = INTERNAL_TOKEN ? { 'x-internal-token': INTERNAL_TOKEN } : {};
  return req('GET', `/join/${STORE}/dev-flags`, null, headers);
}
async function devReset() {
  if (!INTERNAL_TOKEN) return { skipped: true };
  return req('POST', `/join/${STORE}/dev-reset`, {}, { 'x-internal-token': INTERNAL_TOKEN });
}
function assert(c,msg){ if(!c) throw new Error('ASSERT: '+msg); console.log('✔', msg); }

(async()=>{
  if (!STORE || STORE.length !== 24) {
    console.error('ERROR: STORE_ID (24hex) を環境変数で指定してください'); process.exit(1);
  }
  console.log('API =', API);
  console.log('STORE_ID =', STORE);

  // 0) クリーン開始（内部トークンがある場合）
  if (INTERNAL_TOKEN) {
    const r = await devReset();
    console.log('[RESET]', r.status, r.json || r);
  } else {
    console.log('(INTERNAL_TOKENなし: 既存行列が残っていてもポジション基準で検証します)');
  }

  // 0.5) 昇格ブロック（任意）：serving枠を埋めてnear観測が安定するように
  if (INTERNAL_TOKEN) {
    for (let i=0;i<2;i++){
      const p = await register('BLOCK-'+rnd());
      const n = await internalNotify(p.customerId);
      console.log(`[BLOCK] status=${n.status}`, n.json);
    }
  }

  // 1) 新規に5人追加（先頭A〜E）
  const regs = [];
  for (const label of ['A','B','C','D','E']) {
    regs.push(await register('NEAR-'+label+'-'+rnd()));
  }
  console.log('[REG] ids:', regs.map(r=>r.customerId).join(', '));

  // 1.5) 現在のwaitingスナップショットを取得→ pos=1 と pos=3 のIDをアンカーに採用
  const f0 = await devFlags();
  if (f0.status !== 200) throw new Error('dev-flags failed: '+f0.status);
  const waiting0 = f0.json.waiting;
  if (waiting0.length < 4) {
    console.log('現時点waitingが4人未満。AutoCallerのtickを待つためスリープ'); 
    await sleep(1000);
  }
  const f1 = await devFlags();
  const w1 = f1.json.waiting;
  const pick = (pos)=> w1.find(w=>w.pos===pos)?.customerId;
  const idPos1 = pick(1);
  const idPos3 = pick(3);
  console.log('[ANCHOR] pos1=', idPos1, 'pos3=', idPos3);
  assert(idPos1 && idPos3, 'pos=1/3 のアンカーが取得できた');

  // 2) near付与を待つ（pos1→flag=1, pos3→flag=3）
  const t0 = Date.now();
  let got1=false, got3=false, flags1=null, flags3=null;
  while (Date.now()-t0 < TIMEOUT) {
    const f = await devFlags();
    if (f.status !== 200) throw new Error('dev-flags failed: '+f.status);
    const w = f.json.waiting;
    const v1 = w.find(x=>x.customerId===idPos1);
    const v3 = w.find(x=>x.customerId===idPos3);
    got1 = !!(v1 && v1.notificationFlags?.includes(1));
    got3 = !!(v3 && v3.notificationFlags?.includes(3));
    if (got1 && got3) { flags1=v1.notificationFlags.slice(); flags3=v3.notificationFlags.slice(); break; }
    await sleep(POLL);
  }
  assert(got1 && got3, 'pos1に1 & pos3に3 が付与');

  // 3) 少し待って“同じ人に再付与されない”ことを確認（フラグ集合が変わらない）
  await sleep(3000);
  const f2 = await devFlags();
  const w2 = f2.json.waiting;
  const vv1 = w2.find(x=>x.customerId===idPos1);
  const vv3 = w2.find(x=>x.customerId===idPos3);
  assert(vv1 && vv3, 'アンカー2名がまだwaitingに存在'); // 昇格ブロック中ならOK
  const same1 = JSON.stringify([...new Set(vv1.notificationFlags)]) === JSON.stringify([...new Set(flags1)]);
  const same3 = JSON.stringify([...new Set(vv3.notificationFlags)]) === JSON.stringify([...new Set(flags3)]);
  assert(same1 && same3, '同じ人に near フラグが再付与されていない（一度だけ）');

  console.log('\nALL DONE ✅');
})().catch(e=>{ console.error('\nFAILED ❌', e); process.exit(1); });
