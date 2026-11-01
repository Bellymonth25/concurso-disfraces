// Reglas del concurso: siempre 3 rondas → Ronda 1, Ronda 2 y la Gran Final (podio de 3).
//
// La final no termina sola: después de revelar quedan los 3 finalistas y el host avanza paso a paso
// (game.finalStep):  -1 empate por el 1er lugar (falta desempate) · 0 finalistas · 1 3er lugar
//                     · 2 ganador · 3 podio con estadísticas

export const FINAL = 2;            // índice de la etapa final
export const PODIUM = 3;           // cuántos llegan al podio
export const DEFAULT_CUTS = [20, 6, PODIUM];
export const VOTES_PLAN = [3, 2, 1];

// game.cuts siempre como [pasan en R1, pasan en R2, 3]
export function cutsOf(game) {
  const c = game?.cuts || [];
  const r1 = Number.isInteger(c[0]) && c[0] > 0 ? c[0] : DEFAULT_CUTS[0];
  const r2 = Number.isInteger(c[1]) && c[1] > 0 ? c[1] : DEFAULT_CUTS[1];
  return [r1, r2, PODIUM];
}
// Votos por persona: los elige el host en Ronda 1 y Ronda 2; la final (y el desempate) siempre es 1
export const MAX_VOTES = 10;
export function votesPlanOf(game) {
  const p = game?.votesPlan || [];
  return VOTES_PLAN.map((d, i) => (i >= FINAL ? 1 : Number.isInteger(p[i]) && p[i] > 0 ? p[i] : d));
}

// Límites de votos por persona en una ronda con `n` concursantes (no puedes votar por más de los que hay, menos tú)
export const votesBounds = (n) => ({ min: 1, max: Math.max(1, Math.min(MAX_VOTES, n - 1)) });

export function validateVotes(raw, n) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return { error: 'Votos: escribe un número entero (sin letras ni signos)' };
  const v = Number(text);
  const { min, max } = votesBounds(n);
  if (v < min) return { error: 'Votos: al menos 1 por persona' };
  if (v > max) return { error: `Votos: máximo ${max} por persona${max < MAX_VOTES ? ` (hay ${n} disfraces)` : ''}` };
  return { value: v };
}

// Límites válidos para "pasan N" en una ronda con `n` concursantes:
// al menos 3 (para que haya podio) y no más de los que hay.
export const cutBounds = (n) => ({ min: Math.min(PODIUM, n), max: n });

// Valida lo que escribe el host. Regresa { value } o { error }.
export function validateCut(raw, n) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return { error: 'Escribe un número entero (sin letras ni signos)' };
  const v = Number(text);
  const { min, max } = cutBounds(n);
  if (v < min) return { error: n >= PODIUM ? `Deben pasar al menos ${PODIUM} para que haya podio` : `Deben pasar al menos ${min}` };
  if (v > max) return { error: `No pueden pasar más de ${max} (son los que hay en la ronda)` };
  return { value: v };
}
const clampCut = (cut, n) => Math.max(cutBounds(n).min, Math.min(cutBounds(n).max, cut));

// ¿Quién pasa? Los `cut` con más votos; si hay empate en la línea de corte, pasan todos los empatados.
export function computeQualifiers(candidateIds, tally, cut) {
  const ranked = [...candidateIds].sort((a, b) => (tally[b] || 0) - (tally[a] || 0));
  if (ranked.length <= cut) return { ranked, qualified: ranked };
  const threshold = tally[ranked[cut - 1]] || 0;
  let qualified = ranked.filter((id) => (tally[id] || 0) >= threshold);
  // Si la línea de corte cae en 0 votos, los de 0 no pasan (si no, pasarían todos)
  if (threshold === 0) {
    const withVotes = ranked.filter((id) => (tally[id] || 0) > 0);
    if (withVotes.length >= Math.min(cut, PODIUM)) qualified = withVotes;
  }
  return { ranked, qualified };
}

// Lugar "de competencia": empatados comparten lugar (1, 2, 2, 4…)
export function placesOf(ids, tally) {
  const v = (id) => tally[id] || 0;
  return Object.fromEntries(ids.map((id) => [id, 1 + ids.filter((x) => v(x) > v(id)).length]));
}

export const currentRound = (state) => state.rounds.find((r) => r.id === state.game.currentRoundId) || null;
export const isFinalRound = (r) => !!r && r.stage >= FINAL;

