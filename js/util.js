// Utilidades compartidas

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Sin letras que se confunden (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// localStorage que no truena en modo incógnito o con storage bloqueado
const mem = {};
export const store = {
  get(k) { try { const v = localStorage.getItem(k); return v === null ? mem[k] ?? null : JSON.parse(v); } catch { return mem[k] ?? null; } },
  set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ok */ } },
  del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch { /* ok */ } },
};

export function deviceId() {
  let id = store.get('disfraces-device');
  if (!id) { id = uid(); store.set('disfraces-device', id); }
  return id;
}

// Reduce la foto antes de subirla (las fotos de celular pesan 3-8 MB)
export async function resizeImage(file, maxSide = 800, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// QR como SVG (usa la librería global qrcode-generator)
export function qrSvg(text, { dark = '#0d0714', light = '#ffffff' } = {}) {
  if (typeof window.qrcode !== 'function') return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 2; // margen
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  const size = n + m * 2;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

// Mejor cuadrícula para meter n tarjetas (proporción w/h) en un área
export function fitGrid(n, W, H, gap = 12, aspect = 0.78) {
  let best = { cols: 1, rows: n, cw: 0, ch: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    let cw = (W - gap * (cols - 1)) / cols;
    let ch = cw / aspect;
    const maxCh = (H - gap * (rows - 1)) / rows;
    if (ch > maxCh) { ch = maxCh; cw = ch * aspect; }
    if (cw > best.cw) best = { cols, rows, cw, ch };
  }
  return best;
}

export function throttle(fn, ms) {
  let last = 0, timer = null;
  return () => {
    const wait = last + ms - Date.now();
    if (wait <= 0) { last = Date.now(); fn(); return; }
    if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(); }, wait);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function toast(msg, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}
