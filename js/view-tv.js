// Pantalla grande (TV / proyector)

import { EVENT_TITLE, EVENT_SUBTITLE } from './config.js';
import { $, esc, fitGrid, fmtTime, qrSvg } from './util.js';
import { currentRound, effectiveStatus, showcaseIds } from './logic.js';
import { byId, mountHiddenChart, photoHtml, roundLabel } from './components.js';
import { playReveal } from './reveal.js';
import { themeOf } from './themes.js';

const BAT = '<svg viewBox="0 0 64 32"><path d="M32 10c-2-4-5-6-5-6s1 4 0 6c-5-3-12-3-17-1 4 1 7 4 7 7-4-2-9-1-12 1 7 0 12 4 14 9 3-3 7-4 13-3 6-1 10 0 13 3 2-5 7-9 14-9-3-2-8-3-12-1 0-3 3-6 7-7-5-2-12-2-17 1-1-2 0-6 0-6s-3 2-5 6z" fill="currentColor"/></svg>';

export function mountTv(root, ctx) {
  root.innerHTML = `
    <div class="tv">
      <div class="tv-bg" aria-hidden="true">
        <div class="fog fog1"></div><div class="fog fog2"></div>
        ${Array.from({ length: 6 }, (_, i) => `<div class="bat bat${i}">${BAT}</div>`).join('')}
        <div class="zombie-decor">
          <div class="biohazard">☣</div>
          <div class="splat s1"></div><div class="splat s2"></div><div class="splat s3"></div>
          <div class="siren"></div>
          <div class="tape tape-top"><span>${'ZONA INFECTADA · NO ENTRAR · ☣ · '.repeat(12)}</span></div>
          <div class="tape tape-bottom"><span>${'PRECAUCIÓN · ALTO RIESGO DE CONTAGIO · ☣ · '.repeat(10)}</span></div>
        </div>
        <div class="muertos-decor">
          <div class="papel">${Array.from({ length: 14 }, (_, i) => `<i class="p${i % 5}"></i>`).join('')}</div>
          ${Array.from({ length: 14 }, (_, i) => `<span class="petal pt${i}">🌼</span>`).join('')}
          <div class="candles">🕯️ 🕯️ 🕯️</div>
        </div>
      </div>
      <header class="tv-head">
        <div class="tv-brand"><h1>${esc(EVENT_TITLE)}</h1><span>${esc(EVENT_SUBTITLE)}</span></div>
        <div class="tv-round"></div>
        <div class="tv-timer"></div>
      </header>
      <div class="tv-body">
        <main class="tv-stage"></main>
        <aside class="tv-side">
          <div class="tv-qr"></div>
          <div class="tv-join">Escanea para votar</div>
          <div class="tv-url"></div>
          <div class="tv-stats"></div>
        </aside>
      </div>
      <div class="tv-marquee"></div>
    </div>`;

  const stage = $('.tv-stage', root);
  const side = $('.tv-side', root);
  const roundEl = $('.tv-round', root);
  const timerEl = $('.tv-timer', root);
  const statsEl = $('.tv-stats', root);
  const marquee = $('.tv-marquee', root);
  $('.tv-qr', root).innerHTML = qrSvg(ctx.voterUrl);
  $('.tv-url', root).textContent = ctx.voterUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  let lastKey = '';
  let lastRoundStatus = {};   // roundId -> status visto
  let busy = false;           // animación en curso
  let updateChart = null;
  const seen = new Set();

  function render(force = false) {
    const state = ctx.state;
    if (!state) return;
    const { game, contestants } = state;
    const cmap = byId(contestants);
    const round = game.phase === 'setup' ? null : currentRound(state);
    const now = ctx.now();
    const status = effectiveStatus(round, now);

    roundEl.innerHTML = round
      ? `<span class="pill">${esc(roundLabel(round, game))}</span><span class="tv-round-sub">${round.candidateIds.length} disfraces · pasan ${round.cut}</span>`
      : `<span class="pill">Registro</span><span class="tv-round-sub">${contestants.length} disfraces</span>`;
    statsEl.innerHTML = round && status !== 'ready'
      ? `<div><b>${round.voterCount}</b> votantes</div><div><b>${round.voteCount}</b> votos</div>`
      : '';

    const theme = themeOf(state);
    const key = [game.phase === 'setup' ? 'setup' : 'run', round?.id, status, contestants.length, game.theme,
      game.showcase ? `show:${game.spotlightId || ''}` : ''].join('|');
    // Una animación en curso solo se interrumpe si el host entra al modo desfile
    if (busy && !game.showcase) return;
    if (!force && key === lastKey) {
      updateChart?.(ctx.tally, round?.cut);
      return;
    }
    lastKey = key;
    updateChart = null;
    root.querySelector('.tv').dataset.status = game.showcase ? 'showcase' : status || 'setup';

    if (game.showcase) { busy = false; renderShowcase(state, cmap, theme); return; }

    if (!round) { renderSetup(contestants, theme); renderMarquee([]); return; }

    const cands = round.candidateIds.map((id) => cmap[id]).filter(Boolean);
    const prev = lastRoundStatus[round.id];
    lastRoundStatus[round.id] = status;

    if (status === 'ready') {
      stage.innerHTML = `
        <div class="splash">
          <div class="splash-mosaic">${cands.slice(0, 60).map((c) => photoHtml(c)).join('')}</div>
          <div class="splash-text">
            <div class="splash-kicker">Prepárense…</div>
            <div class="splash-title">${esc(roundLabel(round, game))}</div>
            <div class="splash-sub">${cands.length} disfraces · pasan <b>${round.cut}</b> · <b>${round.votesPerVoter}</b> voto${round.votesPerVoter > 1 ? 's' : ''} por persona</div>
          </div>
        </div>`;
      renderMarquee(cands);
      return;
    }

    if (status === 'open' || status === 'closed') {
      stage.innerHTML = `
        <div class="tv-chart-wrap">
          <div class="tv-chart-title">${status === 'open' ? '¡Voten! Los resultados están ocultos 🤫' : ''}</div>
          <div class="tv-chart"></div>
          ${status === 'closed' ? `<div class="times-up">${esc(theme.timesUp)}</div>` : ''}
        </div>`;
      updateChart = mountHiddenChart($('.tv-chart', stage));
      updateChart(ctx.tally, round.cut);
      renderMarquee(cands);
      return;
    }

    if (status === 'revealed') {
      renderMarquee([]);
      const tally = Object.fromEntries(ctx.tally.filter((r) => r.id).map((r) => [r.id, r.votes]));
      const q = round.qualifiedIds;
      const last = game.cuts.length - 1;
      let next = round.stage + 1;
      while (next < last && game.cuts[next] >= q.length) next++;
      const animate = !!prev && prev !== 'revealed';
      busy = animate;
      side.classList.add('mini');
      const finalWinner = q.length === 1 ? q[0] : null;
      playReveal(stage, {
        round, tally, cmap, theme, finalWinner,
        history: finalWinner ? winnerHistory(state, finalWinner) : null,
        tie: q.length > 1 && round.stage >= last,
        nextLabel: next >= last ? 'la Gran Final' : `la Ronda ${round.number + 1}`,
        animate,
      }).finally(() => { busy = false; });
      return;
    }
  }

  // Lugar y votos del ganador en cada ronda que jugó (para la gráfica final)
  async function winnerHistory(state, wid) {
    const last = state.game.cuts.length - 1;
    const rounds = state.rounds.filter((r) => r.status === 'revealed' && r.candidateIds.includes(wid)).sort((a, b) => a.id - b.id);
    const out = [];
    for (const r of rounds) {
      const rows = r.id === state.game.currentRoundId ? ctx.tally : await ctx.backend.fetchTally(r.id);
      const t = Object.fromEntries(rows.filter((x) => x.id).map((x) => [x.id, x.votes]));
      const v = t[wid] || 0;
      out.push({
        label: roundLabel(r, state.game),
        short: r.isTiebreak ? 'Desempate' : r.stage >= last ? 'Final' : `Ronda ${r.number}`,
        place: 1 + r.candidateIds.filter((id) => (t[id] || 0) > v).length,
        of: r.candidateIds.length,
        votes: v,
      });
    }
    return out;
  }

  // Modo desfile: cuadrícula de los que siguen y, si el host elige a alguien, pantalla completa
  function renderShowcase(state, cmap, theme) {
    renderMarquee([]);
    side.classList.add('mini');
    const people = showcaseIds(state).map((id) => cmap[id]).filter(Boolean);
    const spot = cmap[state.game.spotlightId];
    stage.innerHTML = `
      <div class="tv-reg showcase ${spot ? 'has-spot' : ''}">
        <div class="tv-reg-title">${theme.showIcon} ${esc(theme.showcaseTitle)} · ${people.length}</div>
        <div class="tv-reg-grid"></div>
      </div>
      ${spot ? `
        <div class="spot">
          <div class="spot-kicker">${esc(theme.spotlight)}</div>
          <div class="spot-card">${photoHtml(spot)}</div>
          <div class="spot-name">${esc(spot.name)}</div>
        </div>` : ''}`;
    const grid = $('.tv-reg-grid', stage);
    requestAnimationFrame(() => {
      const g = fitGrid(people.length, grid.clientWidth, grid.clientHeight, 12, 0.72);
      grid.style.gridTemplateColumns = `repeat(${g.cols}, ${g.cw}px)`;
      grid.style.gridAutoRows = `${g.ch}px`;
      grid.style.fontSize = `${Math.max(10, Math.min(26, g.cw / 9))}px`;
      grid.innerHTML = people.map((c) => `<div class="reg-card ${c.id === spot?.id ? 'lit' : ''}">${photoHtml(c)}<span>${esc(c.name)}</span></div>`).join('');
    });
  }

  function renderSetup(contestants, theme) {
    side.classList.remove('mini');
    if (!contestants.length) {
      stage.innerHTML = `
        <div class="tv-empty">
          <div class="tv-empty-emoji">${theme.welcome}</div>
          <div class="tv-empty-title">${esc(theme.emptyTitle)}</div>
          <div class="tv-empty-sub">${esc(theme.emptySub)}</div>
        </div>`;
      return;
    }
    stage.innerHTML = '<div class="tv-reg"><div class="tv-reg-title">Ya están en el concurso</div><div class="tv-reg-grid"></div></div>';
    const grid = $('.tv-reg-grid', stage);
    requestAnimationFrame(() => {
      const g = fitGrid(contestants.length, grid.clientWidth, grid.clientHeight, 12, 0.72);
      grid.style.gridTemplateColumns = `repeat(${g.cols}, ${g.cw}px)`;
      grid.style.gridAutoRows = `${g.ch}px`;
      grid.style.fontSize = `${Math.max(10, Math.min(26, g.cw / 9))}px`;
      grid.innerHTML = contestants.map((c) => {
        const isNew = !seen.has(c.id);
        return `<div class="reg-card ${isNew ? 'pop' : ''}">${photoHtml(c)}<span>${esc(c.name)}</span></div>`;
      }).join('');
      contestants.forEach((c) => seen.add(c.id));
    });
  }

  function renderMarquee(cands) {
    side.classList.toggle('mini', false);
    if (!cands.length) { marquee.innerHTML = ''; marquee.hidden = true; return; }
    marquee.hidden = false;
    const items = cands.map((c) => `<div class="mq-item">${photoHtml(c)}<span>${esc(c.name)}</span></div>`).join('');
    const loop = cands.length > 8;
    marquee.innerHTML = `<div class="mq-track ${loop ? 'loop' : ''}" style="--dur:${Math.max(20, cands.length * 2.5)}s">${items}${loop ? items : ''}</div>`;
  }

  function tick() {
    const round = ctx.state && ctx.state.game.phase !== 'setup' ? currentRound(ctx.state) : null;
    if (round && round.status === 'open') {
      if (round.endsAt) {
        const left = round.endsAt - ctx.now();
        timerEl.innerHTML = left > 0 ? `<span class="${left < 10000 ? 'urgent' : ''}">${fmtTime(left)}</span>` : '<span class="urgent">0:00</span>';
      } else timerEl.innerHTML = '<span class="live">● EN VIVO</span>';
    } else timerEl.innerHTML = '';
    // Pasar a "se acabó el tiempo" sin esperar al host
    const status = effectiveStatus(round, ctx.now());
    if (round && lastKey.split('|')[2] !== String(status) && !busy) render();
  }

  const t = setInterval(tick, 250);
  const off = ctx.subscribe(() => render());
  let rz;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => render(true), 200); };
  window.addEventListener('resize', onResize);
  render(true);
  return () => { clearInterval(t); off(); window.removeEventListener('resize', onResize); };
}