// La votación está abierta (y el tiempo no se ha acabado)
export function isVotingOpen(round, now) {
  return !!round && round.status === 'open' && (!round.endsAt || now < round.endsAt);
}

// Estado "efectivo": si se acabó el tiempo cuenta como cerrada aunque el host no haya picado nada
export function effectiveStatus(round, now) {
  if (!round) return null;
  if (round.status === 'open' && round.endsAt && now >= round.endsAt) return 'closed';
  return round.status;
}

// Quiénes salen en el modo desfile: los que siguen en concurso
export function showcaseIds(state) {
  const r = state.game.phase === 'setup' ? null : currentRound(state);
  if (!r) return state.contestants.map((c) => c.id);
  return r.status === 'revealed' ? r.qualifiedIds : r.candidateIds;
}

export function eliminatedIn(state) {
  const out = {};
  for (const r of state.rounds) {
    if (r.status !== 'revealed') continue;
    for (const id of r.candidateIds) if (!r.qualifiedIds.includes(id)) out[id] = r.number;
  }
  return out;
}

const shortLabel = (r) => (r.isTiebreak ? 'Desempate' : r.stage >= FINAL ? 'Final' : `Ronda ${r.stage + 1}`);
const longLabel = (r) => (r.isTiebreak ? 'Desempate' : r.stage >= FINAL ? 'Gran Final' : `Ronda ${r.stage + 1}`);

// ---------- Podio ----------
// Reglas: empate por el 1er lugar (en votos de la final) → ronda de desempate.
// Empates por el 2º o 3º → gana quien sumó más votos en todo el concurso; si siguen iguales, comparten lugar.
// Los lugares del podio no se saltan: con dos 2º, el siguiente es 3º.

const cmpKey = (a, b) => (a[0] !== b[0] ? b[0] - a[0] : b[1] - a[1]);

// Agrupa por [votos en la final, votos totales] de mayor a menor (cada grupo = un lugar)
function groupsByKey(ids, fv, total) {
  const sorted = [...ids].sort((a, b) => cmpKey([fv(a), total(a)], [fv(b), total(b)]));
  const groups = [];
  for (const id of sorted) {
    const last = groups[groups.length - 1];
    if (last && fv(last[0]) === fv(id) && total(last[0]) === total(id)) last.push(id);
    else groups.push([id]);
  }
  return groups;
}

// Quiénes se quedan en pantalla al revelar la final: los empatados por el 1º y quien complete el podio
export function pickPodium(ids, fv, total) {
  const top = Math.max(...ids.map(fv));
  const first = ids.filter((id) => fv(id) === top);
  const groups = groupsByKey(ids.filter((id) => !first.includes(id)), fv, total);
  const room = first.length > 1 ? 1 : 2; // lugares que quedan (2º y 3º, o solo 3º si el 1º va a desempate)
  return [...first, ...groups.slice(0, room).flat()];
}

