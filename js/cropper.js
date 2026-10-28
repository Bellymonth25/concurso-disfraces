// Editor para encuadrar la foto antes de subirla.
// Todas las tarjetas son 3:4 (vertical), así que el host decide qué parte se ve:
// arrastrar para mover, pellizcar / rueda / barra para acercar o alejar.
// Si se aleja más que el recuadro, lo que sobra se rellena con la misma foto desenfocada,
// así una foto horizontal (de grupo, por ejemplo) puede salir completa.

import { resizeImage } from './util.js';

const ASPECT = 3 / 4;

export async function cropPhoto(file, { outW = 960, quality = 0.85 } = {}) {
  // Primero se reduce a algo manejable para no cargar fotos de 200 MP en memoria
  const work = await resizeImage(file, 2400, 0.92);
  const url = URL.createObjectURL(work);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });

  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'pmodal crop-modal';
    dlg.innerHTML = `
      <h2>Encuadra la foto</h2>
      <div class="crop-frame">
        <img class="crop-bg" src="${url}" alt="" draggable="false">
        <img class="crop-img" src="${url}" alt="" draggable="false">
        <div class="crop-guides"></div>
      </div>
      <p class="crop-help">Arrastra para mover · pellizca o usa la barra para acercar</p>
      <div class="crop-zoom">
        <span>➖</span><input type="range" min="0" max="1000" value="0" aria-label="Zoom"><span>➕</span>
      </div>
      <div class="crop-quick">
        <button type="button" class="btn btn-ghost" data-q="cover">Llenar recuadro</button>
        <button type="button" class="btn btn-ghost" data-q="contain">Foto completa</button>
      </div>
      <div class="pmodal-actions">
        <button type="button" class="btn btn-primary btn-lg" data-ok>Usar esta foto</button>
        <button type="button" class="btn btn-ghost btn-lg" data-cancel>Cancelar</button>
      </div>`;
    document.body.append(dlg);
    dlg.showModal();

    const frame = dlg.querySelector('.crop-frame');
    const el = dlg.querySelector('.crop-img');
    const range = dlg.querySelector('input[type=range]');
    const W = img.naturalWidth, H = img.naturalHeight;
    let FW = frame.clientWidth, FH = frame.clientHeight;
    let minS, coverS, maxS, s, cx, cy;

    const setup = () => {
      FW = frame.clientWidth;
      FH = frame.clientHeight;
      coverS = Math.max(FW / W, FH / H);
      minS = Math.min(FW / W, FH / H);
      maxS = coverS * 4;
    };
    setup();
    s = coverS;
    cx = FW / 2;
    cy = FH / 2;

    // Si la foto es más grande que el recuadro, no deja huecos; si es más chica, la centra
    const clamp = () => {
      s = Math.min(maxS, Math.max(minS, s));
      const dw = W * s, dh = H * s;
      cx = dw >= FW ? Math.min(dw / 2, Math.max(FW - dw / 2, cx)) : FW / 2;
      cy = dh >= FH ? Math.min(dh / 2, Math.max(FH - dh / 2, cy)) : FH / 2;
    };
    const toRange = () => Math.round((Math.log(s / minS) / Math.log(maxS / minS)) * 1000);
    const fromRange = (v) => minS * Math.pow(maxS / minS, v / 1000);
    const draw = () => {
      clamp();
      el.style.width = `${W * s}px`;
      el.style.height = `${H * s}px`;
      el.style.transform = `translate(${cx - (W * s) / 2}px, ${cy - (H * s) / 2}px)`;
      range.value = toRange();
    };
    // Acercar/alejar manteniendo fijo el punto (px, py) del recuadro
    const zoomAt = (ns, px = FW / 2, py = FH / 2) => {
      ns = Math.min(maxS, Math.max(minS, ns));
      cx = px + (cx - px) * (ns / s);
      cy = py + (cy - py) * (ns / s);
      s = ns;
      draw();
    };
    draw();

    // Arrastrar y pellizcar
    const pts = new Map();
    let last = null;
    const local = (e) => {
      const r = frame.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const snapshot = () => {
      const p = [...pts.values()];
      if (p.length === 1) return { x: p[0][0], y: p[0][1], d: 0 };
      return { x: (p[0][0] + p[1][0]) / 2, y: (p[0][1] + p[1][1]) / 2, d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) };
    };
    frame.addEventListener('pointerdown', (e) => {
      try { frame.setPointerCapture(e.pointerId); } catch { /* sin captura también funciona */ }
      pts.set(e.pointerId, local(e));
      last = snapshot();
    });
    frame.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      const now = snapshot();
      if (last) {
        cx += now.x - last.x;
        cy += now.y - last.y;
        if (now.d && last.d) zoomAt(s * (now.d / last.d), now.x, now.y);
        else draw();
      }
      last = now;
    });
    const up = (e) => { pts.delete(e.pointerId); last = pts.size ? snapshot() : null; };
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
    frame.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = local(e);
      zoomAt(s * Math.exp(-e.deltaY * 0.0015), px, py);
    }, { passive: false });
    range.oninput = () => zoomAt(fromRange(Number(range.value)));
    dlg.querySelector('[data-q=cover]').onclick = () => { s = coverS; cx = FW / 2; cy = FH / 2; draw(); };
    dlg.querySelector('[data-q=contain]').onclick = () => { s = minS; cx = FW / 2; cy = FH / 2; draw(); };

    const close = (result) => {
      dlg.close();
      dlg.remove();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dlg.querySelector('[data-cancel]').onclick = () => close(null);
    dlg.querySelector('[data-ok]').onclick = () => {
      const outH = Math.round(outW / ASPECT);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const g = canvas.getContext('2d');
      const K = outW / FW;
      // Fondo: la misma foto desenfocada (por si se alejó más que el recuadro)
      g.fillStyle = '#111';
      g.fillRect(0, 0, outW, outH);
      if ('filter' in g) {
        const bs = Math.max(outW / W, outH / H);
        g.filter = 'blur(28px) brightness(.55)';
        g.drawImage(img, (outW - W * bs) / 2, (outH - H * bs) / 2, W * bs, H * bs);
        g.filter = 'none';
      }
      g.drawImage(img, (cx - (W * s) / 2) * K, (cy - (H * s) / 2) * K, W * s * K, H * s * K);
      canvas.toBlob((b) => close(b), 'image/jpeg', quality);
    };
  });
}
