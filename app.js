/* 入荷チェック app.js
 * 1) 伝票テキスト（iPhoneテキスト認識 / Googleレンズでコピー）から13桁コードを抽出
 * 2) カメラで連続読み取り → 照合結果を映像の上に表示 → 自動で次へ
 * 3) 未確認・リスト外を一覧
 * データは localStorage のみに保存（外部送信なし）
 */
(() => {
"use strict";
const APP_VERSION = "1.0.0";
const STORE_KEY = "nyuka-check-v1";
const $ = s => document.querySelector(s);

// ---------- state ----------
let state = load() || emptyState();
let filter = "all";
function emptyState(){ return {meta:{}, items:[], extras:[]}; }
function load(){ try{ const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; }catch(e){ return null; } }
function save(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }catch(e){} }
const isDone = it => it.status === "done" || it.status === "manual";
const remaining = () => state.items.filter(i => !isDone(i)).length;

// ---------- codes ----------
function ean13ok(c){
  if(!/^\d{13}$/.test(c)) return false;
  let t = 0; for(let i=0;i<12;i++) t += (+c[i]) * (i%2 ? 3 : 1);
  return (10 - t%10) % 10 === +c[12];
}
function norm(raw){
  const d = String(raw||"").normalize("NFKC").replace(/\D/g,"");
  return (d.length >= 8 && d.length < 13) ? d.padStart(13,"0") : d;
}
function parsePaste(text){
  const t = String(text||"").normalize("NFKC");
  let codes = t.match(/(?<!\d)\d{13}(?!\d)/g) || [];
  if(!codes.length) codes = (t.match(/(?<!\d)\d{8,12}(?!\d)/g) || []).map(norm);
  const meta = {};
  const m1 = t.match(/移動連番\s*[:：]?\s*(\d+)/); if(m1) meta["移動連番"] = m1[1];
  const m2 = t.match(/移動日\s*[:：]?\s*(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/); if(m2) meta["移動日"] = m2[1];
  const m3 = t.match(/移動元[^\d\n]*(\d+(?:\s*[-ー－]\s*[^\s\d]+)?)/); if(m3) meta["移動元"] = m3[1];
  const m4 = t.match(/移動先[^\d\n]*(\d+(?:\s*[-ー－]\s*[^\s\d]+)?)/); if(m4) meta["移動先"] = m4[1];
  return {codes:[...new Set(codes)], meta};
}

// ---------- render ----------
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function codeHtml(c){
  const m = c.match(/^(0*)(\d*?)(\d{0,4})$/) || ["", "", c, ""];
  return `<span class="dim">${m[1]}</span>${m[2]}<b>${m[3]}</b>`;
}
function render(){
  const meta = state.meta || {};
  const rows = Object.entries(meta).filter(([,v]) => v);
  $("#meta").innerHTML = rows.length ? rows.map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("") : "";
  $("#meta").hidden = !rows.length;

  const n = state.items.length, done = n - remaining();
  const bad = state.items.filter(i => !ean13ok(i.code)).length;
  $("#cnt").innerHTML = `${done}<small> / ${n}</small>`;
  $("#cntSub").textContent = [
    n ? (n - done ? `残り ${n - done} 点` : "すべて確認済") : "",
    state.extras.length ? `リスト外 ${state.extras.length}` : "",
    bad ? `番号要確認 ${bad}` : ""
  ].filter(Boolean).join("　");
  $("#barFill").style.width = n ? (done / n * 100) + "%" : "0";
  $("#startScan").disabled = !n;
  $("#hcount").textContent = `${done} / ${n}`;

  const ul = $("#list"); ul.innerHTML = "";
  state.items.forEach((it, idx) => {
    if(filter === "todo" && isDone(it)) return;
    if(filter === "done" && !isDone(it)) return;
    const li = document.createElement("li");
    li.className = "item" + (isDone(it) ? " isdone" : "");
    let right;
    if(it.editing) right = `<button class="chip todo" type="button" data-save="${idx}">保存</button>`;
    else if(!ean13ok(it.code)) right = `<button class="chip bad" type="button" data-edit="${idx}">要確認</button>`;
    else if(it.status === "done") right = `<button class="chip done" type="button" data-tog="${idx}">確認済</button>`;
    else if(it.status === "manual") right = `<button class="chip manual" type="button" data-tog="${idx}">手動済</button>`;
    else right = `<button class="chip todo" type="button" data-tog="${idx}">未確認</button>`;
    const body = it.editing
      ? `<input type="text" inputmode="numeric" id="edit-${idx}" value="${esc(it.code)}" data-editinput="${idx}" aria-label="番号の修正">`
      : `<span class="code">${codeHtml(it.code)}</span>`;
    li.innerHTML = `<span class="no">${idx+1}</span>${body}${right}`;
    ul.appendChild(li);
  });
  if(!ul.children.length){
    ul.innerHTML = n ? `<li class="empty">該当する商品はありません</li>`
      : `<li class="empty">伝票の番号を貼り付けると、ここにリストが表示されます。<br><button class="btn" type="button" id="demoBtn" style="margin-top:8px">サンプルデータで試す</button></li>`;
  }
  save();
}

// ---------- sound / vibration ----------
let actx;
function unlockAudio(){ try{ actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if(actx.state === "suspended") actx.resume(); }catch(e){} }
function tone(freq, dur, type, when=0){
  if(!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq; g.gain.value = .12;
  o.connect(g); g.connect(actx.destination);
  const t = actx.currentTime + when; o.start(t); o.stop(t + dur);
}
function feedback(kind){
  try{
    if(kind === "ok"){ tone(1320,.10,"sine"); navigator.vibrate && navigator.vibrate(60); }
    else if(kind === "warn"){ tone(880,.12,"triangle"); tone(880,.12,"triangle",.18); navigator.vibrate && navigator.vibrate([80,60,80]); }
    else { tone(300,.40,"square"); navigator.vibrate && navigator.vibrate([200,80,200]); }
  }catch(e){}
}

// ---------- matching ----------
// returns {kind:"ok"|"warn"|"ng", title, code, sub}
function match(raw){
  const d = String(raw||"").normalize("NFKC").replace(/\D/g,"");
  if(!d) return {kind:"ng", title:"番号が読み取れませんでした", code:"", sub:""};
  let target = null;
  if(d.length >= 8){
    const c = norm(d);
    target = state.items.find(i => i.code === c);
    if(!target){
      if(!state.extras.includes(c)) state.extras.push(c);
      render();
      return {kind:"ng", title:"伝票にありません", code:c, sub:"リスト外の商品です"};
    }
  } else if(d.length >= 4){
    const hits = state.items.filter(i => i.code.endsWith(d));
    if(hits.length === 1) target = hits[0];
    else return {kind: hits.length ? "warn" : "ng", title: hits.length ? `下${d.length}桁が ${hits.length} 件に一致` : "一致する番号がありません", code:d, sub: hits.length ? "桁数を増やしてください" : ""};
  } else {
    return {kind:"warn", title:"4桁以上入力してください", code:d, sub:""};
  }
  if(isDone(target)) return {kind:"warn", title:"読み取り済みです", code:target.code, sub:"二重読み取り"};
  target.status = "done"; target.at = Date.now();
  render();
  const left = remaining();
  return {kind:"ok", title: left ? "OK" : "すべて確認しました", code:target.code, sub: left ? `残り ${left} 点` : `全 ${state.items.length} 点 完了`};
}
function flash(r){
  const f = $("#flash"); f.hidden = false; f.className = "flash " + r.kind;
  f.innerHTML = `<span>${esc(r.title)}${r.sub ? "　" + esc(r.sub) : ""}</span>${r.code ? `<span class="code">${esc(r.code)}</span>` : ""}`;
}

// ---------- scanner ----------
const video = $("#video"), freeze = $("#freeze");
const work = document.createElement("canvas");
const wctx = work.getContext("2d", {willReadFrequently:true});
let stream = null, scanning = false, paused = false, timer = null, resumeTimer = null;
let lastCode = "", lastSeen = 0, pendingCode = "", pendingCount = 0;
let detector = null, zxReader = null, zxHints = null, frameNo = 0, wakeLock = null;

async function setupDecoder(){
  if(!detector && "BarcodeDetector" in window){
    try{
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      if(fmts.includes("ean_13")) detector = new window.BarcodeDetector({formats: ["ean_13","ean_8","code_128"].filter(f => fmts.includes(f))});
    }catch(e){ detector = null; }
  }
  if(!zxReader && window.ZXing){
    const Z = window.ZXing;
    zxHints = new Map();
    zxHints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.CODE_128]);
    zxHints.set(Z.DecodeHintType.TRY_HARDER, true);
    zxReader = new Z.MultiFormatReader(); zxReader.setHints(zxHints);
  }
}

// 枠の中央付近を切り出して解析用キャンバスへ
function grab(rotate){
  const vw = video.videoWidth, vh = video.videoHeight;
  if(!vw || !vh) return false;
  const cw = Math.round(vw * .9), ch = Math.round(Math.min(vh * .5, vw * .6));
  const sx = (vw - cw) / 2, sy = (vh - ch) / 2;
  const scale = Math.min(1, 1000 / cw);
  const w = Math.round(cw * scale), h = Math.round(ch * scale);
  if(rotate){ work.width = h; work.height = w; wctx.save(); wctx.translate(h, 0); wctx.rotate(Math.PI/2); wctx.drawImage(video, sx, sy, cw, ch, 0, 0, w, h); wctx.restore(); }
  else { work.width = w; work.height = h; wctx.drawImage(video, sx, sy, cw, ch, 0, 0, w, h); }
  return true;
}
async function decodeFrame(){
  if(detector){
    try{
      const res = await detector.detect(video);
      if(res && res.length) return {text: res[0].rawValue, fmt: res[0].format};
    }catch(e){}
    return null;
  }
  if(!zxReader) return null;
  const Z = window.ZXing;
  const rotate = (frameNo++ % 3) === 2; // 縦向きのバーコードもたまに試す
  if(!grab(rotate)) return null;
  try{
    const lum = new Z.HTMLCanvasElementLuminanceSource(work);
    const r = zxReader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(lum)), zxHints);
    if(r) return {text: r.getText(), fmt: String(r.getBarcodeFormat())};
  }catch(e){ /* not found */ }
  return null;
}

