import { TYPES, loadSettings, saveSettings } from './settings.js';
import * as db from './db.js';
import { icon } from './icons.js';

// ---------- 小さな道具 ----------
const MIN = 60000;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clock = (t) => { const d = new Date(t); return `${d.getHours()}:${pad(d.getMinutes())}`; };
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
};
const hm = (ms) => {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}時間${r}分` : `${h}時間`;
};
const sod = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const weekStart = (t) => addDays(sod(t), -((new Date(t).getDay() + 6) % 7)); // 月曜はじまり
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 2200);
}

// ---------- 状態 ----------
let S = loadSettings();
// 動いているタイマー。開始・終了の時刻で持つので、閉じて開き直しても正しく計算できる
let active = store.get('vt-active', null);
const ui = { type: 'work', min: null, label: store.get('vt-label', '') };
const log = { mode: 'day', date: sod(Date.now()) };
let view = 'timer';
let lastPhase = null;

const defMin = (t) => (t === 'work' ? S.workMin : S[t]);
const saveActive = () => store.set('vt-active', active);

function phase() {
  if (!active) return 'idle';
  if (active.stoppedAt) return 'done';
  if (!active.pausedAt && Date.now() >= active.end) return 'done';
  return 'run';
}
const remaining = () => active.end - (active.pausedAt || Date.now());
const activeMsOf = (a, endT) => Math.max(0, endT - a.start - a.pausedMs - (a.pausedAt ? endT - a.pausedAt : 0));

// ---------- 音・通知・画面 ----------
// チャイムの音を WAV として作り、<audio> で鳴らす。
// iPhone の Web Audio はマナーモードで消えるうえ、タップ中にしか鳴らせないため、
// 最初のタップで一度だけ無音再生して「鳴らしてよい状態」にしておく。
function makeBellURL() {
  const rate = 22050, len = Math.floor(rate * 2.4);
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * 2, true);
  const notes = [[659.25, 0], [987.77, 0.22], [1318.5, 0.44]];
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    let s = 0;
    for (const [f, d] of notes) {
      const x = t - d;
      if (x >= 0) s += Math.sin(2 * Math.PI * f * x) * Math.min(1, x / 0.02) * Math.exp(-x * 2.6) * 0.3;
    }
    v.setInt16(44 + i * 2, clamp(s, -1, 1) * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
const bell = new Audio(makeBellURL());
bell.preload = 'auto';
let audioReady = false, ringing = false;

function unlockAudio() {
  if (audioReady || ringing) return;
  bell.muted = true;
  bell.play()
    .then(() => {
      if (!ringing) { bell.pause(); bell.currentTime = 0; }
      bell.muted = false;
      audioReady = true;
    })
    .catch(() => { bell.muted = false; });
}
function chime() {
  ringing = true;
  bell.muted = false;
  try { bell.currentTime = 0; } catch {}
  bell.play().then(() => { audioReady = true; }).catch(() => {});
  clearTimeout(chime.t);
  chime.t = setTimeout(() => { ringing = false; }, 2600);
}
async function alertUser(again) {
  const c = TYPES[active.type];
  const title = again ? 'まだ続けていますか？' : active.type === 'work' ? '作業の時間が終わりました' : `${c.name}が終わりました`;
  if (S.sound) chime();
  navigator.vibrate?.([180, 120, 180]);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const body = active.type === 'work' ? 'ひと息つきましょう' : '次に進む準備ができたらタップ';
      reg ? reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'vt' }) : new Notification(title, { body });
    } catch {}
  }
}

let wake = null;
async function updateWake() {
  const want = S.wakeLock && active && phase() === 'run' && !document.hidden;
  try {
    if (want && !wake && navigator.wakeLock) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!want && wake) {
      await wake.release();
      wake = null;
    }
  } catch {}
}

// iPhoneのショートカットを呼んで、時計アプリのタイマーを同じ分数でセットする
function runShortcut(min) {
  if (!S.shortcuts || !S.shortcutName) return;
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(S.shortcutName)}&input=text&text=${Math.round(min)}`;
  setTimeout(() => { location.href = url; }, 150);
}

// ---------- タイマーの操作 ----------
function startTimer(type, min, label) {
  unlockAudio();
  ui.nextMin = null;
  const now = Date.now();
  active = {
    type, label: type === 'work' ? label || '' : '',
    start: now, end: now + min * MIN, planned: min * MIN, segLen: min * MIN,
    pausedAt: null, pausedMs: 0, stoppedAt: null, ext: 0, alertedAt: null,
  };
  saveActive();
  renderTimer();
  runShortcut(min);
}

async function recordActive() {
  if (!active) return null;
  const a = active;
  const endT = a.stoppedAt || Date.now();
  const ms = activeMsOf(a, endT);
  active = null;
  saveActive();
  if (ms >= 30000) {
    await db.putSession({ id: uid(), type: a.type, label: a.label, start: a.start, end: endT, planned: a.planned, activeMs: ms, note: '' });
  }
  return a;
}

function togglePause() {
  const now = Date.now();
  if (active.pausedAt) {
    active.pausedMs += now - active.pausedAt;
    active.end += now - active.pausedAt;
    active.pausedAt = null;
  } else {
    active.pausedAt = now;
  }
  saveActive();
  renderTimer();
}

