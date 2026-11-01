// Premiación de la Gran Final en la TV. El host avanza cada paso (game.finalStep):
//   -1  ¡EMPATE! por el 1er lugar → el host inicia el desempate
//    0  los finalistas, sin revelar su orden
//    1  se revela el 3er lugar en grande
//    2  duelo: los que quedan "trepan" hacia la cima y se revela al ganador
//    3  podio (1º, 2º, 3º) + estadísticas de los 3 + lista de cómo quedó el resto

import { esc, sleep } from './util.js';
import { photoHtml } from './components.js';
import { burst } from './reveal.js';

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const PLACE_NAME = { 1: '1er lugar', 2: '2º lugar', 3: '3er lugar' };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const card = (c, cls = '', extra = '') =>
  `<div class="fcard ${cls}">${photoHtml(c)}<div class="fcard-name">${esc(c?.name || '¿?')}</div>${extra}</div>`;

const finalVotes = (results, id) => results.history[id]?.find((h) => h.short === 'Final')?.votes ?? 0;
const votesTxt = (n, tail = '') => `<b>${n}</b> voto${n === 1 ? '' : 's'}${tail}`;

export async function renderFinalStep(stage, { step, results, cmap, theme, animate }) {
  const anim = animate && !reduced();
  const c = (id) => cmap[id] || { name: '¿?' };
  stage.innerHTML = `<div class="fin step${step} ${anim ? 'anim' : ''}"><div class="fin-banner"></div><div class="fin-body"></div><canvas class="rv-fx"></canvas></div>`;
  const root = stage.querySelector('.fin');
  const banner = root.querySelector('.fin-banner');
  const body = root.querySelector('.fin-body');
  const fx = root.querySelector('.rv-fx');
  const say = (html, cls = '') => { banner.innerHTML = `<div class="rv-title ${cls}">${html}</div>`; };

  // ---- -1: Empate por el 1er lugar ----
  if (step === -1) {
    const tied = results.winners;
    say('¡EMPATE!', 'tie-title');
    body.innerHTML = `
      <div class="fin-tie">${tied.map((id, i) => `${i ? '<div class="fin-vs">⚔️</div>' : ''}${card(c(id), 'tied', `<div class="fcard-votes">${votesTxt(finalVotes(results, id))}</div>`)}`).join('')}</div>
      <div class="fin-sub">Empate por el 1er lugar · ¡Se va a <b>desempate</b>!</div>`;
    if (anim) burst(fx, 'embers', 2500);
    return;
  }

  // ---- 0: Finalistas (sin orden) ----
  if (step === 0) {
    say(esc(theme.finalists), 'gold');
    body.innerHTML = `
      <div class="fin-row">${shuffle(results.finalists).map((id) => card(c(id), 'mystery')).join('')}</div>
      <div class="fin-sub">¿Quién se llevará el 1er lugar?</div>`;
    return;
  }

  const contenders = [...results.winners, ...results.seconds];

  // ---- 1: 3er lugar ----
  if (step === 1) {
    say(results.thirds.length > 1 ? '🥉 ¡Empate en el 3er lugar!' : results.thirds.length ? '🥉 Tercer lugar' : contenders.length > 2 ? '¡Empate por el 2º lugar!' : '¡Solo quedan dos!', 'bronze');
    body.innerHTML = `
      <div class="fin-third">
        <div class="fin-third-main">${results.thirds.map((id) => card(c(id), 'big bronze', `<div class="fcard-medal">🥉</div><div class="fcard-votes">${votesTxt(finalVotes(results, id), ' en la final')}</div>`)).join('')}</div>
        <div class="fin-third-side">
          <div class="fin-side-title">¿Quién ganará?</div>
          ${shuffle(contenders).map((id) => card(c(id), 'small mystery')).join('')}
        </div>
      </div>`;
    if (anim && results.thirds.length) burst(fx, 'embers', 2200);
    return;
  }

  // ---- 2: Duelo por la cima ----
  if (step === 2) {
    const winner = results.winners[0];
    const order = shuffle(contenders);
    body.innerHTML = `
      <div class="fin-duel" style="--goal:'${theme.duelGoal}'">${order.map((id) => `
        <div class="duel-lane" data-id="${esc(id)}">
          <div class="duel-track"><div class="duel-fill"></div></div>
          <div class="duel-runner">${card(c(id), 'runner', '<div class="fcard-medal"></div>')}</div>
        </div>`).join('')}
      </div>`;
    const lanes = [...body.querySelectorAll('.duel-lane')];
    const setPos = (lane, p) => lane.style.setProperty('--p', p.toFixed(3));
    const finish = () => {
      for (const lane of lanes) {
        const isW = lane.dataset.id === winner;
        setPos(lane, isW ? 1 : 0.72);
        lane.classList.add(isW ? 'won' : 'lost');
        lane.querySelector('.fcard-medal').textContent = isW ? '🥇' : '🥈';
      }
      say(esc(theme.duelWin(c(winner).name)), 'gold');
    };
    if (!anim) { finish(); return; }

    say(esc(theme.duelTitle));
    lanes.forEach((l) => setPos(l, 0));
    await sleep(900);
    // Carrera pareja: suben a saltos, el que va adelante cambia; al final el ganador se despega
    const pos = Object.fromEntries(order.map((id) => [id, 0]));
    const ticks = 9;
    for (let t = 0; t < ticks; t++) {
      const leader = order[Math.floor(Math.random() * order.length)];
      for (const id of order) {
        const boost = id === leader ? 0.09 : 0.05;
        pos[id] = Math.min(0.66, pos[id] + boost + Math.random() * 0.03);
      }
      lanes.forEach((l) => setPos(l, pos[l.dataset.id]));
      await sleep(520);
    }
    await sleep(500);
    root.classList.add('surge');
    finish();
    burst(fx, 'confetti', 9000);
    return;
  }

  // ---- 3: Podio + estadísticas + el resto ----
  const groups = { 1: results.winners, 2: results.seconds, 3: results.thirds };
  const block = (p) => `
    <div class="pod-col pod-${p}">
      <div class="pod-people">${groups[p].map((id) => card(c(id), 'pod', `<div class="fcard-medal">${MEDAL[p]}</div>`)).join('')}</div>
      <div class="pod-block"><span class="pod-num">${p}</span><span class="pod-label">${PLACE_NAME[p]}</span></div>
    </div>`;
  say('🏆 Podio final 🏆', 'gold');
  body.innerHTML = `
    <div class="fin-podium">
      <div class="pod-left">
        <div class="podium">${[2, 1, 3].filter((p) => groups[p].length).map(block).join('')}</div>
        ${results.others.length ? `
          <div class="pod-others">
            <div class="pod-others-title">Así quedaron los demás</div>
            <div class="pod-others-list"><div class="pod-others-inner">${results.others.map((o) => `
              <div class="pod-other"><b>${o.place}º</b><span>${esc(c(o.id).name)}</span><small>${o.votes} · ${esc(o.round)}</small></div>`).join('')}
            </div></div>
          </div>` : ''}
      </div>
      ${statsHtml(results, cmap)}
    </div>`;
  // Si la lista del resto no cabe, se desplaza sola de arriba a abajo
  const list = body.querySelector('.pod-others-list');
  if (list) {
    requestAnimationFrame(() => {
      const extra = list.scrollHeight - list.clientHeight;
      if (extra > 4) {
        list.classList.add('auto');
        list.style.setProperty('--scroll', `${-extra}px`);
        list.style.setProperty('--dur', `${Math.max(8, extra / 18)}s`);
      }
    });
  }
  if (anim) burst(fx, 'confetti', 6000);
}