async function loop(){
  if(!scanning || paused) return;
  let got = null;
  if(video.readyState >= 2) got = await decodeFrame();
  if(!scanning || paused) return;
  if(got && got.text){
    const code = norm(got.text);
    const now = Date.now();
    // 直前に処理したコードが映り続けている間は無視
    if(code === lastCode && now - lastSeen < 2500){ lastSeen = now; }
    else {
      // EAN以外は2フレーム連続一致で確定（誤読防止）
      const reliable = /^\d{13}$/.test(code) && ean13ok(code);
      if(!reliable){
        if(code === pendingCode) pendingCount++; else { pendingCode = code; pendingCount = 1; }
      }
      if(reliable || pendingCount >= 2){
        pendingCode = ""; pendingCount = 0;
        lastCode = code; lastSeen = now;
        showVerdict(match(code));
        return;
      }
    }
  }
  timer = setTimeout(loop, detector ? 80 : 60);
}

function showVerdict(r){
  paused = true;
  // 読み取った瞬間の映像を止めて、その上に結果を表示
  try{
    freeze.width = video.videoWidth; freeze.height = video.videoHeight;
    freeze.getContext("2d").drawImage(video, 0, 0);
    freeze.hidden = false;
  }catch(e){}
  const v = $("#verdict");
  v.className = "verdict " + r.kind; v.hidden = false;
  $("#vIcon").textContent = r.kind === "ok" ? "✓" : (r.kind === "warn" ? "!" : "×");
  $("#vTitle").textContent = r.title;
  $("#vCode").textContent = r.code;
  $("#vSub").textContent = r.sub;
  $("#guide").parentElement.hidden = true; $("#hint").hidden = true;
  feedback(r.kind);
  flash(r);
  const allDone = r.kind === "ok" && remaining() === 0;
  $("#vNext").textContent = allDone ? "結果を見る" : "次へ";
  clearTimeout(resumeTimer);
  if(!allDone) resumeTimer = setTimeout(resume, r.kind === "ok" ? 1200 : 2500);
}
function resume(){
  clearTimeout(resumeTimer);
  if(!scanning) return;
  if(state.items.length && remaining() === 0){ stopScan(); showResult(); $("#result").scrollIntoView({behavior:"smooth"}); return; }
  $("#verdict").hidden = true; freeze.hidden = true;
  $("#guide").parentElement.hidden = false; $("#hint").hidden = false;
  lastSeen = Date.now();
  paused = false; loop();
}

