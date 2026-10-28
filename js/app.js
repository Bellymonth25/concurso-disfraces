// Arranque: elige backend, mantiene el estado y decide qué vista mostrar.
//   /        → invitados (votar)
//   /#tv     → pantalla grande
//   /#host   → panel del host

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createDemoBackend } from './backend-demo.js';
import { currentRound } from './logic.js';
import { throttle, toast } from './util.js';
import { applyTheme } from './themes.js';
import { mountVoter } from './view-voter.js';
import { mountTv } from './view-tv.js';
import { mountHost } from './view-host.js';

const listeners = new Set();
const ctx = {
  backend: null,
  state: null,
  tally: [],
  offset: 0,
  now: () => Date.now() + ctx.offset,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  refresh: null,
  voterUrl: location.origin + location.pathname,
};

async function boot() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createSupabaseBackend } = await import('./backend-supabase.js');
    ctx.backend = await createSupabaseBackend(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    ctx.backend = createDemoBackend();
    document.body.classList.add('is-demo');
  }

  try {
    ctx.offset = (await ctx.backend.serverNow()) - Date.now();
  } catch { ctx.offset = 0; }

  let inFlight = false, again = false;
  ctx.refresh = async () => {
    if (inFlight) { again = true; return; }
    inFlight = true;
    try {
      const state = await ctx.backend.fetchPublic();
      const round = currentRound(state);
      ctx.tally = round ? await ctx.backend.fetchTally(round.id) : [];
      ctx.state = state;
      applyTheme(state.game.theme);
      listeners.forEach((fn) => fn(ctx));
    } catch (e) {
      console.error(e);
      toast('Sin conexión… reintentando', 'error');
    } finally {
      inFlight = false;
      if (again) { again = false; ctx.refresh(); }
    }
  };

  const route = () => (location.hash.startsWith('#tv') ? 'tv' : location.hash.startsWith('#host') ? 'host' : 'voter');
  // Los celulares refrescan menos seguido para no saturar el backend
  ctx.backend.onChange(throttle(() => ctx.refresh(), route() === 'voter' ? 1200 : 500));

  let unmount = null;
  const show = async () => {
    unmount?.();
    listeners.clear();
    const root = document.getElementById('app');
    root.innerHTML = '';
    document.body.dataset.view = route();
    const mount = { tv: mountTv, host: mountHost, voter: mountVoter }[route()];
    unmount = mount(root, ctx);
    await ctx.refresh();
  };
  window.addEventListener('hashchange', show);
  await show();
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML = `<div class="fatal">😵 No se pudo iniciar: ${String(e.message || e)}</div>`;
});
