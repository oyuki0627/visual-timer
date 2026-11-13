// タイマーの種類と色。fill = 円やボタンの塗り、tint = 薄い背景、ink = tint の上の文字、onFill = fill の上の文字
export const TYPES = {
  work:  { name: '作業',       verb: '作業にもどる', icon: 'work',   fill: '#91A2C0', tint: '#DDE3EE', ink: '#36435F', onFill: '#353C4E' },
  short: { name: '短い休憩',   verb: '休憩する',     icon: 'coffee', fill: '#BCC598', tint: '#E6EAD6', ink: '#4A5230', onFill: '#353C4E' },
  long:  { name: '長めの休憩', verb: '長めに休む',   icon: 'moon',   fill: '#F6CAC5', tint: '#FBE6E3', ink: '#7A4640', onFill: '#353C4E' },
  meal:  { name: '食事',       verb: '食事にする',   icon: 'bowl',   fill: '#E3AA7E', tint: '#F6E2D0', ink: '#6E4520', onFill: '#353C4E' },
};

export const DEFAULTS = {
  workMin: 25,
  workPresets: [15, 25, 50],
  short: 5,
  long: 15,
  meal: 45,
  longEnabled: true,
  longEvery: 4,
  mealOn: true,
  mealStart: '11:30',
  mealEnd: '13:30',
  renotify: 5,       // 分。0 = 再通知しない
  sound: true,
  wakeLock: false,
  showDigits: true,
  goal: 0,           // 1日の目標（分）。0 = なし
  labels: ['資料作成', '勉強', '家事'],
  shortcuts: false,
  shortcutName: 'ビジュアルタイマー',
};

const KEY = 'vt-settings';

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
