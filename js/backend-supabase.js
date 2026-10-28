// Backend real: Supabase (base de datos + fotos + tiempo real).
// Las reglas de votación viven en supabase/schema.sql.

import { makeCode, uid } from './util.js';

// Versión reciente: funciona con las llaves nuevas "publishable" (sb_publishable_…) y con la anon de siempre
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

const toRound = (r) => ({
  id: r.id,
  number: r.number,
  stage: r.stage,
  cut: r.cut,
  votesPerVoter: r.votes_per_voter,
  status: r.status,
  endsAt: r.ends_at ? Date.parse(r.ends_at) : null,
  candidateIds: r.candidate_ids || [],
  qualifiedIds: r.qualified_ids || [],
  isTiebreak: r.is_tiebreak,
  voteCount: r.vote_count,
  voterCount: r.voter_count,
});
const fromRound = (p) => {
  const map = {
    number: 'number', stage: 'stage', cut: 'cut', votesPerVoter: 'votes_per_voter', status: 'status',
    candidateIds: 'candidate_ids', qualifiedIds: 'qualified_ids', isTiebreak: 'is_tiebreak',
  };
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'endsAt') out.ends_at = v ? new Date(v).toISOString() : null;
    else if (map[k]) out[map[k]] = v;
  }
  return out;
};
const toGame = (g) => ({
  phase: g.phase,
  cuts: g.cuts,
  votesPlan: g.votes_plan,
  currentRoundId: g.current_round_id,
  winnerIds: g.winner_ids || [],
  theme: g.theme || 'clasico',
  showcase: !!g.showcase,
  spotlightId: g.spotlight_id || null,
});
const fromGame = (p) => {
  const map = {
    phase: 'phase', cuts: 'cuts', votesPlan: 'votes_plan', currentRoundId: 'current_round_id', winnerIds: 'winner_ids',
    theme: 'theme', showcase: 'showcase', spotlightId: 'spotlight_id',
  };
  const out = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(p)) if (map[k]) out[map[k]] = v;
  return out;
};

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function createSupabaseBackend(url, key) {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(url, key, { realtime: { params: { eventsPerSecond: 20 } } });
  const listeners = new Set();
  const fire = () => listeners.forEach((cb) => cb());

  sb.channel('concurso')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, fire)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, fire)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contestants' }, fire)
    .subscribe();
  // Por si el tiempo real se cae (wifi de fiesta…), refrescamos cada 5 s
  setInterval(fire, 5000);

  return {
    mode: 'supabase',

    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    async serverNow() {
      const t0 = Date.now();
      const data = check(await sb.rpc('server_now'));
      const t1 = Date.now();
      return Date.parse(data) + (t1 - t0) / 2;
    },

    async fetchPublic() {
      const [g, c, r] = await Promise.all([
        sb.from('game').select('*').eq('id', 1).single(),
        sb.from('contestants').select('id,name,photo_url,created_at').order('created_at'),
        sb.from('rounds').select('*').order('id'),
      ]);
      return {
        game: toGame(check(g)),
        contestants: check(c).map((x) => ({ id: x.id, name: x.name, photo: x.photo_url, createdAt: Date.parse(x.created_at) })),
        rounds: check(r).map(toRound),
      };
    },

    async fetchTally(roundId) {
      const rows = check(await sb.rpc('round_tally', { p_round: roundId }));
      return rows.map((x) => ({ id: x.contestant_id, votes: x.votes }));
    },

    async joinWithCode(code, deviceId) {
      const rows = check(await sb.rpc('join_with_code', { p_code: code, p_device: deviceId }));
      return rows[0] || null;
    },

    async castVotes(deviceId, roundId, choices) {
      check(await sb.rpc('cast_vote', { p_device: deviceId, p_round: roundId, p_choices: choices }));
    },

    // ---------- Host ----------
    async getSession() {
      const { data } = await sb.auth.getSession();
      return data.session ? { email: data.session.user.email } : null;
    },
    async signIn(email, password) {
      const data = check(await sb.auth.signInWithPassword({ email, password }));
      return { email: data.user.email };
    },
    async signOut() { await sb.auth.signOut(); },

    async adminTally(roundId) {
      const rows = check(await sb.rpc('admin_tally', { p_round: roundId }));
      return Object.fromEntries(rows.map((x) => [x.contestant_id, x.votes]));
    },
    async adminCodes() {
      const rows = check(await sb.from('contestant_codes').select('contestant_id,code'));
      return Object.fromEntries(rows.map((x) => [x.contestant_id, x.code]));
    },

    async addContestant(name, photoBlob) {
      let photo_url = null;
      if (photoBlob) {
        const path = `${uid()}.jpg`;
        check(await sb.storage.from('photos').upload(path, photoBlob, { contentType: 'image/jpeg', cacheControl: '31536000' }));
        photo_url = sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
      }
      const row = check(await sb.from('contestants').insert({ name, photo_url }).select('id').single());
      // Reintenta si el código ya existe (muy raro)
      for (let i = 0; i < 5; i++) {
        const code = makeCode();
        const { error } = await sb.from('contestant_codes').insert({ contestant_id: row.id, code });
        if (!error) return { id: row.id, code };
      }
      throw new Error('No se pudo generar el código');
    },
    async deleteContestant(id) {
      const row = check(await sb.from('contestants').select('photo_url').eq('id', id).single());
      check(await sb.from('contestants').delete().eq('id', id));
      const path = row.photo_url?.split('/photos/')[1];
      if (path) await sb.storage.from('photos').remove([path]);
    },
    // Borra a todos los concursantes y sus fotos (sus códigos y votos se van en cascada)
    async deleteAllContestants() {
      const rows = check(await sb.from('contestants').select('photo_url'));
      check(await sb.from('contestants').delete().not('id', 'is', null));
      const paths = rows.map((r) => r.photo_url?.split('/photos/')[1]).filter(Boolean);
      for (let i = 0; i < paths.length; i += 100) await sb.storage.from('photos').remove(paths.slice(i, i + 100));
    },
    async updateGame(patch) { check(await sb.from('game').update(fromGame(patch)).eq('id', 1)); },
    async insertRound(round) {
      const data = check(await sb.from('rounds').insert(fromRound({ status: 'ready', ...round })).select('*').single());
      return toRound(data);
    },
    async updateRound(id, patch) { check(await sb.from('rounds').update(fromRound(patch)).eq('id', id)); },
    async resetGame() { check(await sb.rpc('reset_game')); },
  };
}