function stopEarly() {
  const now = Date.now();
  if (active.pausedAt) togglePause();
  active.stoppedAt = now;
  saveActive();
  renderTimer();
}

function resumeStopped() {
  const now = Date.now();
  active.pausedMs += now - active.stoppedAt;
  active.end += now - active.stoppedAt;
  active.stoppedAt = null;
  saveActive();
  renderTimer();
}

function extend(min = 5) {
  unlockAudio();
  const now = Date.now();
  if (active.stoppedAt) { active.pausedMs += now - active.stoppedAt; active.stoppedAt = null; }
  active.end = now + min * MIN;
  active.segLen = min * MIN;
  active.ext += 1;
  active.alertedAt = null;
  saveActive();
  renderTimer();
  runShortcut(min);
}

async function goNext(type) {
  await recordActive();
  const min = ui.nextMin && type === ui.nextFor ? ui.nextMin : defMin(type);
  ui.nextMin = null;
  startTimer(type, min, type === 'work' ? ui.label : '');
}

// 増減の幅: 10分以下は1分ずつ、それより上は5分ずつ
const stepMin = (m, up) => clamp(up ? m + (m < 10 ? 1 : 5) : m - (m <= 10 ? 1 : 5), 1, 180);

async function finishHere() {
  await recordActive();
  ui.type = 'work';
  ui.min = null;
  renderTimer();
  toast('記録しました');
}

const todaySessions = () => db.getSessions(sod(Date.now()), addDays(Date.now(), 1));

// 作業のあとに一番大きく出す休憩を選ぶ
function recommend(today) {
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  if (S.mealOn && nowM >= toMin(S.mealStart) && nowM <= toMin(S.mealEnd) && !today.some((s) => s.type === 'meal')) {
    return { type: 'meal', reason: '食事の時間帯です' };
  }
  if (S.longEnabled) {
    let count = 1; // いま終わった作業
    for (const s of [...today].sort((a, b) => b.start - a.start)) {
      if (s.type === 'long' || s.type === 'meal') break;
      if (s.type === 'work') count++;
    }
    if (count >= S.longEvery) return { type: 'long', reason: `作業が${count}回続きました。長めに休みませんか` };
  }
  return { type: 'short', reason: '' };
}