async function startScan(){
  unlockAudio();
  await setupDecoder();
  $("#scanner").hidden = false; $("#camError").hidden = true;
  $("#verdict").hidden = true; freeze.hidden = true;
  $("#guide").parentElement.hidden = false; $("#hint").hidden = false;
  document.body.style.overflow = "hidden";
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    return camError("この端末・ブラウザではカメラを使えません。https のURLで開いているか確認してください。番号入力でも照合できます。");
  }
  try{
    stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:"environment"}, width:{ideal:1920}, height:{ideal:1080}}});
  }catch(e){
    return camError(e && e.name === "NotAllowedError"
      ? "カメラの使用が許可されていません。設定でこのアプリ（ブラウザ）のカメラを許可してから、もう一度お試しください。"
      : "カメラを起動できませんでした。他のアプリでカメラを使っていないか確認してください。");
  }
  video.srcObject = stream;
  try{ await video.play(); }catch(e){}
  const track = stream.getVideoTracks()[0];
  try{
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if(caps.focusMode && caps.focusMode.includes("continuous")) await track.applyConstraints({advanced:[{focusMode:"continuous"}]});
    $("#torchBtn").hidden = !caps.torch;
    $("#torchBtn").setAttribute("aria-pressed","false");
  }catch(e){}
  try{ wakeLock = await navigator.wakeLock?.request("screen"); }catch(e){}
  scanning = true; paused = false; lastCode = ""; frameNo = 0;
  loop();
}
function camError(msg){ const el = $("#camError"); el.textContent = msg; el.hidden = false; $("#hint").hidden = true; }
function stopScan(){
  scanning = false; paused = false;
  clearTimeout(timer); clearTimeout(resumeTimer);
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
  try{ wakeLock && wakeLock.release(); }catch(e){} wakeLock = null;
  $("#scanner").hidden = true; document.body.style.overflow = "";
}
$("#startScan").addEventListener("click", startScan);
$("#closeScan").addEventListener("click", stopScan);
$("#vNext").addEventListener("click", e => { e.stopPropagation(); resume(); });
$("#verdict").addEventListener("click", resume);
$("#torchBtn").addEventListener("click", async () => {
  const b = $("#torchBtn"), on = b.getAttribute("aria-pressed") !== "true";
  try{ await stream.getVideoTracks()[0].applyConstraints({advanced:[{torch:on}]}); b.setAttribute("aria-pressed", String(on)); }catch(e){}
});
document.addEventListener("visibilitychange", () => { if(document.hidden && scanning) stopScan(); });