// Resultados finales: podio (con desempate si hubo), estadísticas por ronda y lugares del resto.
// getTally(round) → { contestantId: votos } (el público solo puede leerlo de rondas ya reveladas).
export async function computeResults(state, getTally) {
  const revealed = state.rounds.filter((r) => r.status === 'revealed').sort((a, b) => a.id - b.id);
  const final = [...revealed].reverse().find((r) => r.stage >= FINAL && !r.isTiebreak);
  if (!final) return null;
  const tallies = {};
  for (const r of revealed) tallies[r.id] = await getTally(r);
  const fvMap = tallies[final.id] || {};
  const fv = (id) => fvMap[id] || 0;
  const total = (id) => revealed.filter((r) => !r.isTiebreak).reduce((a, r) => a + ((tallies[r.id] || {})[id] || 0), 0);

  // 1er lugar: los más votados en la final; si hubo desempate, manda el último
  const ids = final.qualifiedIds;
  const top = Math.max(...ids.map(fv));
  const tiedFirst = ids.filter((id) => fv(id) === top);
  const tbs = revealed.filter((r) => r.isTiebreak && r.id > final.id);
  const lastTb = tbs[tbs.length - 1];
  const winners = lastTb ? lastTb.qualifiedIds.filter((id) => ids.includes(id)) : tiedFirst;
  const firstTie = winners.length > 1;
  const places = Object.fromEntries(winners.map((id) => [id, 1]));
  // Los que perdieron un desempate por el 1º siguen en orden (votos del desempate y luego totales)
  const tbLosers = tiedFirst.filter((id) => !winners.includes(id));
  let nextPlace = 2;
  if (lastTb && tbLosers.length) {
    const tbv = (id) => (tallies[lastTb.id] || {})[id] || 0;
    for (const g of groupsByKey(tbLosers, tbv, total)) {
      for (const id of g) places[id] = nextPlace;
      nextPlace++;
    }
  }
  // El resto, por grupos (votos de la final y luego votos totales), sin saltar lugares
  for (const g of groupsByKey(ids.filter((id) => !(id in places)), fv, total)) {
    for (const id of g) places[id] = nextPlace;
    nextPlace++;
  }
  const byPlace = (a, b) => places[a] - places[b] || fv(b) - fv(a) || total(b) - total(a);
  const finalists = ids.filter((id) => places[id] <= PODIUM).sort(byPlace);
  const seconds = finalists.filter((id) => places[id] === 2);
  const thirds = finalists.filter((id) => places[id] === 3);

  // El resto: primero quien llegó a la final pero no al podio, luego los eliminados en la final,
  // luego los de la Ronda 2 y luego los de la Ronda 1
  const others = [];
  let next = finalists.length + 1;
  const extra = ids.filter((id) => places[id] > PODIUM).sort(byPlace);
  const pe = placesOf(extra, Object.fromEntries(extra.map((id) => [id, places[id] * -1])));
  for (const id of extra) others.push({ id, place: next + pe[id] - 1, votes: fv(id), round: 'Gran Final' });
  next += extra.length;
  for (const r of revealed.filter((x) => !x.isTiebreak).reverse()) {
    const t = tallies[r.id] || {};
    const out = r.candidateIds.filter((id) => !r.qualifiedIds.includes(id)).sort((a, b) => (t[b] || 0) - (t[a] || 0));
    const p = placesOf(out, t);
    for (const id of out) others.push({ id, place: next + p[id] - 1, votes: t[id] || 0, round: longLabel(r) });
    next += out.length;
  }

  // Lugar y votos de cada uno del podio en cada ronda que jugó
  const history = Object.fromEntries(finalists.map((id) => [id, []]));
  for (const r of revealed) {
    const t = tallies[r.id] || {};
    const p = placesOf(r.candidateIds, t);
    for (const id of finalists) {
      if (!r.candidateIds.includes(id)) continue;
      // En la final se muestra el lugar del podio (ya con desempates)
      const place = r.id === final.id ? places[id] : p[id];
      history[id].push({ label: longLabel(r), short: shortLabel(r), place, of: r.candidateIds.length, votes: t[id] || 0 });
    }
  }
  return { final, finalists, places, winners, seconds, thirds, firstTie, others, history };
}

function votesFor(game, stage, candidates) {
  if (stage >= FINAL) return 1;
  const v = votesPlanOf(game)[stage] || 1;
  // No puedes dar más votos que disfraces por los que puedes votar
  return Math.max(1, Math.min(v, votesBounds(candidates).max));
}

// ---------- Acciones del host ----------

