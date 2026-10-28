// Reglas del concurso: rondas, votos por ronda y quién pasa.

// Votos por persona según cuántas rondas haya:
//   3 rondas → 3,2,1   4 → 3,2,2,1   5 → 3,3,2,2,1   6 → 3,3,2,2,2,1 …
export function defaultVotesPlan(rounds) {
  if (rounds <= 1) return [1];
  const before = rounds - 1;
  const threes = Math.floor(before / 2);
  return [...Array(threes).fill(3), ...Array(before - threes).fill(2), 1];
}

// "25, 10, 5" → [25, 10, 5, 1]  (siempre termina en 1 ganador)
export function parseCuts(text) {
  const nums = String(text).split(/[^\d]+/).map(Number).filter((n) => n > 0);
  const out = [];
  for (const n of nums) if (!out.length || n < out[out.length - 1]) out.push(n);
  if (out[out.length - 1] !== 1) out.push(1);
  return out;
}

// ¿Quién pasa? Los `cut` con más votos; si hay empate en la línea de corte, pasan todos los empatados.
export function computeQualifiers(candidateIds, tally, cut) {
  const ranked = [...candidateIds].sort((a, b) => (tally[b] || 0) - (tally[a] || 0));
  if (ranked.length <= cut) return { ranked, qualified: ranked };
  const threshold = tally[ranked[cut - 1]] || 0;
  let qualified = ranked.filter((id) => (tally[id] || 0) >= threshold);
  // Si la línea de corte cae en 0 votos, los de 0 no pasan (si no, pasarían todos)
  if (threshold === 0) {
    const withVotes = ranked.filter((id) => (tally[id] || 0) > 0);
    if (withVotes.length) qualified = withVotes;
  }
  return { ranked, qualified };
}

export const currentRound = (state) => state.rounds.find((r) => r.id === state.game.currentRoundId) || null;

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

function votesFor(game, stage, candidates) {
  const plan = game.votesPlan?.length === game.cuts.length ? game.votesPlan : defaultVotesPlan(game.cuts.length);
  const v = plan[Math.min(stage, plan.length - 1)] || 1;
  // No puedes dar más votos que disfraces por los que puedes votar
  return Math.max(1, Math.min(v, candidates - 1));
}

// ---------- Acciones del host ----------

export function hostActions(backend, getState, getNow) {
  return {
    async startContest() {
      const { game, contestants } = getState();
      if (contestants.length < 2) throw new Error('Necesitas al menos 2 concursantes');
      const candidateIds = contestants.map((c) => c.id);
      // Si hay menos concursantes que el primer corte, saltamos a la etapa que sí tenga sentido
      let stage = 0;
      while (stage < game.cuts.length - 1 && game.cuts[stage] >= candidateIds.length) stage++;
      const round = await backend.insertRound({
        number: 1, stage, cut: game.cuts[stage], votesPerVoter: votesFor(game, stage, candidateIds.length), candidateIds,
      });
      await backend.updateGame({ phase: 'running', currentRoundId: round.id, winnerIds: [], showcase: false, spotlightId: null });
    },

    // Modo desfile
    async startShowcase() { await backend.updateGame({ showcase: true, spotlightId: null }); },
    async spotlight(id) { await backend.updateGame({ spotlightId: id || null }); },
    async endShowcase() { await backend.updateGame({ showcase: false, spotlightId: null }); },

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
      const state = getState();
      const r = currentRound(state);
      if (!r) return;
      const tally = await backend.adminTally(r.id);
      const { qualified } = computeQualifiers(r.candidateIds, tally, r.cut);
      await backend.updateRound(r.id, { status: 'revealed', qualifiedIds: qualified });
      if (qualified.length === 1) await backend.updateGame({ phase: 'finished', winnerIds: qualified });
    },

    // Crea la siguiente ronda (o el desempate si la final quedó empatada)
    async nextRound() {
      const { game, rounds } = getState();
      const r = currentRound(getState());
      if (!r || r.status !== 'revealed') return;
      const q = r.qualifiedIds;
      if (q.length <= 1) return;
      const last = game.cuts.length - 1;
      let stage = r.stage + 1;
      while (stage < last && game.cuts[stage] >= q.length) stage++;
      const isTiebreak = r.stage >= last;
      if (isTiebreak) stage = last;
      const round = await backend.insertRound({
        number: rounds.length + 1,
        stage,
        cut: game.cuts[stage],
        votesPerVoter: isTiebreak ? 1 : votesFor(game, stage, q.length),
        candidateIds: q,
        isTiebreak,
      });
      await backend.updateGame({ currentRoundId: round.id, showcase: false, spotlightId: null });
    },

    async saveConfig(cuts, votesPlan) {
      await backend.updateGame({ cuts, votesPlan });
    },

    async reset() { await backend.resetGame(); },
  };
}