// ---------- manual input ----------
$("#manualForm").addEventListener("submit", e => {
  e.preventDefault(); unlockAudio();
  const v = $("#manualInput").value; $("#manualInput").value = "";
  const r = match(v); flash(r); feedback(r.kind);
});

// ---------- paste ----------
function applyPaste(replace){
  const {codes, meta} = parsePaste($("#pasteBox").value);
  const st = $("#pasteStatus"); st.className = "status";
  if(!codes.length){ st.className = "status err"; st.textContent = "13桁の商品コードが見つかりませんでした。コピーした範囲を確認してください。"; return; }
  let added = 0;
  if(replace){
    state = emptyState();
    state.items = codes.map(code => ({code, status:"todo"})); added = codes.length;
    state.meta = meta;
    $("#result").innerHTML = ""; $("#flash").hidden = true;
  } else {
    const have = new Set(state.items.map(i => i.code));
    codes.forEach(code => { if(!have.has(code)){ state.items.push({code, status:"todo"}); have.add(code); added++; } });
    state.meta = Object.assign({}, state.meta, meta);
  }
  const bad = state.items.filter(i => !ean13ok(i.code)).length;
  st.textContent = `${added} 件を取り込みました（合計 ${state.items.length} 件）。` +
    (bad ? `「要確認」の ${bad} 件は番号が正しくない可能性があります。タップして修正してください。` : "伝票の件数と合っているか確認してください。");
  $("#pasteBox").value = "";
  filter = "all"; syncFilter(); render();
}
$("#pasteReplace").addEventListener("click", () => applyPaste(true));
$("#pasteAppend").addEventListener("click", () => applyPaste(false));

