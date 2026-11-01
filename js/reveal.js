// La animación de resultados en la TV, estilo "Fall Guys":
//   cuenta regresiva → todos aparecen en orden AL AZAR (sin votos ni lugar)
//   → los eliminados van cayendo uno por uno, también al azar
//   → los que se salvan se acomodan por lugar y se revelan votos + medallas 🥇🥈🥉
//   → en la final se detiene con los 3 finalistas (sin revelar su orden); el podio vive en podium.js.

import { esc, fitGrid, sleep } from './util.js';
import { photoHtml } from './components.js';
import { THEMES } from './themes.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const MEDALS = ['🥇', '🥈', '🥉'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function playReveal(stage, { round, tally, cmap, finalists = false, tie = false, nextLabel, theme = THEMES.clasico, animate = true }) {
  const ranked = [...round.candidateIds].sort((a, b) => (tally[b] || 0) - (tally[a] || 0));
  // Lugar "de competencia": empatados comparten lugar (1, 2, 2, 4…)
  const place = Object.fromEntries(ranked.map((id) => [id, 1 + ranked.filter((x) => (tally[x] || 0) > (tally[id] || 0)).length]));
  const qualified = new Set(round.qualifiedIds);
  const survivors = ranked.filter((id) => qualified.has(id));
  const losers = ranked.filter((id) => !qualified.has(id));
  const fast = !animate || reduced();

  stage.innerHTML = `
    <div class="rv">
      <div class="rv-banner"></div>
      <div class="rv-field"></div>
      <canvas class="rv-fx"></canvas>
    </div>`;
  const field = stage.querySelector('.rv-field');
  const banner = stage.querySelector('.rv-banner');
  const fx = stage.querySelector('.rv-fx');

  // Tarjetas con posición absoluta para poder moverlas libremente
  const cards = {};
  for (const id of ranked) {
    const c = cmap[id] || { name: '¿?' };
    const p = place[id];
    const el = document.createElement('div');
    el.className = 'rcard anon';
    el.innerHTML = `${photoHtml(c)}
      <div class="rcard-medal">${p <= 3 ? MEDALS[p - 1] : ''}</div>
      <div class="rcard-info"><span class="rcard-rank">#${p}</span><span class="rcard-name">${esc(c.name)}</span><span class="rcard-votes"><b>${tally[id] || 0}</b> voto${tally[id] === 1 ? '' : 's'}</span></div>
      <div class="rcard-stamp">${esc(theme.stamp)}</div>`;
    field.append(el);
    cards[id] = el;
  }

  const layout = (ids, aspect = 0.72) => {
    const W = field.clientWidth, H = field.clientHeight;
    const gap = Math.max(6, Math.min(18, W / 90));
    const g = fitGrid(ids.length, W, H, gap, aspect);
    const totalW = g.cols * g.cw + (g.cols - 1) * gap;
    const totalH = g.rows * g.ch + (g.rows - 1) * gap;
    const x0 = (W - totalW) / 2, y0 = (H - totalH) / 2;
    ids.forEach((id, i) => {
      const row = Math.floor(i / g.cols);
      // Centra la última fila si viene incompleta
      const inRow = row === g.rows - 1 ? ids.length - row * g.cols : g.cols;
      const rowOffset = ((g.cols - inRow) * (g.cw + gap)) / 2;
      const col = i % g.cols;
      const el = cards[id];
      el.style.width = `${g.cw}px`;
      el.style.height = `${g.ch}px`;
      el.style.setProperty('--x', `${x0 + rowOffset + col * (g.cw + gap)}px`);
      el.style.setProperty('--y', `${y0 + row * (g.ch + gap)}px`);
      el.style.fontSize = `${Math.max(9, Math.min(28, g.cw / 9))}px`;
    });
  };

  const showFinal = () => {
    // En la final los finalistas siguen "anónimos": su lugar se revela después, paso a paso
    const order = finalists ? shuffle(survivors) : survivors;
    order.forEach((id) => {
      const el = cards[id];
      el.classList.remove('safe');
      el.classList.add('shown', 'pass');
      if (finalists) { el.classList.add('finalist'); return; }
      el.classList.remove('anon');
      if (place[id] <= 3) el.classList.add(`medal-${place[id]}`);
    });
    layout(order, finalists ? 0.75 : 0.72);
    banner.innerHTML = bannerHtml({ finalists, tie, nextLabel, count: survivors.length, theme });
    banner.classList.add('show');
  };

  if (fast) {
    // Sin animación (TV recién abierta, cambio de tema…): directo al resultado
    losers.forEach((id) => cards[id].remove());
    field.classList.add('no-trans');
    stage.classList.add('no-trans');
    showFinal();
    void field.offsetWidth;
    requestAnimationFrame(() => { field.classList.remove('no-trans'); stage.classList.remove('no-trans'); });
    return;
  }

  // Todos en una cuadrícula en orden aleatorio: no se puede adivinar quién va ganando
  const shuffled = shuffle(ranked);
  layout(shuffled);
  field.classList.add('no-trans');
  void field.offsetWidth;
  field.classList.remove('no-trans');

  // 1. Cuenta regresiva
  for (const n of ['3', '2', '1']) {
    banner.innerHTML = `<div class="rv-count">${n}</div>`;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    await sleep(700);
  }
  banner.classList.remove('show');

  // 2. Aparecen todos, al azar
  const appear = Math.max(20, Math.min(90, 1800 / ranked.length));
  for (const id of shuffle(ranked)) {
    cards[id].classList.add('shown');
    await sleep(appear);
  }
  await sleep(1000);

  // 3. Los eliminados se van marcando en gris, uno por uno y en orden aleatorio;
  //    cuando ya están todos, caen a la vez, cada uno a su manera.
  if (losers.length) {
    banner.innerHTML = `<div class="rv-title danger">${esc(theme.danger)}</div>`;
    banner.classList.add('show');
    field.classList.add('tense');
    await sleep(1400);

    // Contador de eliminados: 0 / N → N / N
    const counter = document.createElement('div');
    counter.className = 'rv-counter';
    counter.innerHTML = `<span>${esc(theme.outCount)}</span><b>0</b><small>/ ${losers.length}</small>`;
    stage.querySelector('.rv').append(counter);
    const num = counter.querySelector('b');
    requestAnimationFrame(() => counter.classList.add('show'));

    // Ritmo constante (más corto si son muchos)
    const step = Math.max(260, Math.min(700, 7000 / losers.length));
    const order = shuffle(losers);
    for (let i = 0; i < order.length; i++) {
      cards[order[i]].classList.add('stamped');
      num.textContent = i + 1;
      counter.classList.remove('bump');
      void counter.offsetWidth;
      counter.classList.add('bump');
      await sleep(step);
    }
    await sleep(900);

    // Todos los marcados caen, con retraso, giro y deriva al azar
    field.classList.remove('tense');
    const rand = (a, b) => a + Math.random() * (b - a);
    for (const id of losers) {
      const el = cards[id];
      el.style.setProperty('--r', `${rand(-55, 55).toFixed(0)}deg`);
      el.style.setProperty('--dx', `${rand(-14, 14).toFixed(1)}vw`);
      el.style.transitionDelay = `${rand(0, 1200).toFixed(0)}ms`;
      el.classList.add('falling');
    }
    setTimeout(() => counter.classList.remove('show'), 1800);
    await sleep(2700);
    losers.forEach((id) => cards[id].remove());
    banner.classList.remove('show');
  }

  // 4. Los que se salvaron: brillan, luego se acomodan por lugar y se revelan votos y medallas
  survivors.forEach((id) => cards[id].classList.add('safe'));
  banner.innerHTML = finalists
    ? `<div class="rv-title gold">${esc(theme.finalists)}</div>`
    : `<div class="rv-title">${esc(theme.saved)}</div>`;
  banner.classList.add('show');
  await sleep(1400);
  banner.classList.remove('show');
  showFinal();
  survivors.forEach((id, i) => { cards[id].style.transitionDelay = `${Math.min(i * 40, 600)}ms`; });
  setTimeout(() => survivors.forEach((id) => { cards[id].style.transitionDelay = ''; }), 2000);
  burst(fx, 'embers', 3500);
}

