// Panel del host: registrar disfraces, configurar rondas y manejar la votación.

import { EVENT_TITLE } from './config.js';
import { $, esc, fmtTime, qrSvg, resizeImage, store, toast } from './util.js';
import { currentRound, defaultVotesPlan, effectiveStatus, hostActions, parseCuts, computeQualifiers, showcaseIds } from './logic.js';
import { byId, photoHtml, roundLabel } from './components.js';
import { THEMES, themeOf } from './themes.js';

const TIMERS = [[0, 'Sin límite'], [30, '30 s'], [60, '1 min'], [90, '1:30'], [120, '2 min'], [180, '3 min'], [300, '5 min']];

export function mountHost(root, ctx) {
  const { backend } = ctx;
  const actions = hostActions(backend, () => ctx.state, ctx.now);
  let codes = {};
  let timerSec = store.get('disfraces-timer') ?? 60;
  let showReal = false;
  let realTally = null;
  let working = false;
  let configDirty = false;
  let alive = true;

  async function start() {
    const session = await backend.getSession();
    if (!session) return renderLogin();
    renderPanel(session);
  }

  function renderLogin() {
    root.innerHTML = `
      <div class="host host-login">
        <form class="h-card login">
          <h1>🎃 Panel del host</h1>
          <label>Correo<input name="email" type="email" required autocomplete="username"></label>
          <label>Contraseña<input name="password" type="password" required autocomplete="current-password"></label>
          <button class="btn btn-primary btn-lg">Entrar</button>
          <p class="muted">El usuario se crea en Supabase → Authentication → Users.</p>
        </form>
      </div>`;
    $('form', root).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const s = await backend.signIn(f.get('email'), f.get('password'));
        renderPanel(s);
        ctx.refresh();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function renderPanel(session) {
    const demo = backend.mode === 'demo';
    root.innerHTML = `
      <div class="host">
        <header class="h-head">
          <div><h1>🎃 ${esc(EVENT_TITLE)}</h1><span class="muted">Panel del host ${demo ? '· <b class="demo-chip">MODO DEMO</b>' : `· ${esc(session.email)}`}</span></div>
          <div class="h-links">
            <a class="btn btn-ghost" href="#tv" target="_blank" rel="noopener">📺 Abrir TV</a>
            <a class="btn btn-ghost" href="./" target="_blank" rel="noopener">📱 Vista invitado</a>
            ${demo ? '' : '<button class="btn btn-ghost" data-act="logout">Salir</button>'}
          </div>
        </header>

        <section class="h-card h-control"><div class="h-control-body"></div></section>

        <section class="h-card">
          <h2>Tema de la fiesta</h2>
          <div class="h-themes">${Object.entries(THEMES).map(([id, t]) => `
            <button class="h-theme" data-theme-id="${id}">
              <span class="h-theme-sw">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
              <span class="h-theme-emoji">${t.emoji}</span>
              <b>${esc(t.name)}</b>
              <span class="muted small">${esc(t.desc)}</span>
            </button>`).join('')}
          </div>
          <p class="muted small">Cambia al instante en la TV y en todos los celulares. Se puede cambiar en cualquier momento.</p>
        </section>

        <div class="h-cols">
          <section class="h-card">
            <h2>Concursantes <span class="h-count"></span></h2>
            <form class="h-add">
              <label class="h-photo-pick">
                <input type="file" accept="image/*" capture="environment" hidden>
                <div class="h-photo-preview"><span>📷<br>Tomar foto</span></div>
              </label>
              <div class="h-add-fields">
                <input name="name" placeholder="Nombre o disfraz (ej. Ana – Bruja)" maxlength="40" required autocomplete="off">
                <button class="btn btn-primary">Agregar al concurso</button>
              </div>
            </form>
            <div class="h-list"></div>
          </section>

          <section class="h-card">
            <h2>Rondas</h2>
            <p class="muted">¿Cuántos pasan después de cada ronda? Termina siempre en 1 ganador.</p>
            <div class="h-cuts-row">
              <input class="h-cuts" placeholder="25, 10, 5, 1">
              <button class="btn btn-ghost" data-act="auto-plan">Votos automáticos</button>
            </div>
            <div class="h-plan"></div>
            <button class="btn btn-primary" data-act="save-config">Guardar rondas</button>
            <p class="muted small">Empates en el corte: pasan todos los empatados. Si la final empata, se hace desempate.</p>
          </section>
        </div>

        <section class="h-card h-danger">
          <h2>Zona peligrosa</h2>
          <div class="h-danger-row">
            <button class="btn btn-ghost" data-act="reset">↺ Reiniciar concurso (deja las fotos)</button>
            ${demo ? '<button class="btn btn-ghost" data-act="seed">🎭 Cargar 20 disfraces de prueba</button><button class="btn btn-ghost" data-act="wipe">🗑️ Borrar todo el demo</button>' : ''}
          </div>
        </section>
      </div>
      <dialog class="h-modal"></dialog>`;

    // ---- Foto + nombre ----
    let photoBlob = null;
    const fileIn = $('.h-photo-pick input', root);
    const preview = $('.h-photo-preview', root);
    fileIn.onchange = async () => {
      const f = fileIn.files[0];
      if (!f) return;
      try {
        photoBlob = await resizeImage(f, backend.mode === 'demo' ? 420 : 800, backend.mode === 'demo' ? 0.7 : 0.82);
        preview.innerHTML = `<img src="${URL.createObjectURL(photoBlob)}" alt="">`;
      } catch { toast('No se pudo leer la foto', 'error'); }
    };
    $('.h-add', root).onsubmit = async (e) => {
      e.preventDefault();
      const nameIn = e.target.elements.name;
      const name = nameIn.value.trim();
      if (!name) return;
      if (!photoBlob && !confirm('¿Agregar sin foto?')) return;
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Subiendo…';
      try {
        const { id, code } = await backend.addContestant(name, photoBlob);
        codes[id] = code;
        showCode(name, code);
        nameIn.value = '';
        photoBlob = null;
        fileIn.value = '';
        preview.innerHTML = '<span>📷<br>Tomar foto</span>';
        ctx.refresh();
      } catch (err) { toast(err.message, 'error'); }
      btn.disabled = false;
      btn.textContent = 'Agregar al concurso';
    };

    // ---- Config de rondas ----
    const cutsIn = $('.h-cuts', root);
    cutsIn.oninput = () => { configDirty = true; renderPlan(parseCuts(cutsIn.value), null); };
    root.querySelector('[data-act=auto-plan]').onclick = () => {
      configDirty = true;
      const cuts = parseCuts(cutsIn.value);
      renderPlan(cuts, defaultVotesPlan(cuts.length));
    };
    root.querySelector('[data-act=save-config]').onclick = async () => {
      const cuts = parseCuts(cutsIn.value);
      const plan = [...root.querySelectorAll('.h-plan input')].map((i) => Math.max(1, Number(i.value) || 1));
      try {
        await actions.saveConfig(cuts, plan.length === cuts.length ? plan : defaultVotesPlan(cuts.length));
        configDirty = false;
        toast('Rondas guardadas ✅', 'ok');
        ctx.refresh();
      } catch (err) { toast(err.message, 'error'); }
    };

    root.querySelectorAll('[data-theme-id]').forEach((b) => {
      b.onclick = () => run(() => backend.updateGame({ theme: b.dataset.themeId }));
    });

    root.querySelector('[data-act=reset]').onclick = () => run(async () => {
      if (!confirm('¿Reiniciar el concurso? Se borran rondas y votos (los concursantes se quedan).')) return;
      await actions.reset();
    });
    root.querySelector('[data-act=logout]')?.addEventListener('click', async () => { await backend.signOut(); renderLogin(); });
    root.querySelector('[data-act=seed]')?.addEventListener('click', () => run(() => backend.seedFake(20)));
    root.querySelector('[data-act=wipe]')?.addEventListener('click', () => run(async () => {
      if (confirm('¿Borrar TODO el demo?')) await backend.wipeAll();
    }));

    loadCodes();
    render();
  }

  let loadingCodes = false;
  async function loadCodes() {
    loadingCodes = true;
    try { codes = await backend.adminCodes(); } catch (e) { console.warn(e); }
    // Pequeña pausa para no pedir los códigos en bucle si alguno falta
    setTimeout(() => { loadingCodes = false; }, 3000);
    render();
  }

  function renderPlan(cuts, plan) {
    const box = $('.h-plan', root);
    if (!box) return;
    const old = [...box.querySelectorAll('input')].map((i) => Number(i.value));
    const p = plan || (old.length === cuts.length ? old : defaultVotesPlan(cuts.length));
    box.innerHTML = cuts.map((cut, i) => `
      <div class="h-plan-row">
        <span class="h-plan-name">${i === cuts.length - 1 ? 'Final' : `Ronda ${i + 1}`}</span>
        <span>pasan <b>${cut}</b></span>
        <label>votos c/u <input type="number" min="1" max="10" value="${p[i] ?? 1}"></label>
      </div>`).join('');
    box.querySelectorAll('input').forEach((i) => { i.oninput = () => { configDirty = true; }; });
  }

  // Muestra el código grande + QR personal para que el concursante lo escanee
  function showCode(name, code) {
    const dlg = $('.h-modal', root);
    const link = `${ctx.voterUrl}?code=${code}`;
    dlg.innerHTML = `
      <div class="code-modal">
        <p>Código de <b>${esc(name)}</b></p>
        <div class="code-big">${esc(code)}</div>
        <div class="code-qr">${qrSvg(link)}</div>
        <p class="muted">Que escanee este QR con su celular (o escriba el código). Así no podrá votar por sí mismo.</p>
        <button class="btn btn-primary btn-lg" data-close>Listo</button>
      </div>`;
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.showModal();
  }

  async function run(fn) {
    if (working) return;
    working = true;
    render();
    try { await fn(); } catch (e) { toast(e.message, 'error'); }
    working = false;
    await ctx.refresh();
  }

  function render() {
    const state = ctx.state;
    if (!state || !$('.h-control-body', root)) return;
    const { game, contestants } = state;
    const cmap = byId(contestants);
    const round = game.phase === 'setup' ? null : currentRound(state);

    // Config
    const cutsIn = $('.h-cuts', root);
    const running = game.phase !== 'setup';
    if (!configDirty && document.activeElement !== cutsIn) {
      cutsIn.value = game.cuts.join(', ');
      renderPlan(game.cuts, game.votesPlan);
    }
    root.querySelectorAll('.h-cuts, .h-plan input, [data-act=save-config], [data-act=auto-plan]').forEach((el) => { el.disabled = running; });

    root.querySelectorAll('[data-theme-id]').forEach((b) => b.classList.toggle('on', b.dataset.themeId === (game.theme || 'clasico')));

    // Lista de concursantes
    $('.h-count', root).textContent = `(${contestants.length})`;
    if (contestants.some((c) => !codes[c.id]) && !loadingCodes) loadCodes();
    const list = $('.h-list', root);
    list.innerHTML = contestants.length ? contestants.slice().reverse().map((c) => `
      <div class="h-item">
        ${photoHtml(c)}
        <span class="h-item-name">${esc(c.name)}</span>
        <button class="h-code" data-code="${esc(c.id)}" title="Mostrar QR personal">${esc(codes[c.id] || '····')}</button>
        <button class="h-del" data-del="${esc(c.id)}" ${running ? 'disabled title="No se puede borrar con el concurso en curso"' : 'title="Borrar"'}>✕</button>
      </div>`).join('') : '<p class="muted">Aún no hay nadie. Toma la primera foto 📷</p>';
    list.querySelectorAll('[data-code]').forEach((b) => {
      b.onclick = () => { const c = cmap[b.dataset.code]; if (codes[c.id]) showCode(c.name, codes[c.id]); };
    });
    list.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => run(async () => {
        const c = cmap[b.dataset.del];
        if (confirm(`¿Borrar a ${c.name}?`)) await backend.deleteContestant(c.id);
      });
    });

    renderControl(state, round, cmap);
  }

  function renderControl(state, round, cmap) {
    const { game, contestants } = state;
    const box = $('.h-control-body', root);
    const now = ctx.now();
    const status = effectiveStatus(round, now);
    const dis = working ? 'disabled' : '';
    const demo = backend.mode === 'demo';
    let html = '';
    const theme = themeOf(state);
    const present = `<button class="btn btn-ghost btn-xl" data-go="present" ${dis}>${theme.showIcon} Presentar (desfile)</button>`;
    const isRevealed = round && status === 'revealed';
    const nextBtn = (label) => `<button class="btn btn-primary btn-xl" data-go="next" ${dis}>${label}</button>`;
    const lastStage = round && round.stage >= game.cuts.length - 1;

    if (game.showcase) {
      // ---- Modo desfile ----
      const people = showcaseIds(state).map((id) => cmap[id]).filter(Boolean);
      const spot = game.spotlightId;
      const afterRound = isRevealed && round.qualifiedIds.length > 1;
      html = `
        <div class="hc-state"><span class="pill">${theme.showIcon} Desfile</span> ${people.length} en pantalla${round ? ` · ${esc(roundLabel(round, game))}` : ''}</div>
        <p class="muted">Toca a alguien para ponerlo en pantalla completa en la TV. Tócalo otra vez para quitarlo.</p>
        <div class="hc-show">${people.map((c) => `
          <button class="hc-show-item ${c.id === spot ? 'on' : ''}" data-spot="${esc(c.id)}">${photoHtml(c)}<span>${esc(c.name)}</span></button>`).join('')}
        </div>
        <div class="hc-row">
          ${spot ? `<button class="btn btn-ghost" data-go="unspot" ${dis}>✕ Quitar de pantalla</button>` : ''}
          ${afterRound
            ? nextBtn(lastStage ? '⚔️ Ronda de desempate' : 'Siguiente ronda →')
            : game.phase === 'setup'
              ? `<button class="btn btn-primary btn-xl" data-go="start" ${dis || contestants.length < 2 ? 'disabled' : ''}>🚀 Comenzar concurso</button>`
              : ''}
          <button class="btn btn-ghost" data-go="endshow" ${dis}>Salir del desfile</button>
        </div>`;
    } else if (game.phase === 'setup') {
      const first = game.cuts.find((c) => c < contestants.length) ?? 1;
      html = `
        <div class="hc-state"><span class="pill">Registro</span> ${contestants.length} disfraces registrados</div>
        <p class="muted">Cuando termine el desfile, arranca el concurso. Ronda 1: pasan ${first}.</p>
        <div class="hc-row">
          <button class="btn btn-primary btn-xl" data-go="start" ${dis || contestants.length < 2 ? 'disabled' : ''}>🚀 Comenzar concurso</button>
          ${contestants.length ? present : ''}
        </div>`;
    } else if (round) {
      const label = roundLabel(round, game);
      const head = `<div class="hc-state"><span class="pill">${esc(label)}</span> ${round.candidateIds.length} disfraces · pasan ${round.cut} · ${round.votesPerVoter} voto${round.votesPerVoter > 1 ? 's' : ''} c/u</div>`;
      if (status === 'ready') {
        html = `${head}
          <p>⏱️ Tiempo para votar:</p>
          <div class="chips">${TIMERS.map(([s, l]) => `<button class="chip ${s === timerSec ? 'on' : ''}" data-timer="${s}">${l}</button>`).join('')}</div>
          <div class="hc-row">
            <button class="btn btn-primary btn-xl" data-go="open" ${dis}>🗳️ Abrir votación</button>
            ${present}
          </div>`;
      } else if (status === 'open') {
        html = `${head}
          <div class="hc-live"><div class="hc-timer" data-timer-out></div>
            <div><b>${round.voterCount}</b> votantes · <b>${round.voteCount}</b> votos</div></div>
          <div class="hc-row">
            ${round.endsAt ? `<button class="btn btn-ghost" data-go="add30" ${dis}>+30 s</button>` : ''}
            <button class="btn btn-primary btn-xl" data-go="close" ${dis}>✋ Cerrar votación</button>
            ${demo ? `<button class="btn btn-ghost" data-go="sim" ${dis}>🤖 Simular 40 votantes</button>` : ''}
          </div>
          ${realTallyHtml(round, cmap)}`;
      } else if (status === 'closed') {
        html = `${head}
          <div class="hc-live"><div class="hc-timer">⏰ Cerrada</div><div><b>${round.voterCount}</b> votantes · <b>${round.voteCount}</b> votos</div></div>
          <button class="btn btn-primary btn-xl glow" data-go="reveal" ${dis}>✨ Revelar resultados</button>
          ${realTallyHtml(round, cmap)}`;
      } else if (status === 'revealed') {
        const q = round.qualifiedIds;
        const names = q.map((id) => esc(cmap[id]?.name || '¿?')).join(', ');
        const last = round.stage >= game.cuts.length - 1;
        if (q.length === 1) {
          html = `${head}<div class="hc-winner">👑 Ganador: <b>${names}</b></div>
            <div class="hc-row">
              <button class="btn btn-primary btn-xl" data-go="restart" ${dis}>↺ Nuevo concurso (mismos disfraces)</button>
            </div>
            <p class="muted small">Borra rondas y votos y regresa a "Registro". Las fotos y códigos se quedan.</p>`;
        } else {
          html = `${head}
            <p>${last ? '⚔️ <b>Empate en la final</b> entre' : `✅ Pasan <b>${q.length}</b>:`} ${names}</p>
            <div class="hc-row">
              ${nextBtn(last ? '⚔️ Ronda de desempate' : 'Siguiente ronda →')}
              ${present}
            </div>
            <p class="muted small">${theme.showIcon} Presentar: pausa para que desfilen los que pasaron antes de la siguiente ronda.</p>`;
        }
      }
    }
    box.innerHTML = html;

    box.querySelectorAll('[data-timer]').forEach((b) => {
      b.onclick = () => {
        timerSec = Number(b.dataset.timer);
        store.set('disfraces-timer', timerSec);
        render();
      };
    });
    const go = {
      start: () => actions.startContest(),
      open: () => actions.openVoting(timerSec),
      add30: () => actions.addTime(30),
      close: () => actions.closeVoting(),
      reveal: () => actions.reveal(),
      next: () => actions.nextRound(),
      present: () => actions.startShowcase(),
      endshow: () => actions.endShowcase(),
      unspot: () => actions.spotlight(null),
      sim: async () => backend.simulateVotes(round.id, 40, 8000),
      restart: async () => { if (confirm('¿Empezar un concurso nuevo con los mismos disfraces?')) await actions.reset(); },
    };
    box.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => run(go[b.dataset.go]); });
    box.querySelectorAll('[data-spot]').forEach((b) => {
      b.onclick = () => run(() => actions.spotlight(b.dataset.spot === game.spotlightId ? null : b.dataset.spot));
    });
    const toggle = box.querySelector('[data-real]');
    if (toggle) toggle.onclick = () => { showReal = !showReal; realTally = null; render(); refreshReal(); };
    tick();
  }

  function realTallyHtml(round, cmap) {
    if (!showReal) return '<button class="btn btn-ghost small" data-real>👀 Ver conteo real (spoiler)</button>';
    const tally = realTally || {};
    const { ranked, qualified } = computeQualifiers(round.candidateIds, tally, round.cut);
    const max = Math.max(1, ...Object.values(tally));
    return `<button class="btn btn-ghost small" data-real>🙈 Ocultar conteo</button>
      <div class="hc-real">${ranked.map((id, i) => `
        <div class="hc-real-row ${qualified.includes(id) ? 'in' : ''}">
          <span>${i + 1}.</span><span class="hc-real-name">${esc(cmap[id]?.name || '¿?')}</span>
          <span class="hc-real-bar"><i style="width:${((tally[id] || 0) / max) * 100}%"></i></span><b>${tally[id] || 0}</b>
        </div>`).join('')}</div>`;
  }

  async function refreshReal() {
    const round = ctx.state && currentRound(ctx.state);
    if (!showReal || !round) return;
    try { realTally = await backend.adminTally(round.id); } catch { /* ok */ }
    renderControl(ctx.state, round, byId(ctx.state.contestants));
  }

  let lastStatus = null;
  function tick() {
    const round = ctx.state && ctx.state.game.phase !== 'setup' ? currentRound(ctx.state) : null;
    const out = root.querySelector('[data-timer-out]');
    if (round && out) {
      out.textContent = round.endsAt ? `⏳ ${fmtTime(round.endsAt - ctx.now())}` : '● Abierta sin límite';
      out.classList.toggle('urgent', !!round.endsAt && round.endsAt - ctx.now() < 10000);
    }
    const status = effectiveStatus(round, ctx.now());
    // Se acabó el tiempo: marcar la ronda como cerrada en la base de datos
    if (round && round.status === 'open' && status === 'closed' && !working) {
      working = true;
      actions.closeVoting().catch(() => {}).finally(() => { working = false; ctx.refresh(); });
    }
    if (status !== lastStatus) { lastStatus = status; if (round) renderControl(ctx.state, round, byId(ctx.state.contestants)); }
  }

  const t = setInterval(tick, 250);
  const off = ctx.subscribe(() => { if (alive) { render(); refreshReal(); } });
  start();
  return () => { alive = false; clearInterval(t); off(); };
}