export function hostActions(backend, getState, getNow) {
  const newRound = async (stage, candidateIds, extra = {}) => {
    const { game, rounds } = getState();
    const n = candidateIds.length;
    const cut = stage >= FINAL ? Math.min(PODIUM, n) : clampCut(cutsOf(game)[stage], n);
    return backend.insertRound({
      number: rounds.length + 1, stage, cut, votesPerVoter: votesFor(game, stage, n), candidateIds, ...extra,
    });
  };

  return {
    async startContest() {
      const { contestants } = getState();
      if (contestants.length < 2) throw new Error('Necesitas al menos 2 concursantes');
      const ids = contestants.map((c) => c.id);
      // Con 3 o menos concursantes nos vamos directo a la final
      const round = await newRound(ids.length <= PODIUM ? FINAL : 0, ids);
      await backend.updateGame({ phase: 'running', currentRoundId: round.id, winnerIds: [], finalStep: 0, showcase: false, spotlightId: null });
    },

    // Modo desfile
    async startShowcase() { await backend.updateGame({ showcase: true, spotlightId: null }); },
    async spotlight(id) { await backend.updateGame({ spotlightId: id || null }); },
    async endShowcase() { await backend.updateGame({ showcase: false, spotlightId: null }); },

    // Votos por persona de la ronda actual (solo antes de abrir la votación; la final siempre es 1)
    async setVotes(raw) {
      const r = currentRound(getState());
      if (!r || r.status !== 'ready' || r.stage >= FINAL) return;
      const { value, error } = validateVotes(raw, r.candidateIds.length);
      if (error) throw new Error(error);
      await backend.updateRound(r.id, { votesPerVoter: value });
    },

    // "Pasan N" de la ronda actual (antes de revelar)
    async setCut(raw) {
      const r = currentRound(getState());
      if (!r || r.status === 'revealed' || r.stage >= FINAL) return;
      const { value, error } = validateCut(raw, r.candidateIds.length);
      if (error) throw new Error(error);
      await backend.updateRound(r.id, { cut: value });
    },

    async openVoting(durationSec) {
      const r = currentRound(getState());
      if (!r) return;
      await backend.updateRound(r.id, { status: 'open', endsAt: durationSec ? getNow() + durationSec * 1000 : null });
    },

    async addTime(sec) {
      const r = currentRound(getState());
      if (!r || !r.endsAt) return;
      await backend.updateRound(r.id, { status: 'open', endsAt: Math.max(r.endsAt, getNow()) + sec * 1000 });
    },

    async closeVoting() {
      const r = currentRound(getState());
      if (!r) return;
      await backend.updateRound(r.id, { status: 'closed', endsAt: r.endsAt && r.endsAt < getNow() ? r.endsAt : getNow() });
    },

    async reveal() {
      const r = currentRound(getState());
      if (!r) return;
      const tally = await backend.adminTally(r.id);
      let { qualified } = computeQualifiers(r.candidateIds, tally, r.cut);
      if (r.stage >= FINAL && !r.isTiebreak) {
        // En la final se queda en pantalla solo el podio (los empates por 2º/3º se rompen con votos totales)
        const { rounds } = getState();
        const prev = rounds.filter((x) => x.status === 'revealed' && !x.isTiebreak);
        const totals = {};
        for (const pr of prev) for (const [id, v] of Object.entries(await backend.adminTally(pr.id))) totals[id] = (totals[id] || 0) + v;
        qualified = pickPodium(r.candidateIds, (id) => tally[id] || 0, (id) => (totals[id] || 0) + (tally[id] || 0));
      }
      await backend.updateRound(r.id, { status: 'revealed', qualifiedIds: qualified });
      if (r.stage >= FINAL) {
        // ¿Quedó empate por el 1er lugar? Entonces toca desempate antes del podio
        const top = Math.max(...qualified.map((id) => tally[id] || 0));
        const tied = qualified.filter((id) => (tally[id] || 0) === top);
        await backend.updateGame({ finalStep: tied.length > 1 ? -1 : 0 });
      }
    },

    // Siguiente ronda: R1 → R2 → Final, o el desempate por el 1er lugar
    async nextRound() {
      const state = getState();
      const r = currentRound(state);
      if (!r || r.status !== 'revealed') return;
      let round;
      if (r.stage >= FINAL) {
        if (state.game.finalStep !== -1) return;
        const tally = await backend.adminTally(r.id);
        const top = Math.max(...r.qualifiedIds.map((id) => tally[id] || 0));
        const tied = r.qualifiedIds.filter((id) => (tally[id] || 0) === top);
        round = await newRound(FINAL, tied, { isTiebreak: true, cut: 1, votesPerVoter: 1 });
      } else {
        const q = r.qualifiedIds;
        round = await newRound(r.stage === 0 && q.length > PODIUM ? 1 : FINAL, q);
      }
      await backend.updateGame({ currentRoundId: round.id, showcase: false, spotlightId: null });
    },

    // Avanza la premiación de la final un paso (3er lugar → ganador → podio)
    async advanceFinal() {
      const state = getState();
      const step = state.game.finalStep ?? 0;
      if (step < 0 || step >= 3) return;
      const patch = { finalStep: step + 1 };
      if (step + 1 === 2) {
        const results = await computeResults(state, (rr) => backend.adminTally(rr.id));
        Object.assign(patch, { phase: 'finished', winnerIds: results?.winners || [] });
      }
      await backend.updateGame(patch);
    },

    async saveConfig(cuts, votesPlan) {
      await backend.updateGame({ cuts, votesPlan });
    },

    async reset() { await backend.resetGame(); },
  };
}