function bannerHtml({ finalists, tie, nextLabel, count, theme }) {
  if (finalists && tie) return '<div class="rv-title">¡Empate por el 1er lugar! ⚔️ Va a desempate</div>';
  if (finalists) return `<div class="rv-title gold">${esc(theme.finalists)}</div>`;
  return `<div class="rv-title">${esc(theme.passTo(count, nextLabel))}</div>`;
}

// Partículas: brasas o confeti (los colores salen del tema)
export function burst(canvas, kind, duration) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const W = () => canvas.width, H = () => canvas.height;
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const colors = kind === 'confetti'
    ? [v('--orange'), v('--gold'), v('--purple'), v('--green'), v('--orange2'), '#ffffff']
    : [v('--orange'), v('--orange2'), v('--gold')];
  const parts = [];
  const spawn = (n) => {
    for (let i = 0; i < n; i++) {
      if (kind === 'confetti') {
        parts.push({ x: Math.random() * W(), y: -20 * dpr, vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr,
          r: (4 + Math.random() * 6) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length], life: 1 });
      } else {
        parts.push({ x: Math.random() * W(), y: H() + 10, vx: (Math.random() - 0.5) * 1.5 * dpr, vy: -(1.5 + Math.random() * 4) * dpr,
          r: (1.5 + Math.random() * 3.5) * dpr, a: 0, va: 0, c: colors[i % colors.length], life: 1 });
      }
    }
  };
  const t0 = performance.now();
  const frame = (t) => {
    const el = t - t0;
    if (el < duration) spawn(kind === 'confetti' ? 6 : 4);
    ctx.clearRect(0, 0, W(), H());
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      if (kind === 'confetti') { p.vy += 0.03 * dpr; p.vx *= 0.995; } else { p.life -= 0.006; }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c;
      if (kind === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      } else {
        ctx.shadowColor = p.c; ctx.shadowBlur = 12 * dpr;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.life <= 0 || p.y > H() + 40 || p.y < -60) parts.splice(i, 1);
    }
    ctx.globalAlpha = 1;
    if (parts.length || el < duration) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W(), H());
  };
  requestAnimationFrame(frame);
}
