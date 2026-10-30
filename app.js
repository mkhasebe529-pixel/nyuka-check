/* 入荷チェック app.js
 * 1) 伝票を撮影 → 端末内の文字認識（Tesseract）で13桁コードを抽出（貼り付けも可）
 * 2) カメラで連続読み取り → 照合結果を映像の上に表示 → 自動で次へ
 * 3) 未確認・リスト外を一覧
 * データは localStorage のみに保存（外部送信なし）
 */
(() => {
"use strict";
const APP_VERSION = "1.5.0";
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
  $("#ocrNum").textContent = n;
  $("#ocrCount").classList.toggle("n3", n >= 100);
  $("#ocrCount").hidden = !n;
  $("#docAddBtn").hidden = !n;
  const ns = $("#nextStep"); ns.classList.toggle("done", !!n && done === n && !state.extras.length);
  let nTitle, nSub, nIcon;
  if(!n){ nIcon = "1"; nTitle = "伝票を撮影してください"; nSub = "下の「伝票を撮影」を押すとカメラが開きます"; }
  else if(bad){ nIcon = "!"; nTitle = `番号の確認が ${bad} 件あります`; nSub = "リストの「要確認」をタップして、写真を見ながら直してください"; }
  else if(!done){ nIcon = "2"; nTitle = `${n} 件を読み取りました`; nSub = "伝票の行数と合っていれば「連続読み取りを開始」"; }
  else if(done < n){ nIcon = "2"; nTitle = `残り ${n - done} 点`; nSub = "「連続読み取りを開始」で続きを読み取れます"; }
  else { nIcon = "3"; nTitle = state.extras.length ? `全 ${n} 点確認済（リスト外 ${state.extras.length} 点）` : `全 ${n} 点 確認済`; nSub = "「照合結果を表示」で最終確認してください"; }
  ns.innerHTML = `<span class="nicon">${nIcon === "3" && !state.extras.length ? "✓" : nIcon}</span><span>${esc(nTitle)}<small>${esc(nSub)}</small></span>`;
  $("#hcount").textContent = `${done} / ${n}`;

  const ul = $("#list"); ul.innerHTML = "";
  state.items.forEach((it, idx) => {
    if(filter === "todo" && isDone(it)) return;
    if(filter === "done" && !isDone(it)) return;
    const li = document.createElement("li");
    li.className = "item" + (isDone(it) ? " isdone" : "");
    let right;
    if(it.editing) right = `<span class="editbtns"><button class="chip todo" type="button" data-save="${idx}">保存</button><button class="chip bad" type="button" data-del="${idx}">削除</button></span>`;
    else if(!ean13ok(it.code)) right = `<button class="chip bad" type="button" data-edit="${idx}">要確認</button>`;
    else if(it.status === "done") right = `<button class="chip done" type="button" data-tog="${idx}">確認済</button>`;
    else if(it.status === "manual") right = `<button class="chip manual" type="button" data-tog="${idx}">手動済</button>`;
    else right = `<button class="chip todo" type="button" data-tog="${idx}">未確認</button>`;
    const body = it.editing
      ? `<input type="text" inputmode="numeric" id="edit-${idx}" value="${esc(it.code)}" data-editinput="${idx}" aria-label="番号の修正">`
      : `<span class="code" data-edit="${idx}" role="button" tabindex="0" title="タップで修正・削除">${codeHtml(it.code)}</span>`;
    const snip = (!ean13ok(it.code) && it.snip) ? `<img class="snip" src="${it.snip}" alt="伝票のこの番号の部分">` : "";
    li.innerHTML = `<span class="no">${idx+1}</span><span class="body">${body}${snip}</span>${right}`;
    ul.appendChild(li);
  });
  if(!ul.children.length){
    ul.innerHTML = n ? `<li class="empty">該当する商品はありません</li>`
      : `<li class="empty">伝票を撮影すると、ここに商品コードの一覧が表示されます。<br><button class="btn" type="button" id="demoBtn" style="margin-top:8px">サンプルデータで試す</button></li>`;
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

// ---------- 伝票の文字認識（端末内・Tesseract） ----------
let ocrWorkerPromise = null;
function abs(p){ return new URL(p, location.href).href; }
function getOcrWorker(){
  if(!ocrWorkerPromise){
    if(!window.Tesseract) return Promise.reject(new Error("文字認識を読み込めませんでした"));
    ocrWorkerPromise = window.Tesseract.createWorker("eng", 1, {
      workerPath: abs("vendor/tesseract/worker.min.js"),
      corePath: abs("vendor/tesseract/"),
      langPath: abs("vendor/tesseract/lang"),
      gzip: true,
      cacheMethod: "none", // 認識データはアプリのキャッシュ(sw.js)だけに保存し、二重保存しない
      logger: m => { if(ocrProgress) ocrProgress(m); }
    }).then(async w => { await w.setParameters({tessedit_pageseg_mode: "11"}); return w; })
      .catch(e => { ocrWorkerPromise = null; throw e; });
  }
  return ocrWorkerPromise;
}
let ocrProgress = null;

// 画像をグレースケール＋コントラスト補正して指定幅へ
function prepCanvas(im, width, enhance=true){
  const s = Math.min(1, width / im.naturalWidth);
  const w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", {willReadFrequently:true});
  ctx.drawImage(im, 0, 0, w, h);
  if(!enhance) return cv;
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const hist = new Uint32Array(256);
  for(let i=0;i<d.length;i+=4){ const g = (d[i]*299 + d[i+1]*587 + d[i+2]*114) / 1000 | 0; d[i] = g; hist[g]++; }
  const n = w*h; let lo = 0, hi = 255, acc = 0;
  for(let i=0;i<256;i++){ acc += hist[i]; if(acc > n*0.01){ lo = i; break; } }
  acc = 0; for(let i=255;i>=0;i--){ acc += hist[i]; if(acc > n*0.01){ hi = i; break; } }
  const k = 255 / Math.max(1, hi - lo);
  for(let i=0;i<d.length;i+=4){ const v = Math.max(0, Math.min(255, (d[i]-lo)*k)); d[i] = d[i+1] = d[i+2] = v; }
  ctx.putImageData(img, 0, 0);
  return cv;
}
const OCR_FIX = {"O":"0","o":"0","Q":"0","D":"0","l":"1","I":"1","i":"1","|":"1","!":"1","S":"5","s":"5","B":"8","Z":"2","z":"2"};
function ocrCodes(data, cv){
  const out = [];
  for(const w of (data.words || [])){
    const raw = String(w.text || "");
    const digits = (raw.match(/\d/g) || []).length;
    if(digits < 9) continue;
    const fixed = raw.split("").map(c => OCR_FIX[c] ?? c).join("").replace(/[^\d]/g, "");
    if(fixed.length < 12 || fixed.length > 13) continue;
    out.push({code: fixed.length === 12 ? fixed : fixed, bbox: w.bbox, cv});
  }
  return out;
}
function snippet(c){
  try{
    const b = c.bbox, cv = c.cv, pad = 8;
    const x = Math.max(0, b.x0 - pad), y = Math.max(0, b.y0 - pad);
    const w = Math.min(cv.width - x, (b.x1 - b.x0) + pad*2 + 40), h = Math.min(cv.height - y, (b.y1 - b.y0) + pad*2);
    const o = document.createElement("canvas"); const sc = Math.min(1, 320 / w);
    o.width = Math.round(w*sc); o.height = Math.round(h*sc);
    o.getContext("2d").drawImage(cv, x, y, w, h, 0, 0, o.width, o.height);
    return o.toDataURL("image/jpeg", .8);
  }catch(e){ return ""; }
}
function diff1(a, b){ if(a.length !== b.length) return false; let n=0; for(let i=0;i<a.length;i++) if(a[i]!==b[i] && ++n>1) return false; return true; }

// 撮影した伝票写真（画面表示用・メモリ上のみ）を消す
let docPhotoUrl = null;
function clearDocPhoto(){
  if(docPhotoUrl){ URL.revokeObjectURL(docPhotoUrl); docPhotoUrl = null; }
  const t = $("#ocrThumb"); t.removeAttribute("src");
  $("#ocrBox").hidden = true; $("#docStatus").textContent = ""; $("#ocrBar").style.width = "0";
}

async function readDoc(file, append){
  const st = $("#docStatus"), box = $("#ocrBox"), bar = $("#ocrBar");
  clearDocPhoto();
  box.hidden = false; st.className = "status";
  $("#ocrBarWrap").hidden = false; $("#ocrCount").hidden = true;
  const url = URL.createObjectURL(file); $("#ocrThumb").src = url; docPhotoUrl = url;
  $("#docBtn").classList.add("busy");
  try{
    st.textContent = "画像を準備中…";
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("画像を開けませんでした")); i.src = url; });
    const firstLoad = !ocrWorkerPromise;
    if(firstLoad) st.textContent = "文字認識の準備中…（初回のみ数十秒かかります）";
    let phase = 0, phases = 1;
    ocrProgress = m => {
      if(m.status === "recognizing text"){
        bar.style.width = ((phase + m.progress) / phases * 100) + "%";
        st.textContent = `商品コードを読み取り中… ${Math.round((phase + m.progress) / phases * 100)}%`;
      } else if(firstLoad && /load|initializ/.test(m.status||"")){ st.textContent = "文字認識の準備中…（初回のみ数十秒かかります）"; }
    };
    const worker = await getOcrWorker();
    // 1回目
    const cv1 = prepCanvas(im, 1600, false);
    let r1 = ocrCodes((await worker.recognize(cv1)).data, cv1);
    let found = r1;
    // チェックデジットが合わない番号があれば、解像度を変えてもう1回
    if(!r1.length || r1.some(c => !ean13ok(c.code))){
      phase = 1; phases = 2;
      const cv2 = prepCanvas(im, 2000, true);
      const r2 = ocrCodes((await worker.recognize(cv2)).data, cv2);
      const valid = new Map();
      [...r1, ...r2].forEach(c => { if(ean13ok(c.code) && !valid.has(c.code)) valid.set(c.code, c); });
      const order = [];
      const seen = new Set();
      const pushC = c => { if(!seen.has(c.code)){ seen.add(c.code); order.push(c); } };
      const base = r2.length > r1.length ? r2 : r1;
      base.forEach(c => {
        if(ean13ok(c.code)) pushC(c);
        else { const fix = [...valid.keys()].find(v => diff1(v, c.code) || (c.code.length === 12 && v.endsWith(c.code))); if(fix) pushC(valid.get(fix)); else pushC(c); }
      });
      valid.forEach(c => pushC(c));
      // 正しい番号と1桁違いの誤読は除外
      found = order.filter(c => ean13ok(c.code) || ![...valid.keys()].some(v => diff1(v, c.code)));
    }
    bar.style.width = "100%";
    if(!found.length){
      st.className = "status err";
      st.textContent = "商品コードが見つかりませんでした。伝票全体が写るよう、真上から明るい場所で撮り直してください。";
      return;
    }
    const items = found.map(c => ({code: c.code, status:"todo", ...(ean13ok(c.code) ? {} : {snip: snippet(c)})}));
    let added = 0;
    let dup = 0;
    if(append){
      // 上下に分けて撮った時の重なり部分を除外
      items.forEach(i => {
        if(state.items.some(x => x.code === i.code)){ dup++; return; }
        const iValid = ean13ok(i.code);
        // 既にある正しい番号と1桁違いの誤読 → 同じ行とみなして除外
        if(!iValid && state.items.some(x => ean13ok(x.code) && diff1(x.code, i.code))){ dup++; return; }
        // 既にある「要確認」の番号を、今回正しく読めた番号で置き換え
        if(iValid){
          const near = state.items.find(x => !ean13ok(x.code) && diff1(x.code, i.code));
          if(near){ near.code = i.code; delete near.snip; dup++; return; }
        }
        state.items.push(i); added++;
      });
    } else {
      state = emptyState(); state.items = items; added = items.length;
      $("#result").innerHTML = ""; $("#flash").hidden = true;
    }
    const bad = state.items.filter(i => !ean13ok(i.code)).length;
    st.textContent = `${added} 件を読み取りました（合計 ${state.items.length} 件）。` + (dup ? `前の写真と重なっていた ${dup} 件はまとめました。` : "") +
      (bad ? `「要確認」の ${bad} 件は写真を見て番号を直してください。` : "伝票の行数と合っているか確認してください。");
    $("#ocrBarWrap").hidden = true;
    filter = "all"; syncFilter(); render();
  }catch(e){
    st.className = "status err";
    st.textContent = (e && e.message ? e.message + "。" : "") + "読み取りに失敗しました。もう一度撮影するか、下の「貼り付け」をお使いください。";
  }finally{
    ocrProgress = null; $("#docBtn").classList.remove("busy");
    $("#ocrCount").hidden = !state.items.length;
  }
}
$("#docInput").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if(f) readDoc(f, false); });
$("#docAdd").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if(f) readDoc(f, true); });
// 撮影ボタンを押した時点で文字認識の準備を始めておく
$("#docBtn").addEventListener("click", () => { unlockAudio(); getOcrWorker().catch(() => {}); });
$("#docAddBtn").addEventListener("click", () => { getOcrWorker().catch(() => {}); });

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
$("#addForm").addEventListener("submit", e => {
  e.preventDefault();
  const code = norm($("#addInput").value);
  const st = $("#pasteStatus"); st.className = "status";
  if(code.length !== 13){ st.className = "status err"; st.textContent = "13桁の番号を入力してください。"; return; }
  if(state.items.some(i => i.code === code)){ st.textContent = "その番号はすでにリストにあります。"; return; }
  state.items.push({code, status:"todo"});
  state.extras = state.extras.filter(c => c !== code);
  $("#addInput").value = "";
  st.textContent = `${code} を追加しました（合計 ${state.items.length} 件）。` + (ean13ok(code) ? "" : "番号が正しくない可能性があります。");
  render();
});
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
  else if(t.closest("[data-edit]") && !t.dataset.tog){ const i = +t.closest("[data-edit]").dataset.edit; state.items.forEach(x => delete x.editing); state.items[i].editing = true; render(); const inp = $("#edit-" + i); inp && inp.focus(); }
  else if(t.dataset.del != null){ const i = +t.dataset.del; const code = state.items[i].code; state.items.splice(i, 1); $("#pasteStatus").className = "status"; $("#pasteStatus").textContent = `${code} をリストから削除しました（合計 ${state.items.length} 件）。`; render(); }
  else if(t.dataset.save != null){ const i = +t.dataset.save, it = state.items[i]; it.code = norm($("#edit-" + i).value) || it.code; delete it.editing; if(ean13ok(it.code)) delete it.snip; render(); }
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
  const li = c => `<li>${codeHtml(c)}</li>`;
  if(miss.length) h += `<h3>未確認（伝票にあるが読み取っていない） <span class="cnt">${miss.length} 点</span></h3><ul>${miss.map(i => li(i.code)).join("")}</ul>`;
  if(ex.length) h += `<h3>リスト外（読み取ったが伝票にない） <span class="cnt">${ex.length} 点</span></h3><ul>${ex.map(li).join("")}</ul>`;
  if(bad.length) h += `<h3>番号要確認（チェックデジット不一致） <span class="cnt">${bad.length} 点</span></h3><ul>${bad.map(i => li(i.code)).join("")}</ul>`;
  if(man.length) h += `<h3>手動で確認済にした商品 <span class="cnt">${man.length} 点</span></h3><ul>${man.map(i => li(i.code)).join("")}</ul>`;
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
twoTap($("#resetAll"), () => { state = emptyState(); clearDocPhoto(); $("#flash").hidden = true; $("#result").innerHTML = ""; $("#pasteStatus").textContent = ""; render(); });

// ---------- boot ----------
$("#ver").textContent = ` v${APP_VERSION}`;
render();
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
// v1.1.0 で二重保存していた認識データ（IndexedDB）を削除
try{ indexedDB.deleteDatabase("keyval-store"); }catch(e){}
// テスト用フック
window.__nyuka = {match, parsePaste, ean13ok, get state(){ return state; }};
})();