// ---------- タイマー画面 ----------
function wedgePath(f) {
  const R = 88;
  if (f <= 0) return '';
  if (f >= 0.9995) return `M100 ${100 - R} A${R} ${R} 0 1 1 100 ${100 + R} A${R} ${R} 0 1 1 100 ${100 - R} Z`;
  const a = f * 2 * Math.PI;
  const x = 100 + R * Math.sin(a), y = 100 - R * Math.cos(a);
  return `M100 100 L100 ${100 - R} A${R} ${R} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

function diskSVG(type, frac, over = false) {
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI, r1 = i % 3 ? 80 : 76, r2 = 86;
    ticks += `<line x1="${100 + r1 * Math.sin(a)}" y1="${100 - r1 * Math.cos(a)}" x2="${100 + r2 * Math.sin(a)}" y2="${100 - r2 * Math.cos(a)}"/>`;
  }
  return `<svg class="disk" viewBox="0 0 200 200" aria-hidden="true">
    ${over ? '<circle class="over-ring" cx="100" cy="100" r="96" fill="none" stroke="#E4CEC8" stroke-width="6"/>' : ''}
    <circle cx="100" cy="100" r="88" fill="#FFFFFF"/>
    <path id="wedge" fill="${TYPES[type].fill}" d="${wedgePath(frac)}"/>
    <g stroke="#353C4E" stroke-opacity="0.16" stroke-width="2" stroke-linecap="round">${ticks}</g>
    <circle cx="100" cy="100" r="7" fill="#353C4E"/>
  </svg>`;
}

function idleHTML() {
  const t = ui.type, c = TYPES[t];
  if (ui.min == null) ui.min = defMin(t);
  const types = Object.entries(TYPES).map(([k, v]) =>
    `<button class="chip" data-act="type" data-v="${k}" aria-pressed="${k === t}" style="${k === t ? `background:${v.fill};color:${v.onFill}` : ''}">${icon(v.icon, 20)}${v.name}</button>`).join('');
  const presets = t === 'work'
    ? `<div class="chips center" style="margin-top:14px">${S.workPresets.map((m) => `<button class="chip ${m === ui.min ? 'on' : ''}" data-act="min" data-v="${m}">${m}分</button>`).join('')}</div>`
    : '';
  const labels = t === 'work' && S.labels.length
    ? `<div class="sec-label">ラベル（なしでもOK）</div><div class="chips">${['', ...S.labels].map((l) =>
        `<button class="chip ${l === ui.label ? 'on' : ''}" data-act="label" data-v="${esc(l)}">${l ? esc(l) : 'なし'}</button>`).join('')}</div>`
    : '';
  return `<div class="screen">
    <div class="types" role="group" aria-label="タイマーの種類">${types}</div>
    <div class="disk-wrap">${diskSVG(t, 1)}</div>
    <div class="stepper">
      <button class="round" data-act="step" data-v="-1" aria-label="短くする">${icon('minus')}</button>
      <div class="big-num num">${ui.min}<span>分</span></div>
      <button class="round" data-act="step" data-v="1" aria-label="長くする">${icon('plus')}</button>
    </div>
    <p class="sub center" id="endHint"></p>
    ${presets}${labels}
    <div class="actions">
      <button class="btn big" data-act="start" style="background:${c.fill};color:${c.onFill}">${icon('play')}${t === 'work' ? '作業をはじめる' : `${c.name}をはじめる`}</button>
    </div>
  </div>`;
}

function runHTML() {
  const a = active, c = TYPES[a.type];
  return `<div class="screen">
    <div class="run-head"><span class="pill" style="background:${c.tint};color:${c.ink}">${icon(c.icon, 18)}${c.name}${a.label ? ` ・ ${esc(a.label)}` : ''}</span></div>
    <div class="disk-wrap">${diskSVG(a.type, remaining() / a.segLen)}</div>
    <div class="big-num num ${S.showDigits ? '' : 'hidden-digits'}" id="remain" aria-live="off"></div>
    <p class="sub center" id="endAt"></p>
    ${a.type === 'work' && a.ext >= 2 ? `<p class="note">延長は${a.ext}回目です。そろそろ休もう</p>` : ''}
    <div class="actions">
      <div class="row">
        <button class="round lg" data-act="pause" aria-label="${a.pausedAt ? '再開する' : '一時停止する'}">${icon(a.pausedAt ? 'play' : 'pause', 26)}</button>
        <button class="btn grow" data-act="stop">${icon('stop')}${a.type === 'work' ? 'ここで作業を終える' : '休憩を終える'}</button>
      </div>
    </div>
  </div>`;
}

// 次のタイマーの時間を選ぶ欄。選んだ時間は一番大きいボタン（type）に反映する
const PRESETS = { work: null, short: [3, 5, 10], long: [10, 15, 20, 30], meal: [30, 45, 60] };
function pickHTML(type, title) {
  if (ui.nextFor !== type) { ui.nextFor = type; ui.nextMin = null; }
  const m = ui.nextMin ?? defMin(type);
  const base = type === 'work' ? S.workPresets : PRESETS[type];
  const presets = [...new Set([...base, defMin(type)])].sort((x, y) => x - y);
  return `<div class="pick">
    <div class="row pick-top">
      <span class="sub grow">${title}</span>
      <button class="round sm" data-act="nstep" data-v="-1" aria-label="短くする">${icon('minus', 18)}</button>
      <span class="num pick-v">${m}分</span>
      <button class="round sm" data-act="nstep" data-v="1" aria-label="長くする">${icon('plus', 18)}</button>
    </div>
    <div class="chips">${presets.map((x) => `<button class="chip ${x === m ? 'on' : ''}" data-act="nmin" data-v="${x}">${x}分</button>`).join('')}</div>
  </div>`;
}

function midBtn(k) {
  const c = TYPES[k];
  return `<button class="btn mid" data-act="next" data-v="${k}" style="background:${c.tint};color:${c.ink}">
    <span>${icon(c.icon, 18)} ${c.name}</span><small class="num">${defMin(k)}分</small></button>`;
}

async function doneHTML() {
  const a = active, c = TYPES[a.type];
  const endT = a.stoppedAt || Date.now();
  const did = activeMsOf(a, endT);
  const today = await todaySessions();
  const workToday = today.filter((s) => s.type === 'work').reduce((x, s) => x + s.activeMs, 0) + (a.type === 'work' ? did : 0);
  const early = a.stoppedAt && a.end - a.stoppedAt > 5000;
  const resume = early ? `<button class="link" data-act="resume">やっぱり続ける</button>` : '';

  if (a.type === 'work') {
    const rec = recommend(today);
    const r = TYPES[rec.type];
    const others = ['short', 'long', 'meal'].filter((k) => k !== rec.type);
    return `<div class="screen">
      <div class="done-head">
        <div class="badge">${icon('check', 34)}</div>
        <h2>おつかれさま</h2>
        <p class="sub">${hm(did)} 作業できました</p>
        <p class="sub">今日の作業 ${hm(workToday)}</p>
        <p class="over num" id="over"></p>
        ${a.ext >= 2 ? '<p class="note">延長が2回続きました。そろそろ休もう</p>' : ''}
        ${rec.reason ? `<p class="reason">${rec.reason}</p>` : ''}
      </div>
      <div class="actions">
        ${pickHTML(rec.type, `${r.name}の時間`)}
        <div class="row">${others.map(midBtn).join('')}</div>
        <button class="btn big" data-act="next" data-v="${rec.type}" style="background:${r.fill};color:${r.onFill}">${icon(r.icon)}${r.verb}<span class="num">${ui.nextMin ?? defMin(rec.type)}分</span></button>
        <div class="row center"><button class="link" data-act="extend">あと5分だけ</button>${resume}<button class="link" data-act="finish">ここで終わり</button></div>
      </div>
    </div>`;
  }

  const w = TYPES.work;
  return `<div class="screen">
    <div class="done-head">
      <div class="badge" style="background:${c.tint};color:${c.ink}">${icon(c.icon, 34)}</div>
      <h2>${c.name}おわり</h2>
      <p class="sub">${hm(did)} 休めました</p>
      <p class="over num" id="over"></p>
    </div>
    <div class="actions">
      ${pickHTML('work', '作業の時間')}
      ${a.type !== 'meal' ? `<div class="row">${midBtn('meal')}</div>` : ''}
      <button class="btn big" data-act="next" data-v="work" style="background:${w.fill};color:${w.onFill}">${icon('play')}作業にもどる<span class="num">${ui.nextMin ?? S.workMin}分${ui.label ? ` ・ ${esc(ui.label)}` : ''}</span></button>
      <div class="row center"><button class="link" data-act="extend">もう少し休む（+5分）</button>${resume}<button class="link" data-act="finish">今日はここまで</button></div>
    </div>
  </div>`;
}

let renderSeq = 0;
async function renderTimer() {
  const seq = ++renderSeq;
  const p = phase();
  lastPhase = p;
  const html = p === 'idle' ? idleHTML() : p === 'run' ? runHTML() : await doneHTML();
  if (seq !== renderSeq) return;
  $('#view-timer').innerHTML = html;
  updateWake();
  tick();
}

function tick() {
  const p = phase();
  if (p !== lastPhase) { renderTimer(); return; }
  const now = Date.now();
  if (p === 'idle') {
    const e = $('#endHint');
    if (e) e.textContent = `${clock(now + ui.min * MIN)} ごろに終わります`;
    document.title = 'ビジュアルタイマー';
    return;
  }
  if (p === 'run') {
    const r = remaining();
    const w = $('#wedge');
    if (w) w.setAttribute('d', wedgePath(r / active.segLen));
    const re = $('#remain');
    if (re) re.textContent = mmss(r);
    const ea = $('#endAt');
    if (ea) ea.textContent = active.pausedAt ? '一時停止中' : `${clock(active.end)} に終わります`;
    document.title = `${mmss(r)} ${TYPES[active.type].name}`;
    return;
  }
  // 終わったあと（止めるまで超過時間を表示し、ときどきお知らせする）
  document.title = TYPES[active.type].name + 'おわり';
  if (active.stoppedAt) return;
  const over = now - active.end;
  const o = $('#over');
  if (o) o.textContent = over >= MIN ? `+${mmss(over)} すぎています` : '時間になりました';
  if (!active.alertedAt) {
    active.alertedAt = now;
    saveActive();
    alertUser(false);
  } else if (S.renotify > 0 && now - active.alertedAt >= S.renotify * MIN) {
    active.alertedAt = now;
    saveActive();
    alertUser(true);
  }
}

// ---------- きろく画面 ----------
const sumOf = (list, types) => list.filter((s) => types.includes(s.type)).reduce((x, s) => x + s.activeMs, 0);
const LEVELS = ['#FFFFFF', '#E2E6EE', '#C5CCDA', '#A8B1C6'];
const level = (ms) => (ms <= 0 ? 0 : ms < 60 * MIN ? 1 : ms < 180 * MIN ? 2 : 3);

function navHTML(title, isNow) {
  return `<div class="nav">
    <button class="round sm" data-act="lognav" data-v="-1" aria-label="前へ">${icon('chevL', 20)}</button>
    <div class="nav-title">${title}${isNow ? '' : '<button class="link" data-act="lognow">今日にもどる</button>'}</div>
    <button class="round sm" data-act="lognav" data-v="1" aria-label="次へ">${icon('chevR', 20)}</button>
  </div>`;
}

function goalHTML(workMs) {
  if (!S.goal) return '';
  const f = Math.min(1, workMs / (S.goal * MIN));
  const R = 9, L = 2 * Math.PI * R;
  const ring = `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="${R}" fill="none" stroke="#E3DED9" stroke-width="4"/><circle cx="12" cy="12" r="${R}" fill="none" stroke="#7B879E" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(f * L).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 12 12)"/></svg>`;
  return f >= 1
    ? `<div class="goal"><span class="goal-done">目標 ${hm(S.goal * MIN)} 達成</span></div>`
    : `<div class="goal">${ring}目標 ${hm(S.goal * MIN)}</div>`;
}

