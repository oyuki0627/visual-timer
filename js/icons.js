// 線のアイコン（24x24）
const P = {
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevL: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chevR: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2.5h4"/>',
  chart: '<path d="M5 20v-6M12 20V5M19 20v-9"/>',
  sliders: '<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  work: '<path d="M4.5 19.5l3.8-.9L19 7.9a2 2 0 0 0-2.9-2.9L5.4 15.7z"/><path d="M14.5 6.5l3 3"/>',
  coffee: '<path d="M4 9h12v4.5A5.5 5.5 0 0 1 10.5 19h-1A5.5 5.5 0 0 1 4 13.5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M12 3.5v2.5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>',
  bowl: '<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0z"/><path d="M9 8c0-1.8 1.5-1.8 1.5-3.5M13.5 8c0-1.8 1.5-1.8 1.5-3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
};

export function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