// ---------- list ----------
$("#list").addEventListener("click", e => {
  const t = e.target;
  if(t.id === "demoBtn"){
    state = emptyState();
    state.meta = {"移動連番":"126413（サンプル）","移動日":"2026/10/28","移動元":"30 - 紅輪","移動先":"90"};
    state.items = "757 764 771 788 795 801 818 825 832 849 856 863 870 887 894 900 917 924 931 948 955 962 979 986".split(" ").map(s => ({code:"0000184129"+s, status:"todo"}));
    render(); return;
  }
  if(t.dataset.tog != null){ const it = state.items[+t.dataset.tog]; it.status = isDone(it) ? "todo" : "manual"; render(); }
  else if(t.dataset.edit != null){ state.items[+t.dataset.edit].editing = true; render(); const inp = $("#edit-" + t.dataset.edit); inp && inp.focus(); }
  else if(t.dataset.save != null){ const i = +t.dataset.save, it = state.items[i]; it.code = norm($("#edit-" + i).value) || it.code; delete it.editing; render(); }
});
$("#list").addEventListener("keydown", e => {
  if(e.key === "Enter" && e.target.dataset.editinput != null){ const b = document.querySelector(`[data-save="${e.target.dataset.editinput}"]`); b && b.click(); }
});
function syncFilter(){ document.querySelectorAll(".filters .btn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === filter))); }
document.querySelectorAll(".filters .btn").forEach(b => b.addEventListener("click", () => { filter = b.dataset.f; syncFilter(); render(); }));

// ---------- result ----------
function showResult(){
  const miss = state.items.filter(i => i.status === "todo");
  const man = state.items.filter(i => i.status === "manual");
  const bad = state.items.filter(i => !ean13ok(i.code));
  const ex = state.extras;
  const ok = state.items.length && !miss.length && !ex.length && !bad.length;
  let h = `<div class="rv ${ok ? "ok" : "ng"}">${ok ? `全 ${state.items.length} 点 漏れなし` : `未確認 ${miss.length} 点／リスト外 ${ex.length} 点`}</div>`;
  if(miss.length) h += `<h3>未確認（伝票にあるが読み取っていない）</h3><ul>${miss.map(i => `<li>${esc(i.code)}</li>`).join("")}</ul>`;
  if(ex.length) h += `<h3>リスト外（読み取ったが伝票にない）</h3><ul>${ex.map(c => `<li>${esc(c)}</li>`).join("")}</ul>`;
  if(bad.length) h += `<h3>番号要確認（チェックデジット不一致）</h3><ul>${bad.map(i => `<li>${esc(i.code)}</li>`).join("")}</ul>`;
  if(man.length) h += `<h3>手動で確認済にした商品</h3><ul>${man.map(i => `<li>${esc(i.code)}</li>`).join("")}</ul>`;
  $("#result").innerHTML = h;
}
$("#checkBtn").addEventListener("click", showResult);

// ---------- resets (2回タップで実行) ----------
function twoTap(btn, fn){
  const label = btn.textContent; let armed = false, t;
  btn.addEventListener("click", () => {
    if(armed){ armed = false; clearTimeout(t); btn.textContent = label; fn(); return; }
    armed = true; btn.textContent = "もう一度タップで実行";
    t = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
  });
}
twoTap($("#resetScans"), () => { state.items.forEach(i => { i.status = "todo"; delete i.at; }); state.extras = []; $("#flash").hidden = true; $("#result").innerHTML = ""; render(); });
twoTap($("#resetAll"), () => { state = emptyState(); $("#flash").hidden = true; $("#result").innerHTML = ""; $("#pasteStatus").textContent = ""; render(); });

// ---------- boot ----------
$("#ver").textContent = ` v${APP_VERSION}`;
render();
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
// テスト用フック
window.__nyuka = {match, parsePaste, ean13ok, get state(){ return state; }};
})();
