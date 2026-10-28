// Backend de demostración: todo vive en localStorage de este navegador.
// Varias pestañas abiertas (TV, host, "celulares") se sincronizan entre sí,
// así se puede probar el concurso completo sin Supabase.
// Reproduce las mismas reglas que las funciones SQL de supabase/schema.sql.

import { makeCode, uid } from './util.js';

const KEY = 'disfraces-demo-v1';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;

function blank() {
  return {
    game: { phase: 'setup', cuts: [25, 10, 5, 1], votesPlan: [3, 2, 2, 1], currentRoundId: null, winnerIds: [], theme: 'clasico', showcase: false, spotlightId: null },
    contestants: [],
    codes: {},        // contestantId -> code
    rounds: [],
    votes: [],        // {roundId, deviceId, contestantId}
    deviceLinks: {},  // deviceId -> contestantId
    nextRoundId: 1,
  };
}

let memory = null;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage bloqueado: seguimos en memoria */ }
  return memory || blank();
}
function save(db) {
  memory = db;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {
    console.warn('No se pudo guardar el demo (¿fotos muy pesadas?)', e);
  }
  channel?.postMessage('change');
  listeners.forEach((cb) => cb());
}
function mutate(fn) {
  const db = load();
  const out = fn(db);
  save(db);
  return out;
}

const listeners = new Set();
channel?.addEventListener('message', () => listeners.forEach((cb) => cb()));
window.addEventListener('storage', (e) => { if (e.key === KEY) listeners.forEach((cb) => cb()); });

const clone = (x) => JSON.parse(JSON.stringify(x));

function tallyFor(db, round) {
  const counts = Object.fromEntries(round.candidateIds.map((id) => [id, 0]));
  for (const v of db.votes) if (v.roundId === round.id && v.contestantId in counts) counts[v.contestantId]++;
  return counts;
}

