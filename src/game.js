// Motor de la partida. Vive en el servidor (una sala = un Durable Object) y es la única fuente de verdad:
// los navegadores solo mandan acciones («tirar», «responder»…) y reciben una copia del estado sin las respuestas.
import {CELLS, N, TEAM_COLORS, DEFAULT_NAMES, allowed, cleanName, playerTeam, teamPlayers, playerName} from '../public/shared.js';
import {QUESTIONS} from './questions.js';
import {canBeOpen, judge} from './answers.js';

const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const FINAL_TO_WIN = 4; // aciertos necesarios en la ronda final (de 6)
const BOT_NAMES = ['Robotina', 'Chip', 'Byte', 'Pixel', 'Tuerca', 'Circuito', 'Bit', 'Señal', 'Voltio', 'Gigas', 'Sensor', 'Router'];

// Tiempos en milisegundos (los tests los acortan).
export const DEFAULT_TIMES = {
  roll:630, step:160,            // animación del dado y de la ficha
  bot:1300, botAnswer:3500, botCont:2200, botVote:2500,
  pass:4500,                     // tras fallar, tiempo para ver la respuesta antes de pasar el turno solo
  away:15000,                    // equipo sin nadie conectado: pierde el turno
  hostAway:20000,                // quien creó la partida se va: otro jugador pasa a dirigirla
  setupAway:20000,               // en la sala, quien se desconecta y no vuelve desaparece
};

