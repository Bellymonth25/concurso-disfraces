// Piezas de interfaz que usan varias vistas

import { esc } from './util.js';

export function photoHtml(c, cls = '') {
  if (c?.photo) return `<img class="photo ${cls}" src="${esc(c.photo)}" alt="${esc(c.name)}" loading="lazy" draggable="false">`;
  return `<div class="photo photo-empty ${cls}">🎭</div>`;
}

export const byId = (contestants) => Object.fromEntries(contestants.map((c) => [c.id, c]));

// Gráfica "secreta": barras grises ordenadas, sin decir de quién es cada una.
// Muestra la línea de corte para ver qué tan cerrada está la cosa.
export function mountHiddenChart(el) {
  el.classList.add('hchart');
  el.innerHTML = '<div class="hchart-bars"></div><div class="hchart-cut"><span>corte</span></div>';
  const bars = el.firstElementChild;
  const cutEl = el.lastElementChild;
  return function update(rows, cut) {
    const n = rows.length;
    while (bars.children.length < n) {
      const b = document.createElement('div');
      b.className = 'hbar';
      b.innerHTML = '<i></i><b></b>';
      bars.append(b);
    }
    while (bars.children.length > n) bars.lastElementChild.remove();
    const max = Math.max(1, ...rows.map((r) => r.votes));
    el.style.setProperty('--n', n);
    // Con muchas barras los números se enciman: solo se muestran si caben
    el.classList.toggle('dense', el.clientWidth / Math.max(1, n) < 22);
    rows.forEach((r, i) => {
      const b = bars.children[i];
      b.style.setProperty('--h', `${(r.votes / max) * 100}%`);
      b.classList.toggle('above', i < cut);
      b.classList.toggle('zero', r.votes === 0);
      b.lastElementChild.textContent = r.votes || '';
    });
    const showCut = cut > 0 && cut < n;
    cutEl.hidden = !showCut;
    if (showCut) cutEl.style.left = `${(cut / n) * 100}%`;
  };
}

export function candidateCard(c, { self = false, selected = false, eliminated = false, extra = '' } = {}) {
  return `<button class="ccard ${selected ? 'sel' : ''} ${self ? 'self' : ''} ${eliminated ? 'out' : ''}" data-id="${esc(c.id)}" ${self ? 'disabled' : ''}>
    ${photoHtml(c)}
    <span class="ccard-name">${esc(c.name)}</span>
    ${self ? '<span class="ccard-tag">Tú 👻</span>' : ''}
    ${selected ? '<span class="ccard-check">✓</span>' : ''}
    ${extra}
  </button>`;
}

// Alerta integrada a la página (en vez de confirm() del navegador).
// actions: [{ label, value, kind: 'primary' | 'ghost' }] → resuelve con el value elegido.
export function showModal({ icon = '', title, html = '', actions = [{ label: 'Ok', value: true, kind: 'primary' }] }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'pmodal';
    dlg.innerHTML = `
      ${icon ? `<div class="pmodal-icon">${icon}</div>` : ''}
      <h2>${esc(title)}</h2>
      ${html ? `<div class="pmodal-body">${html}</div>` : ''}
      <div class="pmodal-actions">${actions.map((a, i) => `<button class="btn btn-lg ${a.kind === 'primary' ? 'btn-primary' : 'btn-ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`;
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => done(actions[Number(b.dataset.i)].value); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function roundLabel(round, game) {
  if (!round) return '';
  if (round.isTiebreak) return 'Desempate';
  if (round.cut === 1 || round.stage === game.cuts.length - 1) return 'Gran Final';
  return `Ronda ${round.number}`;
}