// Estadísticas de los finalistas: una línea por persona con su lugar en cada ronda + tabla de votos
function statsHtml(results, cmap) {
  const ids = results.finalists;
  const rounds = [];
  for (const id of ids) for (const h of results.history[id]) if (!rounds.find((r) => r.label === h.label)) rounds.push({ label: h.label, short: h.short });
  const W = 600, H = 260, L = 50, R = 30, T = 30, B = 40;
  const n = rounds.length;
  const maxPlace = Math.max(2, ...ids.flatMap((id) => results.history[id].map((h) => h.place)));
  const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (p) => T + ((p - 1) / (maxPlace - 1)) * (H - T - B);
  const ticks = [...new Set([1, Math.ceil(maxPlace / 2), maxPlace])];
  const colorOf = (id) => ({ 1: 'var(--gold)', 2: '#d7dde6', 3: '#d08a4a' }[Math.min(3, results.places[id])]);
  const lines = ids.map((id, k) => {
    const pts = results.history[id].map((h) => [x(rounds.findIndex((r) => r.label === h.label)), y(h.place), h.place]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    return `
      <path class="rs-line multi" d="${d}" pathLength="1" style="stroke:${colorOf(id)};--dur:1.6s;animation-delay:${0.5 + k * 0.35}s"/>
      ${pts.map((p, i) => `<g class="rs-pt" style="--d:${(k * 0.35 + (i / Math.max(1, pts.length - 1)) * 1.6).toFixed(2)}s"><circle cx="${p[0]}" cy="${p[1]}" r="7" style="stroke:${colorOf(id)}"/><text x="${p[0]}" y="${p[1] - 14}" text-anchor="middle">#${p[2]}</text></g>`).join('')}`;
  }).join('');
  const cell = (id, r) => {
    const h = results.history[id].find((x2) => x2.label === r.label);
    return h ? `<span><b>${h.votes}</b><small>#${h.place}</small></span>` : '<span class="na">—</span>';
  };
  return `
    <div class="pod-stats rv-stats show">
      <div class="rs-kicker">Así llegaron al podio</div>
      <svg class="rs-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Lugar de cada finalista en cada ronda">
        ${ticks.map((p) => `<line class="rs-grid" x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}"/><text class="rs-axis" x="${L - 10}" y="${y(p) + 5}" text-anchor="end">#${p}</text>`).join('')}
        ${rounds.map((r, i) => `<text class="rs-axis" x="${x(i)}" y="${H - 12}" text-anchor="middle">${esc(r.short)}</text>`).join('')}
        ${lines}
      </svg>
      <div class="pod-table" style="--cols:${n}">
        <div class="pt-row pt-head"><span></span>${rounds.map((r) => `<span>${esc(r.short)}</span>`).join('')}<span>Total</span></div>
        ${ids.map((id, k) => `
          <div class="pt-row" style="--d:${(1.8 + k * 0.2).toFixed(2)}s">
            <span class="pt-name"><i style="background:${colorOf(id)}"></i>${MEDAL[Math.min(3, results.places[id])] || ''} ${esc(cmap[id]?.name || '¿?')}</span>
            ${rounds.map((r) => cell(id, r)).join('')}
            <span class="pt-total"><b>${results.history[id].reduce((a, h) => a + h.votes, 0)}</b></span>
          </div>`).join('')}
      </div>
    </div>`;
}
