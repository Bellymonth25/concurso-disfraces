// Panel del host: registrar disfraces, configurar rondas y manejar la votación.

import { EVENT_TITLE } from './config.js';
import { $, esc, fmtTime, qrSvg, store, toast } from './util.js';
import { cropPhoto } from './cropper.js';
import { computeQualifiers, computeResults, currentRound, cutBounds, cutsOf, effectiveStatus, hostActions, isFinalRound, MAX_VOTES, showcaseIds, validateCut, validateVotes, votesBounds, votesPlanOf } from './logic.js';
import { byId, photoHtml, roundLabel } from './components.js';
import { THEMES, themeOf } from './themes.js';

const EMPTY_PREVIEW = '<span>📷<br>Sin foto</span>';
const TIMERS =[[0, 'Sin límite'], [30, '30 s'], [60, '1 min'], [90, '1:30'], [120, '2 min'], [180, '3 min'], [300, '5 min']];

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
            <a class="btn btn-ghost" href="${esc(ctx.voterUrl)}" target="_blank" rel="noopener">📱 Vista invitado</a>
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
              <div class="h-photo-pick">
                <div class="h-photo-preview" title="También puedes arrastrar una foto aquí">${EMPTY_PREVIEW}</div>
                <input class="in-camera" type="file" accept="image/*" capture="environment" hidden>
                <input class="in-file" type="file" accept="image/*" hidden>
              </div>
              <div class="h-add-fields">
                <input name="name" placeholder="Nombre o disfraz (ej. Ana – Bruja)" maxlength="40" required autocomplete="off">
                <div class="h-photo-btns">
                  <button type="button" class="btn btn-ghost" data-pick="camera">📷 Tomar foto</button>
                  <button type="button" class="btn btn-ghost" data-pick="file">🖼️ Subir foto</button>
                </div>
                <button type="submit" class="btn btn-primary">Agregar al concurso</button>
              </div>
            </form>
            <div class="h-list"></div>
          </section>

          <section class="h-card">
            <h2>Rondas</h2>
            <p class="muted">Siempre son 3: Ronda 1, Ronda 2 y la Gran Final (podio de 3). Cuántos pasan también se puede cambiar durante el concurso.</p>
            <div class="h-plan">
              <div class="h-plan-row"><span class="h-plan-name">Ronda 1</span>
                <label>pasan <input class="cfg-cut" data-i="0" type="number" inputmode="numeric" min="3" step="1"></label>
                <label>votos c/u <input class="cfg-votes" data-i="0" type="number" inputmode="numeric" min="1" max="${MAX_VOTES}" step="1"></label></div>
              <div class="h-plan-row"><span class="h-plan-name">Ronda 2</span>
                <label>pasan <input class="cfg-cut" data-i="1" type="number" inputmode="numeric" min="3" step="1"></label>
                <label>votos c/u <input class="cfg-votes" data-i="1" type="number" inputmode="numeric" min="1" max="${MAX_VOTES}" step="1"></label></div>
              <div class="h-plan-row"><span class="h-plan-name">Final</span>
                <span>podio de <b>3</b></span>
                <span class="muted">1 voto c/u (fijo)</span></div>
            </div>
            <p class="h-cfg-err" hidden></p>
            <button class="btn btn-primary" data-act="save-config">Guardar rondas</button>
            <p class="muted small">Empates en la línea de corte: pasan todos los empatados. Si en la final empatan por el 1er lugar, hay desempate.</p>
          </section>
        </div>

        <section class="h-card h-danger">
          <h2>Zona peligrosa</h2>
          <div class="h-danger-row">
            <button class="btn btn-ghost" data-act="reset">↺ Reiniciar concurso (deja las fotos)</button>
            <button class="btn btn-ghost" data-act="delete-all">🗑️ Borrar todos los concursantes</button>
            ${demo ? '<button class="btn btn-ghost" data-act="seed">🎭 Cargar 20 disfraces de prueba</button><button class="btn btn-ghost" data-act="wipe">🗑️ Borrar todo el demo</button>' : ''}
          </div>
        </section>
      </div>
      <dialog class="h-modal"></dialog>`;

    // ---- Foto + nombre ----
    // Dos formas de elegir la foto: la cámara, o un archivo (galería del celular / carpeta de la compu).
    // En la compu también se puede arrastrar la foto al recuadro.
    let photoBlob = null;
    const camIn = $('.in-camera', root);
    const fileIn = $('.in-file', root);
    const preview = $('.h-photo-preview', root);
    const usePhoto = async (f) => {
      if (!f) return;
      if (!f.type.startsWith('image/')) { toast('Ese archivo no es una imagen', 'error'); return; }
      try {
        // El host encuadra la foto en 3:4 (el formato de todas las tarjetas) antes de subirla
        const blob = await cropPhoto(f, backend.mode === 'demo' ? { outW: 420, quality: 0.7 } : { outW: 960, quality: 0.85 });
        if (!blob) return; // canceló
        photoBlob = blob;
        preview.innerHTML = `<img src="${URL.createObjectURL(photoBlob)}" alt="">`;
      } catch { toast('No se pudo leer la foto. Prueba con JPG o PNG.', 'error'); }
      camIn.value = '';
      fileIn.value = '';
    };
    camIn.onchange = () => usePhoto(camIn.files[0]);
    fileIn.onchange = () => usePhoto(fileIn.files[0]);
    root.querySelector('[data-pick=camera]').onclick = () => camIn.click();
    root.querySelector('[data-pick=file]').onclick = () => fileIn.click();
    preview.onclick = () => fileIn.click();
    preview.ondragover = (e) => { e.preventDefault(); preview.classList.add('drag'); };
    preview.ondragleave = () => preview.classList.remove('drag');
    preview.ondrop = (e) => {
      e.preventDefault();
      preview.classList.remove('drag');
      usePhoto(e.dataTransfer.files[0]);
    };
    $('.h-add', root).onsubmit = async (e) => {
      e.preventDefault();
      const nameIn = e.target.elements.name;
      const name = nameIn.value.trim();
      if (!name) return;
      if (!photoBlob && !confirm('¿Agregar sin foto?')) return;
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Subiendo…';
      try {
        const { id, code } = await backend.addContestant(name, photoBlob);
        codes[id] = code;
        showCode(name, code);
        nameIn.value = '';
        photoBlob = null;
        camIn.value = '';
        fileIn.value = '';
        preview.innerHTML = EMPTY_PREVIEW;
        ctx.refresh();
      } catch (err) { toast(err.message, 'error'); }
      btn.disabled = false;
      btn.textContent = 'Agregar al concurso';
    };

    // ---- Config de rondas ----
    root.querySelectorAll('.cfg-cut, .cfg-votes').forEach((i) => { i.oninput = () => { configDirty = true; }; });
    root.querySelector('[data-act=save-config]').onclick = async () => {
      const err = $('.h-cfg-err', root);
      const val = (sel, i) => String(root.querySelector(`${sel}[data-i="${i}"]`).value).trim();
      const n = ctx.state?.contestants.length || 0;
      const problems = [];
      const cuts = [0, 1].map((i) => {
        if (!/^\d+$/.test(val('.cfg-cut', i))) { problems.push(`Ronda ${i + 1}: escribe un número entero`); return 0; }
        return Number(val('.cfg-cut', i));
      });
      if (!problems.length) {
        if (cuts[0] < 3 || cuts[1] < 3) problems.push('Deben pasar al menos 3 en cada ronda (para que haya podio)');
        if (cuts[1] >= cuts[0]) problems.push('En la Ronda 2 deben pasar menos que en la Ronda 1');
        if (n && cuts[0] > n) problems.push(`En la Ronda 1 no pueden pasar más de ${n} (son los registrados)`);
      }
      const votes = [0, 1].map((i) => {
        const v = val('.cfg-votes', i);
        if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > MAX_VOTES) { problems.push(`Votos de la Ronda ${i + 1}: un número entero entre 1 y ${MAX_VOTES}`); return 1; }
        return Number(v);
      });
      err.hidden = !problems.length;
      err.textContent = problems.join(' · ');
      if (problems.length) return;
      try {
        await actions.saveConfig([...cuts, 3], [...votes, 1]);
        configDirty = false;
        toast('Rondas guardadas ✅', 'ok');
        ctx.refresh();
      } catch (e) { toast(e.message, 'error'); }
    };

    root.querySelectorAll('[data-theme-id]').forEach((b) => {
      b.onclick = () => run(() => backend.updateGame({ theme: b.dataset.themeId }));
    });

    root.querySelector('[data-act=reset]').onclick = () => run(async () => {
      if (!confirm('¿Reiniciar el concurso? Se borran rondas y votos (los concursantes se quedan).')) return;
      await actions.reset();
    });
    // Para empezar un concurso con otra gente: reinicia y borra a todos (fotos y códigos incluidos)
    root.querySelector('[data-act=delete-all]').onclick = () => run(async () => {
      const n = ctx.state?.contestants.length || 0;
      if (!n) { toast('No hay concursantes que borrar'); return; }
      if (!confirm(`¿Borrar a los ${n} concursantes con sus fotos y códigos?\n\nTambién se reinicia el concurso (rondas y votos). No se puede deshacer.`)) return;
      await actions.reset();
      await backend.deleteAllContestants();
      codes = {};
      toast('Listo, concurso vacío ✅', 'ok');
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

  // Muestra el código grande + QR personal para que el concursante lo escanee
  function showCode(name, code) {
    const dlg = $('.h-modal', root);
    const link = `${ctx.voterUrl}${ctx.voterUrl.includes('?') ? '&' : '?'}code=${code}`;
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
    const running = game.phase !== 'setup';
    const cfgInputs = [...root.querySelectorAll('.cfg-cut, .cfg-votes')];
    if (!configDirty && !cfgInputs.includes(document.activeElement)) {
      const cuts = cutsOf(game), plan = votesPlanOf(game);
      root.querySelectorAll('.cfg-cut').forEach((i) => { i.value = cuts[i.dataset.i]; });
      root.querySelectorAll('.cfg-votes').forEach((i) => { i.value = plan[i.dataset.i]; });
    }
    root.querySelectorAll('.cfg-cut, .cfg-votes, [data-act=save-config]').forEach((el) => { el.disabled = running; });

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

    // No redibujar el control mientras el host escribe "pasan N" o los votos (llegan votos en vivo)
    if (document.activeElement?.closest?.('.hc-cut')) return;
    renderControl(state, round, cmap);
  }

  // "Pasan N" (hasta antes de revelar) y votos por persona (hasta antes de abrir la votación)
  function cutEditorHtml(round, dis, status) {
    const n = round.candidateIds.length;
    const { min, max } = cutBounds(n);
    const vb = votesBounds(n);
    const votesOpen = status === 'ready';
    return `
      <div class="hc-cut">
        <label>Pasan <input class="hc-cut-in" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${round.cut}"> de ${n}</label>
        <label>Votos por persona <input class="hc-votes-in" type="number" inputmode="numeric" min="${vb.min}" max="${vb.max}" step="1" value="${round.votesPerVoter}" ${votesOpen ? '' : 'disabled title="Los votos se fijan al abrir la votación"'}></label>
        <button class="btn btn-ghost" data-cut-save ${dis}>Guardar</button>
        <span class="hc-cut-msg muted small">Pasan entre ${min} y ${max}${votesOpen ? ` · votos entre 1 y ${vb.max}` : ' · los votos ya quedaron fijos'}</span>
      </div>`;
  }

  // Resultados de la final para el panel (podio, desempate…)
  let hostResults = { key: '', data: null, loading: false };
  function finalResults(state, round) {
    const key = `${round.id}:${state.game.finalStep}:${round.status}`;
    if (hostResults.key === key) return hostResults.data;
    if (!hostResults.loading) {
      hostResults.loading = true;
      computeResults(state, (r) => backend.adminTally(r.id))
        .then((data) => { hostResults = { key, data, loading: false }; renderControl(ctx.state, currentRound(ctx.state), byId(ctx.state.contestants)); })
        .catch(() => { hostResults.loading = false; });
    }
    return null;
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

    if (game.showcase) {
      // ---- Modo desfile ----
      const people = showcaseIds(state).map((id) => cmap[id]).filter(Boolean);
      const spot = game.spotlightId;
      const afterRound = isRevealed && !isFinalRound(round);
      html = `
        <div class="hc-state"><span class="pill">${theme.showIcon} Desfile</span> ${people.length} en pantalla${round ? ` · ${esc(roundLabel(round, game))}` : ''}</div>
        <p class="muted">Toca a alguien para ponerlo en pantalla completa en la TV. Tócalo otra vez para quitarlo.</p>
        <div class="hc-show">${people.map((c) => `
          <button class="hc-show-item ${c.id === spot ? 'on' : ''}" data-spot="${esc(c.id)}">${photoHtml(c)}<span>${esc(c.name)}</span></button>`).join('')}
        </div>
        <div class="hc-row">
          ${spot ? `<button class="btn btn-ghost" data-go="unspot" ${dis}>✕ Quitar de pantalla</button>` : ''}
          ${afterRound
            ? nextBtn(round.stage === 0 && round.qualifiedIds.length > 3 ? 'Siguiente: Ronda 2 →' : 'Siguiente: Gran Final →')
            : game.phase === 'setup'
              ? `<button class="btn btn-primary btn-xl" data-go="start" ${dis || contestants.length < 2 ? 'disabled' : ''}>🚀 Comenzar concurso</button>`
              : ''}
          <button class="btn btn-ghost" data-go="endshow" ${dis}>Salir del desfile</button>
        </div>`;
    } else if (game.phase === 'setup') {
      const first = Math.min(cutsOf(game)[0], contestants.length);
      html = `
        <div class="hc-state"><span class="pill">Registro</span> ${contestants.length} disfraces registrados</div>
        <p class="muted">Cuando termine el desfile, arranca el concurso. Ronda 1: pasan ${first} (lo puedes cambiar después).</p>
        <div class="hc-row">
          <button class="btn btn-primary btn-xl" data-go="start" ${dis || contestants.length < 2 ? 'disabled' : ''}>🚀 Comenzar concurso</button>
          ${contestants.length ? present : ''}
        </div>`;
    } else if (round) {
      const label = roundLabel(round, game);
      const fin = isFinalRound(round);
      const head = `<div class="hc-state"><span class="pill">${esc(label)}</span> ${round.candidateIds.length} disfraces · ${fin ? (round.isTiebreak ? 'por el 1er lugar' : 'podio de 3') : `pasan ${round.cut}`} · ${round.votesPerVoter} voto${round.votesPerVoter > 1 ? 's' : ''} c/u</div>`;
      const cutEd = !fin && status !== 'revealed' ? cutEditorHtml(round, dis, status) : '';
      if (status === 'ready') {
        html = `${head}${cutEd}
          <p>⏱️ Tiempo para votar:</p>
          <div class="chips">${TIMERS.map(([s, l]) => `<button class="chip ${s === timerSec ? 'on' : ''}" data-timer="${s}">${l}</button>`).join('')}</div>
          <div class="hc-row">
            <button class="btn btn-primary btn-xl" data-go="open" ${dis}>🗳️ Abrir votación</button>
            ${present}
          </div>`;
      } else if (status === 'open') {
        html = `${head}${cutEd}
          <div class="hc-live"><div class="hc-timer" data-timer-out></div>
            <div><b>${round.voterCount}</b> votantes · <b>${round.voteCount}</b> votos</div></div>
          <div class="hc-row">
            ${round.endsAt ? `<button class="btn btn-ghost" data-go="add30" ${dis}>+30 s</button>` : ''}
            <button class="btn btn-primary btn-xl" data-go="close" ${dis}>✋ Cerrar votación</button>
            ${demo ? `<button class="btn btn-ghost" data-go="sim" ${dis}>🤖 Simular 40 votantes</button>` : ''}
          </div>
          ${realTallyHtml(round, cmap)}`;
      } else if (status === 'closed') {
        html = `${head}${cutEd}
          <div class="hc-live"><div class="hc-timer">⏰ Cerrada</div><div><b>${round.voterCount}</b> votantes · <b>${round.voteCount}</b> votos</div></div>
          <button class="btn btn-primary btn-xl glow" data-go="reveal" ${dis}>✨ Revelar resultados</button>
          ${realTallyHtml(round, cmap)}`;
      } else if (status === 'revealed' && fin) {
        html = head + finalControlHtml(state, round, cmap, dis, present);
      } else if (status === 'revealed') {
        const q = round.qualifiedIds;
        const names = q.map((id) => esc(cmap[id]?.name || '¿?')).join(', ');
        html = `${head}
          <p>✅ Pasan <b>${q.length}</b>: ${names}</p>
          <div class="hc-row">
            ${nextBtn(round.stage === 0 && q.length > 3 ? 'Siguiente: Ronda 2 →' : 'Siguiente: Gran Final →')}
            ${present}
          </div>
          <p class="muted small">${theme.showIcon} Presentar: pausa para que desfilen los que pasaron antes de la siguiente ronda.</p>`;
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
      step: () => actions.advanceFinal(),
    };
    box.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => run(go[b.dataset.go]); });
    box.querySelectorAll('[data-spot]').forEach((b) => {
      b.onclick = () => run(() => actions.spotlight(b.dataset.spot === game.spotlightId ? null : b.dataset.spot));
    });
    const cutIn = box.querySelector('.hc-cut-in');
    if (cutIn) {
      const votesIn = box.querySelector('.hc-votes-in');
      const n = round.candidateIds.length;
      const msg = box.querySelector('.hc-cut-msg');
      const hint = msg.textContent;
      const check = () => {
        const e1 = validateCut(cutIn.value, n).error;
        const e2 = votesIn.disabled ? null : validateVotes(votesIn.value, n).error;
        msg.textContent = [e1, e2].filter(Boolean).join(' · ') || hint;
        msg.classList.toggle('bad', !!(e1 || e2));
        cutIn.classList.toggle('bad', !!e1);
        votesIn.classList.toggle('bad', !!e2);
        return !(e1 || e2);
      };
      cutIn.oninput = check;
      votesIn.oninput = check;
      const save = () => {
        if (!check()) return;
        run(async () => {
          await actions.setCut(cutIn.value);
          if (!votesIn.disabled) await actions.setVotes(votesIn.value);
          toast(`Pasan ${cutIn.value}${votesIn.disabled ? '' : ` · ${votesIn.value} voto${votesIn.value === '1' ? '' : 's'} por persona`} ✅`, 'ok');
        });
      };
      box.querySelector('[data-cut-save]').onclick = save;
      for (const inp of [cutIn, votesIn]) inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); save(); } };
    }
    const toggle = box.querySelector('[data-real]');
    if (toggle) toggle.onclick = () => { showReal = !showReal; realTally = null; render(); refreshReal(); };
    tick();
  }

  // Premiación de la final, paso a paso
  function finalControlHtml(state, round, cmap, dis, present) {
    const step = state.game.finalStep ?? 0;
    const res = finalResults(state, round);
    if (!res) return '<p class="muted">Calculando resultados…</p>';
    const names = (ids) => ids.map((id) => esc(cmap[id]?.name || '¿?')).join(', ');
    const btn = (label, cls = '') => `<button class="btn btn-primary btn-xl ${cls}" data-go="step" ${dis}>${label}</button>`;
    const steps = ['Finalistas', '3er lugar', 'Ganador', 'Podio'];
    const progress = step >= 0 ? `<div class="hc-steps">${steps.map((s2, i) => `<span class="${i < step ? 'done' : i === step ? 'now' : ''}">${s2}</span>`).join('')}</div>` : '';
    if (step === -1) {
      return `
        <div class="hc-tie">⚔️ <b>¡Empate por el 1er lugar!</b> entre ${names(res.winners)}</div>
        <p class="muted">La TV está mostrando el EMPATE. Inicia el desempate: votarán solo por ellos, 1 voto por persona.</p>
        <div class="hc-row">
          <button class="btn btn-primary btn-xl glow" data-go="next" ${dis}>⚔️ Iniciar desempate</button>
          ${present}
        </div>`;
    }
    const finalists = `<p>🏆 Finalistas: <b>${names(res.finalists)}</b></p>`;
    if (step === 0) return `${progress}${finalists}
      <div class="hc-row">${btn('🥉 Revelar 3er lugar', 'glow')}${present}</div>
      <p class="muted small">Tú decides cuándo avanzar: cada botón cambia la TV y los celulares.</p>`;
    if (step === 1) return `${progress}${finalists}
      <p>🥉 3er lugar: <b>${names(res.thirds) || '—'}</b></p>
      <div class="hc-row">${btn('🏆 Revelar al ganador', 'glow')}</div>`;
    const podium = `
      <div class="hc-podium">
        <div>🥇 <b>${names(res.winners)}</b></div>
        ${res.seconds.length ? `<div>🥈 ${names(res.seconds)}</div>` : ''}
        ${res.thirds.length ? `<div>🥉 ${names(res.thirds)}</div>` : ''}
      </div>`;
    if (step === 2) return `${progress}${podium}
      <div class="hc-row">${btn('📊 Mostrar podio y estadísticas', 'glow')}</div>`;
    return `${progress}${podium}
      <div class="hc-row">
        <button class="btn btn-primary btn-xl" data-go="restart" ${dis}>↺ Nuevo concurso (mismos disfraces)</button>
      </div>
      <p class="muted small">Borra rondas y votos y regresa a "Registro". Las fotos y códigos se quedan.</p>`;
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
