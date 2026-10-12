// Motor de la partida. Vive en el servidor (una sala = un Durable Object) y es la única fuente de verdad:
// los navegadores solo mandan acciones («tirar», «responder»…) y reciben una copia del estado sin las respuestas.
import {CELLS, N, TEAM_COLORS, DEFAULT_NAMES, allowed, cleanName, playerTeam, teamPlayers, playerName} from '../public/shared.js';
import {QUESTIONS} from './questions.js';

const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const BOT_NAMES = ['Robotina', 'Chip', 'Byte', 'Pixel', 'Tuerca', 'Circuito', 'Bit', 'Señal', 'Voltio', 'Gigas', 'Sensor', 'Router'];

// Tiempos en milisegundos (los tests los acortan).
export const DEFAULT_TIMES = {
  roll:630, step:160,            // animación del dado y de la ficha
  bot:1300, botAnswer:3500, botCont:2200, botVote:2500,
  away:15000,                    // equipo sin nadie conectado: pierde el turno
  hostAway:20000,                // quien creó la partida se va: otro jugador pasa a dirigirla
  setupAway:20000,               // en la sala, quien se desconecta y no vuelve desaparece
};

export function freshState() {
  return {
    phase:'setup', setupCount:4, setupNames:DEFAULT_NAMES.slice(), timeLimit:30,
    teams:[], turn:0, die:null, dests:[], decks:[[],[],[],[],[],[]], q:null, qn:0, picking:false, msg:'', winner:null,
    players:[], // {pid, name, team, online, bot?, leftAt?}
    hostPid:null, // quien dirige la partida (ajustes, empezar, bots)
    roller:null,  // jugador del equipo en turno al que le toca tirar y responder
  };
}

/**
 * Crea una partida.
 * hooks.changed()               → el estado ha cambiado (enviar a todos y guardar).
 * hooks.chat(team, msgs, pids)  → nuevos mensajes del chat de un equipo, solo para esos jugadores.
 */
