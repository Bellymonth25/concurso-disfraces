// Vista de invitados (celular): entrar, votar y ver cómo va.

import { EVENT_TITLE, EVENT_SUBTITLE } from './config.js';
import { $, esc, store, deviceId, fmtTime, toast } from './util.js';
import { currentRound, effectiveStatus } from './logic.js';
import { themeOf } from './themes.js';
import { byId, candidateCard, mountHiddenChart, photoHtml, roundLabel, showModal } from './components.js';

const ID_KEY = 'disfraces-identity';

export function mountVoter(root, ctx) {
  const device = deviceId();
  let identity = store.get(ID_KEY);   // {kind:'contestant'|'spectator', id?, name?}
  let selection = new Set();
  let selRound = null;
  let lastKey = '';
  let updateChart = null;
  let sending = false;

  root.innerHTML = `
    <div class="voter">
      <header class="v-head">
        <div class="v-brand"><span class="v-title">${esc(EVENT_TITLE)}</span><span class="v-sub">${esc(EVENT_SUBTITLE)}</span></div>
        <div class="v-who"></div>
      </header>
      <main class="v-main"></main>
      <div class="v-bar" hidden></div>
    </div>`;
  const main = $('.v-main', root);
  const bar = $('.v-bar', root);
  const who = $('.v-who', root);

  // Link personal del concursante: /?code=K7P2
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode && identity?.kind !== 'contestant') join(urlCode);

  async function join(code) {
    try {
      const c = await ctx.backend.joinWithCode(code, device);
      if (!c) { toast('Ese código no existe 🤔', 'error'); return false; }
      identity = { kind: 'contestant', id: c.id, name: c.name };
      store.set(ID_KEY, identity);
      history.replaceState(null, '', location.pathname + location.hash);
      toast(`¡Hola, ${c.name}! 👻`);
      render(true);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }

  function renderWelcome() {
    who.innerHTML = '';
    bar.hidden = true;
    main.innerHTML = `
      <section class="welcome">
        <div class="welcome-emoji">${themeOf(ctx.state).welcome}</div>
        <h1>¿Estás concursando?</h1>
        <p>Si te tomaron foto para el concurso, el host te dio un código de 4 letras.</p>
        <div class="welcome-actions">
          <button class="btn btn-primary btn-lg" data-act="yes">Sí, tengo código</button>
          <button class="btn btn-ghost btn-lg" data-act="no">No, solo vengo a votar</button>
        </div>
        <form class="code-form" hidden>
          <label for="code-in">Tu código</label>
          <input id="code-in" class="code-input" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7P2">
          <button class="btn btn-primary btn-lg" type="submit">Entrar</button>
        </form>
      </section>`;
    const form = $('.code-form', main);
    main.querySelector('[data-act=yes]').onclick = () => { form.hidden = false; $('#code-in', main).focus(); };
    main.querySelector('[data-act=no]').onclick = () => {
      identity = { kind: 'spectator' };
      store.set(ID_KEY, identity);
      render(true);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const code = $('#code-in', main).value;
      if (code.trim().length < 4) return;
      await join(code);
    };
  }

  function renderWho(c) {
    if (identity.kind === 'contestant') {
      who.innerHTML = `<button class="who-chip" title="Cambiar">${c ? photoHtml(c, 'who-photo') : ''}<span>${esc(identity.name)}</span></button>`;
    } else {
      who.innerHTML = '<button class="who-chip"><span>👀 Votante</span></button>';
    }
    who.firstElementChild.onclick = async () => {
      const ok = await showModal({
        icon: '🔄', title: '¿Cambiar quién eres?',
        html: '<p>Vas a volver a la pantalla de inicio en este celular.</p>',
        actions: [{ label: 'Sí, cambiar', value: true, kind: 'primary' }, { label: 'Cancelar', value: false, kind: 'ghost' }],
      });
      if (!ok) return;
      store.del(ID_KEY);
      identity = null;
      render(true);
    };
  }

  function render(force = false) {
    if (!identity) {
      if (force || lastKey !== 'welcome') renderWelcome();
      lastKey = 'welcome';
      return;
    }
    const state = ctx.state;
    if (!state) return;
    const { game, contestants } = state;
    const cmap = byId(contestants);
    const round = currentRound(state);
    const now = ctx.now();
    const status = game.phase === 'running' || game.phase === 'finished' ? effectiveStatus(round, now) : null;
    const voted = round ? store.get(`disfraces-voted-${round.id}`) : null;
    const me = identity.kind === 'contestant' ? identity.id : null;
    if (round?.id !== selRound) { selection = new Set(); selRound = round?.id; }

    const theme = themeOf(state);
    const key = [game.phase, round?.id, status, !!voted, contestants.length, round?.candidateIds.length, me, game.theme,
      game.showcase ? `show:${game.spotlightId || ''}` : ''].join('|');
    if (!force && key === lastKey) {
      updateChart?.(ctx.tally, round?.cut);
      updateStats(round);
      return;
    }
    lastKey = key;
    updateChart = null;
    renderWho(cmap[me]);
    bar.hidden = true;

    // Si la votación está abierta, el desfile no tapa la pantalla de votar
    if (game.showcase && !(status === 'open' && !voted)) {
      const spot = cmap[game.spotlightId];
      main.innerHTML = `
        <section class="v-card center">
          <div class="big-emoji float">${theme.showIcon}</div>
          <h2>${esc(theme.showcaseTitle)}</h2>
          <p>${spot ? '' : 'Mira la pantalla, están pasando a desfilar'}</p>
          ${spot ? `<div class="v-winner v-spot">${photoHtml(spot)}<span>${esc(theme.spotlight)}: ${esc(spot.name)}</span></div>` : ''}
        </section>`;
      return;
    }

    if (game.phase === 'setup' || !round) {
      main.innerHTML = `
        <section class="v-card center">
          <div class="big-emoji float">${theme.waiting}</div>
          <h2>El concurso empieza pronto</h2>
          <p>Después del desfile se abre la votación aquí mismo. No cierres esta página.</p>
        </section>
        <h3 class="v-section">Disfraces registrados (${contestants.length})</h3>
        <div class="v-grid">${contestants.map((c) => candidateCard(c, { self: c.id === me })).join('')}</div>`;
      return;
    }

    const cands = round.candidateIds.map((id) => cmap[id]).filter(Boolean);
    const label = roundLabel(round, game);

    if (game.phase === 'finished') {
      const winners = game.winnerIds.map((id) => cmap[id]).filter(Boolean);
      const iWon = me && game.winnerIds.includes(me);
      main.innerHTML = `
        <section class="v-card center winner-card">
          <div class="big-emoji">👑</div>
          <h2>${iWon ? '¡GANASTE! 🎉' : '¡Tenemos ganador!'}</h2>
          ${winners.map((w) => `<div class="v-winner">${photoHtml(w)}<span>${esc(w.name)}</span></div>`).join('')}
          <p>Gracias por votar 🎃</p>
        </section>`;
      return;
    }

    if (status === 'ready') {
      main.innerHTML = `
        <section class="v-card center">
          <div class="v-round">${esc(label)}</div>
          <h2>Está por comenzar…</h2>
          <p>${cands.length} disfraces · pasan <b>${round.cut}</b> · tendrás <b>${round.votesPerVoter}</b> voto${round.votesPerVoter > 1 ? 's' : ''}</p>
        </section>
        <div class="v-grid">${cands.map((c) => candidateCard(c, { self: c.id === me })).join('')}</div>`;
      return;
    }

    if (status === 'open' && !voted) {
      const max = round.votesPerVoter;
      main.innerHTML = `
        <section class="v-vote-head">
          <div><div class="v-round">${esc(label)}</div>
          <h2>Elige ${max > 1 ? `hasta ${max} disfraces` : '1 disfraz'}</h2></div>
          <div class="v-timer" data-timer></div>
        </section>
        <div class="v-grid v-grid-vote">${cands.map((c) => candidateCard(c, { self: c.id === me, selected: selection.has(c.id) })).join('')}</div>`;
      main.querySelectorAll('.ccard:not(.self)').forEach((btn) => {
        btn.onclick = () => {
          const id = btn.dataset.id;
          if (selection.has(id)) selection.delete(id);
          else if (selection.size < max) selection.add(id);
          else if (max === 1) { selection.clear(); selection.add(id); }
          else { toast(`Solo tienes ${max} votos`); return; }
          main.querySelectorAll('.ccard').forEach((b) => {
            const on = selection.has(b.dataset.id);
            b.classList.toggle('sel', on);
            const chk = b.querySelector('.ccard-check');
            if (on && !chk) b.insertAdjacentHTML('beforeend', '<span class="ccard-check">✓</span>');
            if (!on && chk) chk.remove();
          });
          renderBar(round);
        };
      });
      renderBar(round);
      tick();
      return;
    }

    if (status === 'open' || status === 'closed') {
      const picks = (voted || []).map((id) => cmap[id]).filter(Boolean);
      main.innerHTML = `
        <section class="v-card center">
          ${status === 'open'
            ? `<div class="big-emoji">✅</div><h2>¡Votos enviados!</h2><div class="v-timer" data-timer></div>`
            : '<div class="big-emoji shake">⏰</div><h2>Votación cerrada</h2><p>Mira la pantalla, ya casi revelan…</p>'}
          ${picks.length ? `<div class="v-picks">${picks.map((c) => `<div class="v-pick">${photoHtml(c)}<span>${esc(c.name)}</span></div>`).join('')}</div>` : ''}
        </section>
        <section class="v-card">
          <h3>Así van los votos <span class="muted">(en secreto 🤫)</span></h3>
          <div class="v-chart"></div>
          <p class="v-stats muted"></p>
        </section>`;
      updateChart = mountHiddenChart($('.v-chart', main));
      updateChart(ctx.tally, round.cut);
      updateStats(round);
      tick();
      return;
    }

    if (status === 'revealed') {
      const q = round.qualifiedIds.map((id) => cmap[id]).filter(Boolean);
      const wasIn = me && round.candidateIds.includes(me);
      const passed = me && round.qualifiedIds.includes(me);
      // Medallas para los 3 primeros lugares (los empatados comparten lugar)
      const votes = Object.fromEntries(ctx.tally.filter((r) => r.id).map((r) => [r.id, r.votes]));
      const placeOf = (id) => 1 + q.filter((c) => (votes[c.id] || 0) > (votes[id] || 0)).length;
      const medal = (id) => {
        const p = placeOf(id);
        return q.length > 1 && p <= 3 ? `<span class="ccard-medal">${['🥇', '🥈', '🥉'][p - 1]}</span>` : '';
      };
      main.innerHTML = `
        ${wasIn ? `<section class="v-card center ${passed ? 'pass' : 'fail'}">
            <div class="big-emoji">${passed ? '🎉' : theme.outEmoji}</div>
            <h2>${passed ? theme.passTitle : theme.outTitle}</h2>
            <p>${passed ? 'Sigues en el concurso' : 'Pero aún puedes votar en las siguientes rondas'}</p>
          </section>` : ''}
        <h3 class="v-section">${q.length > 1 && round.stage >= game.cuts.length - 1 ? '¡Empate! Van a desempate' : `Pasan ${q.length}`}</h3>
        <div class="v-grid">${q.map((c) => candidateCard(c, { self: c.id === me, extra: medal(c.id) })).join('')}</div>`;
    }
  }

  function updateStats(round) {
    const el = $('.v-stats', main);
    if (el && round) el.textContent = `${round.voterCount} personas han votado · ${round.voteCount} votos`;
  }

  function renderBar(round) {
    const max = round.votesPerVoter;
    bar.hidden = false;
    bar.innerHTML = `
      <span class="v-count"><b>${selection.size}</b>/${max}</span>
      <button class="btn btn-primary btn-lg" ${selection.size === 0 || sending ? 'disabled' : ''}>${sending ? 'Enviando…' : `Votar${selection.size > 1 ? ` (${selection.size})` : ''}`}</button>`;
    bar.querySelector('button').onclick = async () => {
      const ids = [...selection];
      if (ids.length < max) {
        const left = max - ids.length;
        const ok = await showModal({
          icon: '🗳️',
          title: `¡Aún te ${left === 1 ? 'queda' : 'quedan'} ${left} voto${left === 1 ? '' : 's'}!`,
          html: `<div class="pmodal-dots">${Array.from({ length: max }, (_, i) => `<i class="${i < ids.length ? 'on' : ''}"></i>`).join('')}</div>
            <p>Elegiste <b>${ids.length} de ${max}</b>. Si envías ahora, los votos que no uses se pierden y <b>ya no podrás cambiarlos</b>.</p>`,
          actions: [
            { label: 'Seguir eligiendo', value: false, kind: 'primary' },
            { label: `Enviar solo ${ids.length}`, value: true, kind: 'ghost' },
          ],
        });
        if (!ok) return;
      }
      sending = true;
      renderBar(round);
      try {
        await ctx.backend.castVotes(device, round.id, ids);
        store.set(`disfraces-voted-${round.id}`, ids);
        toast('¡Voto registrado! 🎃', 'ok');
      } catch (e) {
        if (/ya votaste/i.test(e.message)) store.set(`disfraces-voted-${round.id}`, []);
        toast(e.message, 'error');
      } finally {
        sending = false;
      }
      render(true);
      ctx.refresh();
    };
  }

  function tick() {
    const el = $('[data-timer]', main);
    const round = ctx.state && currentRound(ctx.state);
    if (!round) return;
    const status = effectiveStatus(round, ctx.now());
    if (el) {
      if (round.status === 'open' && round.endsAt) {
        const left = round.endsAt - ctx.now();
        el.textContent = `⏳ ${fmtTime(left)}`;
        el.classList.toggle('urgent', left < 10000);
      } else el.textContent = '';
    }
    // El tiempo se acabó: cambiar de pantalla sin esperar al host
    const key = lastKey.split('|');
    if (key[2] && key[2] !== String(status)) render();
  }

  const timer = setInterval(tick, 250);
  const off = ctx.subscribe(() => render());
  render(true);
  return () => { clearInterval(timer); off(); };
}