async function dayHTML() {
  const from = log.date, to = addDays(from, 1);
  const list = (await db.getSessions(from, to)).sort((a, b) => a.start - b.start);
  const d = new Date(from);
  const isToday = from === sod(Date.now());
  const work = sumOf(list, ['work']);
  const labels = {};
  list.filter((s) => s.type === 'work' && s.label).forEach((s) => { labels[s.label] = (labels[s.label] || 0) + s.activeMs; });
  const labelHTML = Object.keys(labels).length
    ? `<div class="labels-sum">${Object.entries(labels).map(([k, v]) => `<span>${esc(k)} ${hm(v)}</span>`).join('')}</div>` : '';

  let tl = '';
  if (list.length) {
    let h0 = Math.floor((list[0].start - from) / 3600000);
    let h1 = Math.ceil((Math.max(...list.map((s) => s.end)) - from) / 3600000);
    if (h1 - h0 < 4) h1 = h0 + 4;
    const base = from + h0 * 3600000, span = (h1 - h0) * 3600000;
    const mid = Math.round((h0 + h1) / 2);
    tl = `<div class="card"><div class="tl">${list.map((s) =>
      `<div class="tl-b" style="left:${((s.start - base) / span) * 100}%;width:${Math.max(0.8, ((s.end - s.start) / span) * 100)}%;background:${TYPES[s.type].fill}"></div>`).join('')}</div>
      <div class="tl-axis num"><span>${h0 % 24}:00</span><span>${mid % 24}:00</span><span>${h1 % 24}:00</span></div></div>`;
  }

  const rows = list.length
    ? list.map((s) => `<button class="item" data-act="edit" data-v="${s.id}">
        <span class="dot" style="background:${TYPES[s.type].fill}"></span>
        <span class="t num">${clock(s.start)}–${clock(s.end)}</span>
        <span class="n">${TYPES[s.type].name}${s.label ? ` <small>${esc(s.label)}</small>` : ''}${s.note ? ` <small>・${esc(s.note)}</small>` : ''}</span>
        <span class="d num">${hm(s.activeMs)}</span></button>`).join('')
    : `<div class="empty">${isToday ? 'タイマーを使うと、ここに時間が並びます。' : 'この日の記録はありません。'}</div>`;

  return `${navHTML(`${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`, isToday)}
    <div class="hero"><p class="sub">作業できた時間</p><div class="hero-num num">${hm(work)}</div>${goalHTML(work)}${labelHTML}</div>
    <div class="cards3">
      <div class="mini"><p class="sub"><span class="dot" style="background:${TYPES.work.fill}"></span>作業</p><div class="v num">${hm(work)}</div></div>
      <div class="mini"><p class="sub"><span class="dot" style="background:${TYPES.short.fill}"></span>休憩</p><div class="v num">${hm(sumOf(list, ['short', 'long']))}</div></div>
      <div class="mini"><p class="sub"><span class="dot" style="background:${TYPES.meal.fill}"></span>食事</p><div class="v num">${hm(sumOf(list, ['meal']))}</div></div>
    </div>
    ${tl}
    <div class="card list">${rows}</div>
    <div class="actions" style="margin-top:12px"><button class="btn ghost" data-act="add">${icon('plus', 20)}記録を追加</button></div>`;
}

async function weekHTML() {
  const ws = weekStart(log.date), we = addDays(ws, 7);
  const list = await db.getSessions(ws, we);
  const today = sod(Date.now());
  const days = [...Array(7)].map((_, i) => {
    const f = addDays(ws, i), t = addDays(ws, i + 1);
    const work = list.filter((s) => s.start >= f && s.start < t && s.type === 'work').reduce((x, s) => x + s.activeMs, 0);
    return { f, work };
  });
  const max = Math.max(60 * MIN, S.goal * MIN, ...days.map((d) => d.work));
  const total = sumOf(list, ['work']);
  const bars = days.map((d, i) => `<button class="bar-col ${d.f === today ? 'today' : ''}" data-act="day" data-v="${d.f}" aria-label="${md(d.f)} ${hm(d.work)}">
    <span class="bar-val num">${d.work ? (d.work / 3600000).toFixed(1) + 'h' : ''}</span>
    <span class="bar-track"><span class="bar" style="height:${(d.work / max) * 100}%;background:${d.work ? TYPES.work.fill : '#E3DED9'}"></span></span>
    <span class="bar-day">${'月火水木金土日'[i]}</span></button>`).join('');
  return `${navHTML(`${md(ws)} 〜 ${md(addDays(ws, 6))}`, ws === weekStart(Date.now()))}
    <div class="hero"><p class="sub">今週の作業</p><div class="hero-num num">${hm(total)}</div></div>
    <div class="card"><div class="bars">${bars}</div></div>
    <div class="cards3" style="margin-top:12px">
      <div class="mini"><p class="sub">1日平均</p><div class="v num">${hm(total / Math.max(1, days.filter((d) => d.work > 0).length))}</div></div>
      <div class="mini"><p class="sub">休憩</p><div class="v num">${hm(sumOf(list, ['short', 'long']))}</div></div>
      <div class="mini"><p class="sub">食事</p><div class="v num">${hm(sumOf(list, ['meal']))}</div></div>
    </div>`;
}

async function monthHTML() {
  const d = new Date(log.date);
  const ms = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const me = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const list = await db.getSessions(ms, me);
  const today = sod(Date.now());
  const offset = (new Date(ms).getDay() + 6) % 7;
  let cells = '<span></span>'.repeat(offset);
  let workDays = 0;
  for (let i = 0; i < n; i++) {
    const f = addDays(ms, i), t = addDays(ms, i + 1);
    const work = list.filter((s) => s.start >= f && s.start < t && s.type === 'work').reduce((x, s) => x + s.activeMs, 0);
    if (work > 0) workDays++;
    const lv = level(work);
    const goalDone = S.goal && work >= S.goal * MIN;
    cells += `<button class="cell num ${f === today ? 'today' : ''}" data-act="day" data-v="${f}" style="background:${LEVELS[lv]}" aria-label="${i + 1}日 ${hm(work)}">${i + 1}${goalDone ? '<span class="gd"></span>' : ''}</button>`;
  }
  const isNow = ms === new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  return `${navHTML(`${d.getFullYear()}年${d.getMonth() + 1}月`, isNow)}
    <div class="hero"><p class="sub">今月の作業</p><div class="hero-num num">${hm(sumOf(list, ['work']))}</div><p class="sub">${workDays}日 作業しました</p></div>
    <div class="card">
      <div class="cal-head">${'月火水木金土日'.split('').map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal">${cells}</div>
      <div class="legend">少ない ${LEVELS.map((c) => `<i style="background:${c};box-shadow:inset 0 0 0 1px #E3DED9"></i>`).join('')} 多い</div>
    </div>`;
}

async function renderLog() {
  const seg = `<div class="seg" role="group" aria-label="表示の切り替え">${[['day', '日'], ['week', '週'], ['month', '月']].map(([k, n]) =>
    `<button class="${log.mode === k ? 'on' : ''}" data-act="logmode" data-v="${k}">${n}</button>`).join('')}</div>`;
  const body = log.mode === 'day' ? await dayHTML() : log.mode === 'week' ? await weekHTML() : await monthHTML();
  $('#view-log').innerHTML = seg + body;
}

// ---------- 記録の編集 ----------
const toDateInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toTimeInput = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

async function openEdit(id) {
  let s = id ? await db.getSession(id) : null;
  const isNew = !s;
  if (!s) {
    const base = log.date === sod(Date.now()) ? Date.now() - 25 * MIN : log.date + 9 * 3600000;
    s = { id: uid(), type: 'work', label: '', start: base, end: base + 25 * MIN, planned: 25 * MIN, activeMs: 25 * MIN, note: '' };
  }
  const labels = [...new Set(['', ...S.labels, s.label])];
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<form class="sheet" role="dialog" aria-label="記録の編集">
    <h3>${isNew ? '記録を追加' : '記録を直す'}</h3>
    <div class="card">
      <label class="field"><span>種類</span><select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <label class="field"><span>ラベル</span><select name="label">${labels.map((l) => `<option value="${esc(l)}" ${l === s.label ? 'selected' : ''}>${l ? esc(l) : 'なし'}</option>`).join('')}</select></label>
      <label class="field"><span>日付</span><input type="date" name="date" value="${toDateInput(s.start)}" required></label>
      <label class="field"><span>開始</span><input type="time" name="st" value="${toTimeInput(s.start)}" required></label>
      <label class="field"><span>終了</span><input type="time" name="et" value="${toTimeInput(s.end)}" required></label>
      <div class="field" style="flex-direction:column;align-items:stretch;padding:10px 0"><span>メモ</span><textarea name="note" rows="2" placeholder="なんでも">${esc(s.note)}</textarea></div>
    </div>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn danger" data-sheet="del">削除</button>'}
      <button type="button" class="btn grow" data-sheet="cancel">やめる</button>
      <button type="submit" class="btn grow" style="background:${TYPES.work.fill}">保存</button>
    </div>
  </form>`;
  document.body.appendChild(bg);
  const form = $('form', bg);
  const close = () => bg.remove();
  bg.addEventListener('click', async (e) => {
    if (e.target === bg) return close();
    const b = e.target.closest('[data-sheet]');
    if (!b) return;
    if (b.dataset.sheet === 'cancel') close();
    if (b.dataset.sheet === 'del' && confirm('この記録を削除しますか？')) {
      await db.deleteSession(s.id);
      close();
      renderLog();
      toast('削除しました');
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const start = new Date(`${f.get('date')}T${f.get('st')}`).getTime();
    let end = new Date(`${f.get('date')}T${f.get('et')}`).getTime();
    if (!(start > 0) || !(end > 0)) return toast('日付と時刻を入れてください');
    if (end <= start) end += 86400000; // 日をまたいだ
    const type = f.get('type');
    const changedTime = start !== s.start || end !== s.end;
    await db.putSession({
      ...s, type, label: type === 'work' ? f.get('label') : '', note: String(f.get('note') || '').trim(),
      start, end, activeMs: changedTime || isNew ? end - start : s.activeMs,
    });
    close();
    log.date = sod(start);
    renderLog();
    toast('保存しました');
  });
}

// ---------- せってい画面 ----------
function renderSettings() {
  const num = (k, label, min = 1, max = 180, i) =>
    `<label class="field"><span>${label}</span><span class="inline"><input type="number" inputmode="numeric" min="${min}" max="${max}" data-k="${k}" ${i != null ? `data-i="${i}"` : ''} value="${i != null ? S[k][i] : S[k]}">分</span></label>`;
  const sw = (k, label, help = '') =>
    `<label class="field"><span>${label}${help ? `<small>${help}</small>` : ''}</span><input type="checkbox" class="switch" data-k="${k}" ${S[k] ? 'checked' : ''}></label>`;
  const notif = 'Notification' in window
    ? `<div class="field"><span>通知<small>${Notification.permission === 'granted' ? '許可されています' : 'ほかのタブを見ているときに使います'}</small></span>${Notification.permission === 'granted' ? '' : '<button class="btn" data-act="notif" style="min-height:40px">許可する</button>'}</div>`
    : '';
  $('#view-settings').innerHTML = `<div class="set">
    <h3>タイマーの時間</h3>
    <div class="card">
      ${num('workMin', '作業（いつもの長さ）')}
      ${num('workPresets', 'よく使う作業時間 1', 1, 180, 0)}
      ${num('workPresets', 'よく使う作業時間 2', 1, 180, 1)}
      ${num('workPresets', 'よく使う作業時間 3', 1, 180, 2)}
      ${num('short', '短い休憩')}
      ${num('long', '長めの休憩')}
      ${num('meal', '食事')}
    </div>

    <h3>切り替え</h3>
    <div class="card">
      ${sw('longEnabled', '長めの休憩をすすめる', '作業が続いたら、大きいボタンを長めの休憩にします')}
      <label class="field"><span>何回ごとにすすめるか</span><span class="inline"><input type="number" inputmode="numeric" min="2" max="12" data-k="longEvery" value="${S.longEvery}">回</span></label>
      ${sw('mealOn', '食事の時間帯をお知らせ', 'この時間に作業が終わったら、大きいボタンを食事にします')}
      <label class="field"><span>時間帯</span><span class="inline"><input type="time" data-k="mealStart" value="${S.mealStart}">〜<input type="time" data-k="mealEnd" value="${S.mealEnd}"></span></label>
    </div>

    <h3>お知らせ</h3>
    <div class="card">
      <div class="field"><span>終わったときの音</span><span class="inline"><button class="btn" data-act="testsound" style="min-height:40px;padding:0 14px">${icon('bell', 18)}試す</button><input type="checkbox" class="switch" data-k="sound" ${S.sound ? 'checked' : ''}></span></div>
      <label class="field"><span>時間を過ぎたら、もう一度お知らせ</span><select data-k="renotify">${[[0, 'しない'], [3, '3分ごと'], [5, '5分ごと'], [10, '10分ごと'], [15, '15分ごと']].map(([v, n]) => `<option value="${v}" ${S.renotify === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${sw('wakeLock', '画面をつけたままにする', 'タイマー中に画面が暗くなりません')}
      ${notif}
    </div>

    <h3>表示</h3>
    <div class="card">
      ${sw('showDigits', '残り時間を数字でも表示', 'オフにすると円だけになります')}
      <label class="field"><span>1日の目標<small>設定した人だけ、きろくに表示します</small></span><select data-k="goal">${[0, 60, 120, 180, 240, 300, 360, 480].map((v) => `<option value="${v}" ${S.goal === v ? 'selected' : ''}>${v ? hm(v * MIN) : 'なし'}</option>`).join('')}</select></label>
    </div>

    <h3>作業のラベル</h3>
    <div class="card">
      <div class="tag-list">${S.labels.map((l, i) => `<span class="tag">${esc(l)}<button data-act="label-del" data-v="${i}" aria-label="${esc(l)}を消す">${icon('x', 16)}</button></span>`).join('') || '<span class="sub">まだありません</span>'}</div>
      <div class="field"><input type="text" id="newLabel" maxlength="20" placeholder="新しいラベル"><button class="btn" data-act="label-add" style="min-height:40px">追加</button></div>
    </div>

    <h3>iPhoneのショートカット連携</h3>
    <div class="card">
      ${sw('shortcuts', '時計アプリのタイマーも使う', 'アプリを閉じていても、時間になると時計アプリが鳴ります')}
      <label class="field"><span>ショートカットの名前</span><input type="text" data-k="shortcutName" value="${esc(S.shortcutName)}" style="max-width:55%"></label>
      <details><summary>ショートカットの作り方</summary>
        <ol>
          <li>「ショートカット」アプリで ＋ を押し、新しいショートカットを作る</li>
          <li>名前を「${esc(S.shortcutName)}」にする（上の欄と同じ名前）</li>
          <li>アクション「入力から数字を取得」を追加する</li>
          <li>アクション「タイマーを開始」を追加し、時間に「数字」、単位に「分」を選ぶ</li>
          <li>このアプリでタイマーを始めると、ショートカットが動いて時計アプリのタイマーがセットされます</li>
        </ol>
        <p class="help">途中で作業を終えたときは、時計アプリのタイマーを自分で止めてください。</p>
      </details>
    </div>

    <h3>データ</h3>
    <div class="card">
      <div class="field"><span>記録を書き出す<small>バックアップや機種変更のときに</small></span><button class="btn" data-act="export" style="min-height:40px">書き出す</button></div>
      <div class="field"><span>記録を読み込む</span><label class="btn" style="min-height:40px">読み込む<input type="file" accept="application/json,.json" id="importFile" hidden></label></div>
    </div>
    <p class="help">記録は、この端末のブラウザの中だけに保存されます。ときどき書き出しておくと安心です。</p>
  </div>`;
}

function onSettingChange(e) {
  const el = e.target;
  const k = el.dataset.k;
  if (!k) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'number') {
    const lo = +el.min || 1, hi = +el.max || 180;
    v = clamp(parseInt(el.value, 10) || lo, lo, hi);
    el.value = v;
  } else if (el.tagName === 'SELECT' && /^\d+$/.test(el.value)) v = +el.value;
  else v = el.value;
  if (k === 'workPresets') {
    const arr = [...S.workPresets];
    arr[+el.dataset.i] = v;
    S.workPresets = arr;
  } else S[k] = v;
  saveSettings(S);
  if (k === 'sound' && v) unlockAudio();
  if (k === 'shortcutName') renderSettings();
  ui.min = null;
}

async function exportData() {
  const data = { app: 'visual-timer', version: 1, exportedAt: new Date().toISOString(), settings: S, sessions: await db.allSessions() };
  const name = `visual-timer-${toDateInput(Date.now())}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data.sessions) ? data.sessions.filter((s) => s && s.id && TYPES[s.type] && s.start > 0 && s.end > 0) : [];
    if (!list.length) return toast('読み込める記録がありません');
    if (!confirm(`${list.length}件の記録を読み込みます。同じ記録は上書きされます。`)) return;
    for (const s of list) await db.putSession(s);
    if (data.settings && confirm('設定も読み込みますか？')) {
      S = { ...S, ...data.settings };
      saveSettings(S);
      renderSettings();
    }
    toast(`${list.length}件 読み込みました`);
  } catch {
    toast('ファイルを読み込めませんでした');
  }
}

// ---------- 画面の切り替えと操作 ----------
function showView(v) {
  view = v;
  ['timer', 'log', 'settings'].forEach((k) => {
    $(`#view-${k}`).classList.toggle('on', k === v);
    $(`#tab-${k}`).classList.toggle('on', k === v);
  });
  if (v === 'timer') renderTimer();
  if (v === 'log') renderLog();
  if (v === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

const actions = {
  tab: (v) => showView(v),
  type: (v) => { ui.type = v; ui.min = defMin(v); renderTimer(); },
  min: (v) => { ui.min = +v; renderTimer(); },
  step: (v) => { ui.min = stepMin(ui.min, +v > 0); renderTimer(); },
  nmin: (v) => { ui.nextMin = +v; renderTimer(); },
  nstep: (v) => { ui.nextMin = stepMin(ui.nextMin ?? defMin(ui.nextFor), +v > 0); renderTimer(); },
  label: (v) => { ui.label = v; store.set('vt-label', v); renderTimer(); },
  start: () => startTimer(ui.type, ui.min, ui.label),
  pause: () => togglePause(),
  stop: () => stopEarly(),
  resume: () => resumeStopped(),
  extend: () => extend(5),
  next: (v) => goNext(v),
  finish: () => finishHere(),
  logmode: (v) => { log.mode = v; renderLog(); },
  lognav: (v) => {
    const n = +v, d = new Date(log.date);
    log.date = log.mode === 'day' ? addDays(log.date, n)
      : log.mode === 'week' ? addDays(log.date, 7 * n)
      : new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
    renderLog();
  },
  lognow: () => { log.date = sod(Date.now()); renderLog(); },
  day: (v) => { log.mode = 'day'; log.date = +v; renderLog(); },
  edit: (v) => openEdit(v),
  add: () => openEdit(null),
  testsound: () => { unlockAudio(); chime(); },
  notif: async () => { await Notification.requestPermission(); renderSettings(); },
  'label-add': () => {
    const inp = $('#newLabel');
    const v = inp.value.trim();
    if (!v) return toast('ラベルの名前を入れてください');
    if (S.labels.includes(v)) return toast('同じラベルがあります');
    S.labels = [...S.labels, v];
    saveSettings(S);
    renderSettings();
  },
  'label-del': (v) => {
    const removed = S.labels[+v];
    S.labels = S.labels.filter((_, i) => i !== +v);
    if (ui.label === removed) { ui.label = ''; store.set('vt-label', ''); }
    saveSettings(S);
    renderSettings();
  },
  export: () => exportData(),
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.closest('.sheet-bg')) return;
  actions[b.dataset.act]?.(b.dataset.v);
});
// iPhone はタップの「指を離したとき」でないと音を許可しないので touchend と click で準備する
document.addEventListener('touchend', unlockAudio, { passive: true });
document.addEventListener('click', unlockAudio);
document.addEventListener('change', (e) => {
  if (e.target.id === 'importFile') {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
    return;
  }
  if (e.target.closest('#view-settings')) onSettingChange(e);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'newLabel') actions['label-add']();
  if (e.key === 'Escape') document.querySelector('.sheet-bg')?.remove();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (view === 'timer') renderTimer();
    if (view === 'log') renderLog();
  }
  updateWake();
});

// タブの見た目
$('#tab-timer').innerHTML = `${icon('timer')}タイマー`;
$('#tab-log').innerHTML = `${icon('chart')}きろく`;
$('#tab-settings').innerHTML = `${icon('sliders')}せってい`;

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

renderTimer();
setInterval(tick, 500);