export function createGame({hooks, saved = null, times = {}}) {
  const T = {...DEFAULT_TIMES, ...times};
  let S = Object.assign(freshState(), saved && saved.S ? saved.S : {});
  const CHAT = new Map(saved && saved.chat ? saved.chat : []); // equipo → mensajes
  let chatN = saved && saved.chatN || 0;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  // Si el servidor se reinició a mitad de una animación, se retoma en un punto estable.
  if (S.phase === 'rolling') S.phase = 'roll';
  if (S.phase === 'moving') { S.teams[S.turn].pos = S.target; later(land, 0); }
  if (S.q && S.q.picked === null && S.timeLimit) S.q.deadline = Date.now() + S.timeLimit * 1000;
  S.players.forEach(p => { if (!p.bot) { p.online = false; p.leftAt = Date.now(); } });

  const isBot = pid => { const p = S.players.find(p => p.pid === pid); return !!(p && p.bot); };
  function changed() {
    if (S.phase !== 'setup' && S.phase !== 'won') assignRoller(false);
    hooks.changed();
  }

  /* ---------- Jugadores ---------- */
  function join(pid, name) {
    let p = S.players.find(p => p.pid === pid);
    if (!p) {
      if (S.players.length >= 80) return false;
      p = {pid, name:'', team:null, online:true};
      S.players.push(p);
    }
    p.online = true; delete p.leftAt;
    const n = cleanName(name);
    if (n) p.name = n;
    if (!S.hostPid) S.hostPid = pid;
    changed();
    if (p.team !== null) sendChat(p.team);
    return true;
  }
  function leave(pid) {
    const p = S.players.find(p => p.pid === pid);
    if (!p) return;
    p.online = false; p.leftAt = Date.now();
    changed();
  }

  /* ---------- Acciones ---------- */
  function perform(pid, a, v) {
    if (!allowed(S, pid, a)) return;
    if (a === 'roll') roll();
    else if (a === 'dest') chooseDest(+v);
    else if (a === 'answer') { if (v && S.q && S.q.id === v.q && Number.isInteger(v.i) && v.i >= 0 && v.i < 4) answer(v.i); }
    else if (a === 'cont') { if (S.q && S.q.id === v) afterAnswer(); }
    else if (a === 'final') openFinalPicker();
    else if (a === 'cat') { if (Number.isInteger(v) && v >= 0 && v < 6) pickFinalCat(v); }
    else if (a === 'chat' && v && typeof v === 'object') postChat(pid, v);
    else if (a === 'team') {
      const p = S.players.find(p => p.pid === pid), max = S.phase === 'setup' ? S.setupCount : S.teams.length;
      if (p && p.name && (v === null || (Number.isInteger(v) && v >= 0 && v < max))) {
        p.team = v; changed();
        if (v !== null && S.phase !== 'setup') sendChat(v);
      }
    } else if (a === 'name') {
      const p = S.players.find(p => p.pid === pid);
      if (p) { p.name = cleanName(v); changed(); }
    } else if (a === 'teamName' && v && typeof v.name === 'string') {
      S.setupNames[playerTeam(S, pid)] = v.name.replace(/\s+/g, ' ').slice(0, 24);
      changed();
    } else if (a === 'setup' && v && typeof v === 'object') setup(v);
    else if (a === 'start') startGame();
    else if (a === 'reset') resetToSetup();
    else if (a === 'addBot') addBot(+v);
    else if (a === 'clearBots') { S.players = S.players.filter(p => !p.bot); changed(); }
  }
  function setup(v) {
    if (Number.isInteger(v.count) && v.count >= 2 && v.count <= 6) {
      S.setupCount = v.count;
      S.players.forEach(p => { if (p.team !== null && p.team >= S.setupCount) p.team = null; });
    }
    if ([0, 20, 30, 45].includes(v.time)) S.timeLimit = v.time;
    if (Array.isArray(v.names)) S.setupNames = DEFAULT_NAMES.map((d, k) => typeof v.names[k] === 'string' ? v.names[k].slice(0, 24) : S.setupNames[k]);
    changed();
  }
  // En cada turno de un equipo tira uno de sus jugadores, por orden; si se desconecta, pasa al siguiente.
  function assignRoller(advance) {
    const ps = teamPlayers(S, S.turn), t = S.teams[S.turn];
    if (!t || !ps.length) { S.roller = null; return; }
    if (advance || !ps.some(p => p.pid === S.roller)) { S.roller = ps[(t.rot || 0) % ps.length].pid; t.rot = (t.rot || 0) + 1; }
  }

  /* ---------- Chat de equipo ---------- */
  const lastPosts = new Map();
  function postChat(pid, v) {
    const team = playerTeam(S, pid), now = Date.now();
    const recent = (lastPosts.get(pid) || []).filter(t => now - t < 4000);
    if (recent.length >= 6) return; // evita inundar el chat
    lastPosts.set(pid, [...recent, now]);
    let msg;
    if (Number.isInteger(v.vote)) {
      const q = S.q;
      if (S.phase !== 'question' || !q || q.id !== v.q || q.picked !== null || team !== S.turn || pid === S.roller || !q.options[v.vote]) return;
      msg = {kind:'vote', q:q.id, i:v.vote, text:q.options[v.vote]};
    } else {
      const text = String(v.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      msg = {kind:'text', text};
    }
    const list = CHAT.get(team) || [];
    list.push({...msg, id:++chatN, pid, name:playerName(S, pid), ts:now});
    CHAT.set(team, list.slice(-60));
    sendChat(team);
  }
  function sendChat(team) {
    hooks.chat(team, CHAT.get(team) || [], S.players.filter(p => p.team === team && p.online && !p.bot).map(p => p.pid));
  }

  /* ---------- Partida ---------- */
  function resetToSetup() {
    // Vuelve a la sala con los mismos equipos y jugadores.
    timers.forEach(clearTimeout); timers.clear();
    const players = S.players.filter(p => p.online).map(p => ({...p, team:p.team !== null && S.teams[p.team] ? S.teams[p.team].setup : p.team}));
    const keep = {setupCount:S.setupCount, setupNames:S.setupNames, timeLimit:S.timeLimit, players, hostPid:S.hostPid};
    S = Object.assign(freshState(), keep);
    changed();
  }
  function startGame() {
    // Solo juegan los equipos que tienen a alguien conectado.
    const used = [];
    for (let k = 0; k < S.setupCount; k++) if (teamPlayers(S, k).length) used.push(k);
    if (used.length < 2) return;
    S.teams = used.map(k => ({name:(S.setupNames[k] || '').trim() || `Equipo ${k+1}`, color:TEAM_COLORS[k].c, ink:TEAM_COLORS[k].ink,
                               setup:k, pos:0, rot:rnd(8), wedges:[false,false,false,false,false,false]}));
    S.players = S.players.filter(p => p.online || p.bot);
    S.players.forEach(p => { p.team = p.team === null ? null : used.indexOf(p.team) < 0 ? null : used.indexOf(p.team); });
    CHAT.clear();
    S.turn = rnd(S.teams.length);
    S.die = null;
    S.msg = 'Empieza este equipo, elegido al azar.';
    beginTurn(true, true);
    S.teams.forEach((_, k) => sendChat(k));
  }
  function beginTurn(keepMsg, newTurn) {
    const t = S.teams[S.turn];
    S.picking = false;
    if (newTurn) assignRoller(true);
    if (t.wedges.every(Boolean)) {
      S.phase = 'final';
      S.msg = '¡Tiene los 6 quesitos! Los demás equipos eligen la categoría.';
    } else {
      S.phase = 'roll';
      if (!keepMsg) S.msg = '';
    }
    changed();
  }
  function nextTeam(msg) {
    // Se salta a los equipos que no tienen a nadie conectado.
    for (let i = 0; i < S.teams.length; i++) {
      S.turn = (S.turn + 1) % S.teams.length;
      if (teamPlayers(S, S.turn).length) break;
    }
    S.die = null;
    if (msg) S.msg = msg;
    beginTurn(!!msg, true);
  }
  function roll() {
    if (S.phase !== 'roll') return;
    S.phase = 'rolling'; S.msg = '';
    changed();
    later(() => {
      if (S.phase !== 'rolling') return;
      S.die = 1 + rnd(6);
      const pos = S.teams[S.turn].pos;
      S.dests = [...new Set([(pos + S.die) % N, (pos - S.die + N) % N])];
      S.phase = 'choose';
      S.msg = 'Pulsa una de las casillas que parpadean.';
      changed();
    }, T.roll);
  }
  function chooseDest(cell) {
    if (S.phase !== 'choose' || !S.dests.includes(cell)) return;
    const t = S.teams[S.turn];
    const dir = (t.pos + S.die) % N === cell ? 1 : -1;
    S.phase = 'moving'; S.target = cell; S.msg = '';
    changed();
    let left = S.die;
    const step = () => {
      if (S.phase !== 'moving') return;
      t.pos = (t.pos + dir + N) % N;
      if (--left <= 0) return land();
      changed();
      later(step, T.step);
    };
    later(step, T.step);
  }
  function land() {
    const t = S.teams[S.turn];
    t.pos = S.target;
    const c = CELLS[t.pos];
    if (c.type === 'again') {
      S.phase = 'roll'; S.msg = '¡Casilla del dado! Tira otra vez.';
      return changed();
    }
    ask(c.cat, c.type === 'hq' && !t.wedges[c.cat] ? 'wedge' : 'normal');
  }
  function draw(cat) {
    if (!S.decks[cat].length) S.decks[cat] = shuffle(QUESTIONS[cat].map((_, i) => i));
    return S.decks[cat].pop();
  }
  function ask(cat, kind) {
    const q = QUESTIONS[cat][draw(cat)];
    S.qn++;
    S.q = {id:S.qn, shownAt:Date.now(), cat, kind, text:q[0], options:shuffle(q.slice(1)), answer:q[1], picked:null,
           deadline:S.timeLimit ? Date.now() + S.timeLimit * 1000 : null};
    S.phase = 'question'; S.picking = false;
    changed();
  }
  function answer(i) {
    const q = S.q;
    if (S.phase !== 'question' || !q || q.picked !== null) return;
    q.picked = i;
    q.ok = i >= 0 && q.options[i] === q.answer;
    if (q.ok && q.kind === 'wedge') S.teams[S.turn].wedges[q.cat] = true;
    if (q.ok && q.kind === 'final') S.winner = S.turn;
    changed();
  }
  function afterAnswer() {
    const q = S.q;
    if (S.phase !== 'question' || !q || q.picked === null) return;
    S.q = null;
    if (S.winner !== null) { S.phase = 'won'; return changed(); }
    if (q.ok) { S.msg = q.kind === 'wedge' ? '¡Quesito nuevo! Sigue tirando.' : '¡Bien! Sigue tirando.'; beginTurn(true, false); }
    else nextTeam();
  }
  function openFinalPicker() {
    if (S.phase !== 'final') return;
    S.picking = true;
    changed();
  }
  function pickFinalCat(k) {
    if (S.phase !== 'final' || !S.picking) return;
    ask(k, 'final');
  }

  /* ---------- Bots para probar ---------- */
  function addBot(k) {
    if (S.phase !== 'setup' || S.players.length >= 80 || !(k >= 0 && k < S.setupCount)) return;
    const used = new Set(S.players.map(p => p.name));
    const name = 'Bot ' + (BOT_NAMES.find(n => !used.has('Bot ' + n)) || BOT_NAMES[rnd(BOT_NAMES.length)] + ' ' + (S.players.length + 1));
    S.players.push({pid:'bot-' + Math.random().toString(36).slice(2, 9), name, team:k, online:true, bot:true});
    changed();
  }
  let botKey = '', botAt = 0;
  const votedQ = new Set();
  function botTick(now) {
    if (['setup','won','moving','rolling'].includes(S.phase)) return;
    const q = S.q;
    // Un bot compañero propone una respuesta mientras responde una persona de su equipo.
    if (S.phase === 'question' && q && q.picked === null && !isBot(S.roller)) {
      teamPlayers(S, S.turn).filter(p => p.bot && !votedQ.has(q.id + p.pid)).forEach(p => {
        if (now - (q.shownAt || 0) < T.botVote) return;
        votedQ.add(q.id + p.pid);
        const right = q.options.indexOf(q.answer);
        postChat(p.pid, {text:Math.random() < .5 ? '¡Creo que lo sé!' : 'Mmm… yo diría esta'});
        postChat(p.pid, {vote:Math.random() < .65 ? right : rnd(4), q:q.id});
      });
    }
    // ¿Qué tiene que hacer un bot ahora?
    let who = null, a = null, v = null;
    if (isBot(S.roller)) {
      who = S.roller;
      if (S.phase === 'roll') a = 'roll';
      else if (S.phase === 'choose') {
        a = 'dest';
        const t = S.teams[S.turn];
        const good = S.dests.find(c => CELLS[c].type === 'hq' && !t.wedges[CELLS[c].cat]);
        v = good !== undefined ? good : S.dests[rnd(S.dests.length)];
      }
      else if (S.phase === 'question' && q && q.picked === null) { a = 'answer'; v = {q:q.id, i:Math.random() < .65 ? q.options.indexOf(q.answer) : rnd(4)}; }
      else if (S.phase === 'question' && q) { a = 'cont'; v = q.id; }
      else if (S.phase === 'final' && !S.picking) a = 'final';
    }
    if (S.phase === 'final' && S.picking) {
      // La categoría final la elige un bot de otro equipo solo si no hay personas que puedan elegirla.
      const others = S.players.filter(p => p.online && p.team !== null && p.team !== S.turn);
      if (others.length && others.every(p => p.bot)) { who = others[0].pid; a = 'cat'; v = rnd(6); }
      else a = null;
    }
    if (!a) { botKey = ''; return; }
    const key = [S.phase, S.turn, q && q.id, q && q.picked, S.picking].join('|');
    if (key !== botKey) { botKey = key; botAt = now + (a === 'answer' ? T.botAnswer : a === 'cont' ? T.botCont : T.bot); return; }
    if (now < botAt) return;
    botKey = '';
    perform(who, a, v);
  }

  /* ---------- Reloj: tiempo de respuesta, desconexiones y bots ---------- */
  let awaySince = null;
  function tick(now = Date.now()) {
    // Se acabó el tiempo para responder.
    if (S.phase === 'question' && S.q && S.q.picked === null && S.q.deadline && now >= S.q.deadline) answer(-1);
    // Quien dirige la partida se ha ido: pasa a dirigirla otra persona conectada.
    const host = S.players.find(p => p.pid === S.hostPid);
    if ((!host || (!host.online && now - (host.leftAt || 0) > T.hostAway))) {
      const next = S.players.find(p => p.online && !p.bot);
      if (next && next.pid !== S.hostPid) { S.hostPid = next.pid; changed(); }
    }
    // En la sala, quien se desconectó y no ha vuelto desaparece.
    if (S.phase === 'setup' && S.players.some(p => !p.online && !p.bot && now - (p.leftAt || 0) > T.setupAway)) {
      S.players = S.players.filter(p => p.online || p.bot || now - (p.leftAt || 0) <= T.setupAway);
      changed();
    }
    // El equipo al que le toca no tiene a nadie conectado: pierde el turno.
    if (['setup','won','moving','rolling'].includes(S.phase) || teamPlayers(S, S.turn).length) awaySince = null;
    else {
      awaySince = awaySince || now;
      if (now - awaySince > T.away) {
        awaySince = null;
        const t = S.teams[S.turn];
        S.q = null;
        nextTeam(`${t.name} se ha desconectado y pierde el turno.`);
      }
    }
    botTick(now);
  }

  // Lo que reciben los navegadores: sin mazos ni la respuesta correcta hasta que se ha contestado.
  function publicState() {
    const P = JSON.parse(JSON.stringify(S));
    delete P.decks;
    P.players.forEach(p => delete p.leftAt);
    if (P.q) {
      if (P.q.picked === null) delete P.q.answer;
      P.q.left = S.q.deadline ? Math.max(0, S.q.deadline - Date.now()) : null;
      delete P.q.deadline;
    }
    return P;
  }

  return {
    join, leave, perform, tick, publicState,
    get state() { return S; },
    snapshot: () => ({S, chat:[...CHAT], chatN}),
    chatFor: team => CHAT.get(team) || [],
    stop: () => { timers.forEach(clearTimeout); timers.clear(); },
  };
}