export function freshState() {
  return {
    phase:'setup', setupCount:4, setupNames:DEFAULT_NAMES.slice(), timeLimit:30,
    openMode:1, // preguntas para escribir (sin opciones): 0 ninguna, 1 una de cada tres, 2 todas las que se puedan
    teams:[], turn:0, die:null, dests:[], decks:[[],[],[],[],[],[]], q:null, qn:0, final:null, msg:'', winner:null,
    players:[], // {pid, name, team, online, bot?, leftAt?}
    kicked:[],  // jugadores expulsados: no pueden volver a entrar
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
    else if (a === 'answer') {
      if (!v || !S.q || S.q.id !== v.q) return;
      if (S.q.open) { if (typeof v.text === 'string' && v.text.trim()) answer(0, v.text.replace(/\s+/g, ' ').trim().slice(0, 60)); }
      else if (Number.isInteger(v.i) && v.i >= 0 && v.i < 4) answer(v.i);
    }
    else if (a === 'cont') { if (S.q && S.q.id === v) afterAnswer(); }
    else if (a === 'final') startFinal();
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
    else if (a === 'kick') kick(v);
  }
  function setup(v) {
    if (Number.isInteger(v.count) && v.count >= 2 && v.count <= 6) {
      S.setupCount = v.count;
      S.players.forEach(p => { if (p.team !== null && p.team >= S.setupCount) p.team = null; });
    }
    if ([0, 20, 30, 45].includes(v.time)) S.timeLimit = v.time;
    if ([0, 1, 2].includes(v.open)) S.openMode = v.open;
    if (Array.isArray(v.names)) S.setupNames = DEFAULT_NAMES.map((d, k) => typeof v.names[k] === 'string' ? v.names[k].slice(0, 24) : S.setupNames[k]);
    changed();
  }
  // Quien dirige la sala expulsa a un jugador (o a un bot): sale de la partida y no puede volver a entrar.
  function kick(pid) {
    const p = S.players.find(p => p.pid === pid);
    if (!p || pid === S.hostPid) return;
    S.players = S.players.filter(x => x !== p);
    if (!p.bot) S.kicked = [...(S.kicked || []), pid].slice(-200);
    if (S.phase !== 'setup' && p.team === S.turn && S.roller === pid) assignRoller(false); // le tocaba: sigue otro de su equipo
    hooks.kicked && hooks.kicked(pid);
    changed();
  }
  const isKicked = pid => (S.kicked || []).includes(pid);
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
      if (S.phase !== 'question' || !q || q.id !== v.q || q.picked !== null || q.open || team !== S.turn || pid === S.roller || !q.options[v.vote]) return;
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
    const keep = {setupCount:S.setupCount, setupNames:S.setupNames, timeLimit:S.timeLimit, openMode:S.openMode, kicked:S.kicked, players, hostPid:S.hostPid};
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
    S.final = null;
    if (newTurn) assignRoller(true);
    if (t.wedges.every(Boolean)) {
      S.phase = 'final';
      S.msg = '¡Tiene los 6 quesitos! Ronda final: 6 preguntas, una de cada categoría. Hay que acertar 4.';
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
  // Saca la siguiente pregunta del mazo; con openOnly, la siguiente que se pueda responder escribiendo.
  function draw(cat, openOnly) {
    if (!S.decks[cat].length) S.decks[cat] = shuffle(QUESTIONS[cat].map((_, i) => i));
    const d = S.decks[cat];
    const j = openOnly ? d.findLastIndex(i => canBeOpen(QUESTIONS[cat][i][1])) : -1;
    return j >= 0 ? d.splice(j, 1)[0] : d.pop();
  }
  function ask(cat, kind) {
    const q = QUESTIONS[cat][draw(cat, kind === 'wedge')];
    S.qn++;
    // Las preguntas de quesito son siempre para escribir; las demás, según el ajuste de la sala.
    const open = canBeOpen(q[1]) && (kind === 'wedge' || S.openMode === 2 || (S.openMode === 1 && Math.random() < 1 / 3));
    S.q = {id:S.qn, shownAt:Date.now(), cat, kind, text:q[0], options:shuffle(q.slice(1)), answer:q[1], picked:null, open,
           deadline:S.timeLimit ? Date.now() + S.timeLimit * 1000 : null};
    S.phase = 'question';
    changed();
  }
  // i: opción elegida (-1 si se acaba el tiempo). En las preguntas para escribir, text es lo que se ha escrito.
  function answer(i, text) {
    const q = S.q;
    if (S.phase !== 'question' || !q || q.picked !== null) return;
    q.picked = i;
    if (q.open) { q.given = i >= 0 ? text : ''; q.ok = i >= 0 && judge(text, q.answer); }
    else q.ok = i >= 0 && q.options[i] === q.answer;
    if (q.ok && q.kind === 'wedge') S.teams[S.turn].wedges[q.cat] = true;
    if (q.kind === 'final') {
      if (q.ok) S.final.ok++; else S.final.ko++;
      S.final.res.push(q.ok);
      if (S.final.ok >= FINAL_TO_WIN) S.winner = S.turn;
    }
    // Si se pierde el turno, pasa solo al siguiente equipo al cabo de un momento (sin tener que darle a nada).
    const out = q.kind === 'final' ? S.final.ko > S.final.cats.length - FINAL_TO_WIN : !q.ok;
    if (out && S.winner === null) q.passAt = Date.now() + T.pass;
    changed();
  }
  function afterAnswer() {
    const q = S.q;
    if (S.phase !== 'question' || !q || q.picked === null) return;
    S.q = null;
    if (S.winner !== null) { S.phase = 'won'; return changed(); }
    if (q.kind === 'final') {
      // Ronda final: sigue con la siguiente categoría salvo que ya no pueda llegar a 4 aciertos.
      const F = S.final;
      if (F.ko > F.cats.length - FINAL_TO_WIN) return nextTeam(`${S.teams[S.turn].name} no ha llegado a ${FINAL_TO_WIN} aciertos en la ronda final.`);
      F.idx++;
      return ask(F.cats[F.idx], 'final');
    }
    if (q.ok) { S.msg = q.kind === 'wedge' ? '¡Quesito nuevo! Sigue tirando.' : '¡Bien! Sigue tirando.'; beginTurn(true, false); }
    else nextTeam();
  }
  // Ronda final: una pregunta de cada categoría, en orden aleatorio; gana quien acierte 4 de 6.
  function startFinal() {
    if (S.phase !== 'final') return;
    S.final = {cats:shuffle([0, 1, 2, 3, 4, 5]), idx:0, ok:0, ko:0, res:[]};
    ask(S.final.cats[0], 'final');
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
        const right = q.options.indexOf(q.answer), knows = Math.random() < .65;
        if (q.open) return postChat(p.pid, {text:knows ? `Yo diría «${q.answer}»` : 'Ni idea, lo siento'});
        postChat(p.pid, {text:Math.random() < .5 ? '¡Creo que lo sé!' : 'Mmm… yo diría esta'});
        postChat(p.pid, {vote:knows ? right : rnd(4), q:q.id});
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
      else if (S.phase === 'question' && q && q.picked === null) {
        a = 'answer';
        const knows = Math.random() < .65;
        v = q.open ? {q:q.id, text:knows ? q.answer : 'Ni idea'} : {q:q.id, i:knows ? q.options.indexOf(q.answer) : rnd(4)};
      }
      else if (S.phase === 'question' && q && !q.passAt) { a = 'cont'; v = q.id; }
      else if (S.phase === 'final') a = 'final';
    }
    if (!a) { botKey = ''; return; }
    const key = [S.phase, S.turn, q && q.id, q && q.picked].join('|');
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
    // Se ha fallado: pasa el turno solo.
    else if (S.phase === 'question' && S.q && S.q.passAt && now >= S.q.passAt) afterAnswer();
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
    delete P.decks; delete P.kicked;
    P.players.forEach(p => delete p.leftAt);
    if (P.q) {
      if (P.q.picked === null) delete P.q.answer;
      if (P.q.open) delete P.q.options; // sin opciones: hay que escribir la respuesta
      P.q.left = S.q.deadline ? Math.max(0, S.q.deadline - Date.now()) : null;
      P.q.passIn = S.q.passAt ? Math.max(0, S.q.passAt - Date.now()) : null;
      delete P.q.deadline; delete P.q.passAt;
    }
    return P;
  }

  return {
    join, leave, perform, tick, publicState, isKicked,
    get state() { return S; },
    snapshot: () => ({S, chat:[...CHAT], chatN}),
    chatFor: team => CHAT.get(team) || [],
    stop: () => { timers.forEach(clearTimeout); timers.clear(); },
  };
}