export function createDemoBackend() {
  return {
    mode: 'demo',

    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async serverNow() { return Date.now(); },

    async fetchPublic() {
      const db = load();
      return { game: clone(db.game), contestants: clone(db.contestants), rounds: clone(db.rounds) };
    },

    async fetchTally(roundId) {
      const db = load();
      const round = db.rounds.find((r) => r.id === roundId);
      if (!round) return [];
      const revealed = round.status === 'revealed';
      return Object.entries(tallyFor(db, round))
        .map(([id, votes]) => ({ id: revealed ? id : null, votes }))
        .sort((a, b) => b.votes - a.votes);
    },

    async joinWithCode(code, deviceId) {
      return mutate((db) => {
        const id = Object.keys(db.codes).find((cid) => db.codes[cid] === code.trim().toUpperCase());
        if (!id) return null;
        db.deviceLinks[deviceId] = id;
        const c = db.contestants.find((x) => x.id === id);
        return c ? { id: c.id, name: c.name } : null;
      });
    },

    async castVotes(deviceId, roundId, choices) {
      mutate((db) => {
        const r = db.rounds.find((x) => x.id === roundId);
        if (!r) throw new Error('Esa ronda no existe');
        if (r.status !== 'open' || (r.endsAt && Date.now() > r.endsAt)) throw new Error('La votación ya está cerrada');
        if (choices.length < 1 || choices.length > r.votesPerVoter) throw new Error(`Puedes votar por entre 1 y ${r.votesPerVoter} disfraces`);
        if (new Set(choices).size !== choices.length) throw new Error('No puedes repetir un disfraz');
        if (!choices.every((c) => r.candidateIds.includes(c))) throw new Error('Ese disfraz ya no está en concurso');
        if (choices.includes(db.deviceLinks[deviceId])) throw new Error('No puedes votar por ti mismo 😏');
        if (db.votes.some((v) => v.roundId === roundId && v.deviceId === deviceId)) throw new Error('Ya votaste en esta ronda');
        for (const c of choices) db.votes.push({ roundId, deviceId, contestantId: c });
        r.voteCount += choices.length;
        r.voterCount += 1;
      });
    },

    // ---------- Host ----------
    async getSession() { return { email: 'demo' }; },
    async signIn() { return { email: 'demo' }; },
    async signOut() {},

    async adminTally(roundId) {
      const db = load();
      const round = db.rounds.find((r) => r.id === roundId);
      return round ? tallyFor(db, round) : {};
    },
    async adminCodes() { return clone(load().codes); },

    async addContestant(name, photoBlob) {
      const photo = photoBlob ? await blobToDataUrl(photoBlob) : null;
      return mutate((db) => {
        const id = uid();
        const taken = new Set(Object.values(db.codes));
        let code;
        do code = makeCode(); while (taken.has(code));
        db.contestants.push({ id, name, photo, createdAt: Date.now() });
        db.codes[id] = code;
        return { id, code };
      });
    },
    async deleteContestant(id) {
      mutate((db) => {
        db.contestants = db.contestants.filter((c) => c.id !== id);
        delete db.codes[id];
        db.votes = db.votes.filter((v) => v.contestantId !== id);
        for (const d of Object.keys(db.deviceLinks)) if (db.deviceLinks[d] === id) delete db.deviceLinks[d];
      });
    },
    async updateGame(patch) { mutate((db) => Object.assign(db.game, patch)); },
    async insertRound(round) {
      return mutate((db) => {
        const r = { id: db.nextRoundId++, status: 'ready', endsAt: null, qualifiedIds: [], voteCount: 0, voterCount: 0, isTiebreak: false, ...round };
        db.rounds.push(r);
        return clone(r);
      });
    },
    async updateRound(id, patch) { mutate((db) => Object.assign(db.rounds.find((r) => r.id === id), patch)); },
    async resetGame() {
      mutate((db) => {
        Object.assign(db.game, { phase: 'setup', currentRoundId: null, winnerIds: [], showcase: false, spotlightId: null });
        db.rounds = [];
        db.votes = [];
      });
    },

    // ---------- Solo demo ----------
    async wipeAll() { save(blank()); },
    async seedFake(n) {
      mutate((db) => {
        const taken = new Set(Object.values(db.codes));
        for (let i = 0; i < n; i++) {
          const id = uid();
          let code;
          do code = makeCode(); while (taken.has(code));
          taken.add(code);
          const [emoji, label] = FAKE[i % FAKE.length];
          const name = i < FAKE.length ? label : `${label} ${Math.floor(i / FAKE.length) + 1}`;
          db.contestants.push({ id, name, photo: fakePhoto(emoji, i), createdAt: Date.now() + i });
          db.codes[id] = code;
        }
      });
    },
    // Simula invitados votando poco a poco (para ver la TV moverse).
    simulateVotes(roundId, voters = 40, ms = 6000) {
      let done = 0;
      const timer = setInterval(() => {
        const db = load();
        const r = db.rounds.find((x) => x.id === roundId);
        if (!r || r.status !== 'open' || done >= voters) { clearInterval(timer); return; }
        // Algunos disfraces son más populares que otros
        const weights = r.candidateIds.map((_, i) => 1 + ((i * 7919) % 13));
        const picks = new Set();
        const want = Math.min(r.votesPerVoter, r.candidateIds.length);
        while (picks.size < want) picks.add(weightedPick(r.candidateIds, weights));
        this.castVotes(`bot-${roundId}-${done}`, roundId, [...picks]).catch(() => {});
        done++;
      }, Math.max(60, ms / voters));
    },
  };
}

function weightedPick(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

const FAKE = [
  ['🧛', 'Drácula'], ['🧟', 'Zombi'], ['👻', 'Fantasma'], ['🧙‍♀️', 'Bruja'], ['🎃', 'Calabaza'],
  ['🦇', 'Murciélago'], ['💀', 'Calaca'], ['🕷️', 'Araña'], ['🤡', 'Payaso'], ['🧜‍♀️', 'Sirena'],
  ['🦸', 'Superhéroe'], ['🐺', 'Hombre Lobo'], ['👽', 'Alien'], ['🤖', 'Robot'], ['🏴‍☠️', 'Pirata'],
  ['🧞', 'Genio'], ['🦄', 'Unicornio'], ['🥷', 'Ninja'], ['👸', 'Princesa'], ['🐉', 'Dragón'],
];
const HUES = [280, 25, 140, 200, 330, 50, 0, 170];
function fakePhoto(emoji, i) {
  const h = HUES[i % HUES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="hsl(${h},70%,45%)"/><stop offset="1" stop-color="hsl(${h},60%,12%)"/></radialGradient></defs><rect width="300" height="400" fill="url(#g)"/><text x="150" y="235" font-size="170" text-anchor="middle">${emoji}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
