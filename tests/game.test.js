// Pruebas del motor de la partida (src/game.js), sin servidor ni navegador.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../src/game.js';
import {QUESTIONS} from '../src/questions.js';

const FAST = {roll:0, step:0, bot:0, botAnswer:0, botCont:0, botVote:0, away:50, hostAway:50, setupAway:50};
const wait = ms => new Promise(r => setTimeout(r, ms));

function setup() {
  const chats = [];
  const g = createGame({times:FAST, hooks:{changed() {}, chat: (team, msgs, pids) => chats.push({team, msgs, pids})}});
  return {g, chats, S: () => g.state};
}
// Ane y Jon en el equipo 0, Mikel en el 1; Ane crea la partida.
function threePlayers() {
  const t = setup();
  t.g.join('ane', 'Ane'); t.g.join('jon', 'Jon'); t.g.join('mikel', 'Mikel');
  t.g.perform('ane', 'team', 0); t.g.perform('jon', 'team', 0); t.g.perform('mikel', 'team', 1);
  return t;
}
// Juega el turno actual hasta la pregunta.
async function toQuestion(t) {
  for (let i = 0; i < 20 && t.S().phase !== 'question'; i++) {
    const S = t.S();
    if (S.phase === 'roll') t.g.perform(S.roller, 'roll');
    else if (S.phase === 'choose') t.g.perform(S.roller, 'dest', S.dests[0]);
    await wait(5);
  }
  assert.equal(t.S().phase, 'question');
}

test('quien crea la sala la dirige y solo empieza con 2 equipos con gente', () => {
  const t = setup();
  t.g.join('ane', 'Ane'); t.g.join('jon', 'Jon');
  assert.equal(t.S().hostPid, 'ane');
  t.g.perform('ane', 'team', 0); t.g.perform('jon', 'team', 0);
  t.g.perform('ane', 'start');
  assert.equal(t.S().phase, 'setup', 'un solo equipo: no empieza');
  t.g.perform('jon', 'team', 1);
  t.g.perform('jon', 'start');
  assert.equal(t.S().phase, 'setup', 'Jon no puede empezar');
  t.g.perform('ane', 'start');
  assert.equal(t.S().phase, 'roll');
  assert.equal(t.S().teams.length, 2, 'los equipos vacíos no juegan');
});

test('cualquiera del equipo puede cambiar su nombre en la sala, pero no el de otro equipo', () => {
  const t = threePlayers();
  t.g.perform('jon', 'teamName', {name:'Los Txapeldunak'});
  assert.equal(t.S().setupNames[0], 'Los Txapeldunak');
  t.g.perform('mikel', 'teamName', {name:'Los Mejores'});
  assert.equal(t.S().setupNames[1], 'Los Mejores', 'solo cambia el suyo');
  assert.equal(t.S().setupNames[0], 'Los Txapeldunak');
  t.g.join('leire', 'Leire');
  t.g.perform('leire', 'teamName', {name:'Sin equipo'});
  assert.ok(!t.S().setupNames.includes('Sin equipo'), 'sin equipo no puede renombrar');
  t.g.perform('ane', 'start');
  t.g.perform('jon', 'teamName', {name:'Ya empezada'});
  assert.equal(t.S().teams[0].name, 'Los Txapeldunak', 'durante la partida no cambia');
});

test('solo tira y responde el jugador al que le toca, y el turno rota dentro del equipo', async () => {
  const t = threePlayers();
  t.g.perform('ane', 'start');
  const seen = {0:[], 1:[]};
  for (let turn = 0; turn < 8; turn++) {
    const S = t.S(), turnBefore = S.turn, roller = S.roller;
    seen[turnBefore].push(roller);
    const others = S.players.filter(p => p.pid !== roller);
    for (const p of others) { t.g.perform(p.pid, 'roll'); assert.equal(t.S().phase, 'roll', `${p.pid} no puede tirar`); }
    await toQuestion(t);
    const q = t.S().q;
    t.g.perform(others[0].pid, 'answer', {q:q.id, i:0});
    assert.equal(t.S().q.picked, null, 'otro jugador no puede responder');
    const wrong = q.options.findIndex(o => o !== q.answer);
    t.g.perform(roller, 'answer', {q:q.id, i:wrong});
    t.g.perform(roller, 'cont', q.id);
    assert.notEqual(t.S().turn, turnBefore, 'al fallar pasa el turno');
  }
  assert.ok(seen[0].includes('ane') && seen[0].includes('jon'), 'en el equipo de dos tiran los dos');
  assert.ok(seen[1].every(p => p === 'mikel'));
});

test('la respuesta correcta no se envía hasta que se contesta', async () => {
  const t = threePlayers();
  t.g.perform('ane', 'start');
  await toQuestion(t);
  const pub = t.g.publicState();
  assert.equal(pub.q.answer, undefined);
  assert.equal(pub.decks, undefined);
  t.g.perform(t.S().roller, 'answer', {q:pub.q.id, i:0});
  assert.equal(typeof t.g.publicState().q.answer, 'string');
});

test('el chat de equipo solo llega a ese equipo y las propuestas a la pregunta actual', async () => {
  const t = threePlayers();
  t.g.perform('ane', 'start');
  await toQuestion(t);
  const S = t.S(), team = S.turn;
  const mate = S.players.find(p => p.team === team && p.pid !== S.roller);
  t.chats.length = 0;
  if (mate) {
    t.g.perform(mate.pid, 'chat', {text:'Yo diría la B'});
    t.g.perform(mate.pid, 'chat', {vote:1, q:S.q.id});
    t.g.perform(S.roller, 'chat', {vote:2, q:S.q.id}); // quien responde no propone
    const last = t.chats.at(-1);
    assert.deepEqual(last.pids.sort(), S.players.filter(p => p.team === team).map(p => p.pid).sort());
    assert.deepEqual(last.msgs.map(m => m.kind), ['text', 'vote']);
  } else {
    t.g.perform(S.roller, 'chat', {text:'hola'});
    assert.deepEqual(t.chats.at(-1).pids, [S.roller]);
  }
});

test('se acaba el tiempo para responder', async () => {
  const t = threePlayers();
  t.g.perform('ane', 'setup', {time:20});
  t.g.perform('ane', 'start');
  await toQuestion(t);
  t.g.tick(Date.now() + 21000);
  assert.equal(t.S().q.picked, -1);
});

test('si quien dirige se va, otra persona pasa a dirigir; si un equipo se queda vacío, pierde el turno', async () => {
  const t = threePlayers();
  t.g.perform('ane', 'start');
  t.g.leave('ane');
  await wait(80);
  t.g.tick();
  assert.notEqual(t.S().hostPid, 'ane');
  // Deja vacío el equipo al que le toca
  const turn = t.S().turn;
  t.S().players.filter(p => p.team === turn).forEach(p => t.g.leave(p.pid));
  t.g.tick(); await wait(80); t.g.tick();
  assert.notEqual(t.S().turn, turn);
});

test('los bots juegan solos', async () => {
  const t = setup();
  t.g.join('ane', 'Ane');
  t.g.perform('ane', 'team', 0);
  t.g.perform('ane', 'addBot', 1);
  t.g.perform('jon', 'addBot', 0); // solo quien dirige añade bots
  assert.equal(t.S().players.filter(p => p.bot).length, 1);
  t.g.perform('ane', 'start');
  // Fuerza que empiece el bot
  const botTeam = t.S().players.find(p => p.bot).team;
  for (let i = 0; i < 400 && !(t.S().turn !== botTeam && t.S().phase === 'roll' && i > 0 && t.S().qn > 0); i++) {
    const S = t.S();
    if (S.turn !== botTeam) { // Ane falla para pasar el turno
      if (S.phase === 'roll') t.g.perform('ane', 'roll');
      else if (S.phase === 'choose') t.g.perform('ane', 'dest', S.dests[0]);
      else if (S.phase === 'question' && S.q.picked === null) t.g.perform('ane', 'answer', {q:S.q.id, i:S.q.options.findIndex(o => o !== S.q.answer)});
      else if (S.phase === 'question') t.g.perform('ane', 'cont', S.q.id);
    }
    t.g.tick();
    await wait(2);
  }
  assert.ok(t.S().qn > 0, 'se han hecho preguntas');
  t.g.stop();
});

test('las preguntas están bien formadas: 6 categorías, 4 opciones distintas y sin repetir enunciados', () => {
  assert.equal(QUESTIONS.length, 6);
  const seen = new Set();
  QUESTIONS.forEach((cat, k) => {
    assert.ok(cat.length >= 20, `categoría ${k}: al menos 20 preguntas`);
    cat.forEach(q => {
      assert.equal(q.length, 5, q[0]);
      assert.equal(new Set(q.slice(1).map(o => o.toLowerCase())).size, 4, `opciones repetidas: ${q[0]}`);
      assert.ok(!seen.has(q[0]), `pregunta repetida: ${q[0]}`);
      seen.add(q[0]);
    });
  });
});

// Prepara una partida en la que el equipo en turno ya tiene los 6 quesitos.
function toFinal() {
  const t = threePlayers();
  t.g.perform('ane', 'start');
  const S = t.S();
  S.teams[S.turn].wedges = [true, true, true, true, true, true];
  S.phase = 'final';
  return t;
}
function answerFinal(t, right) {
  const S = t.S(), q = S.q;
  const i = right ? q.options.indexOf(q.answer) : q.options.findIndex(o => o !== q.answer);
  t.g.perform(S.roller, 'answer', {q:q.id, i});
  t.g.perform(S.roller, 'cont', q.id);
}

test('ronda final: una pregunta de cada categoría y se gana con 4 aciertos', () => {
  const t = toFinal(), team = t.S().turn;
  t.g.perform(t.S().roller, 'final');
  const cats = [];
  for (const right of [true, false, true, true, true]) { cats.push(t.S().q.cat); answerFinal(t, right); }
  assert.equal(new Set(cats).size, 5, 'cada pregunta es de una categoría distinta');
  assert.equal(t.S().phase, 'won');
  assert.equal(t.S().winner, team);
});

test('ronda final: con 3 fallos pasa el turno y se repite la próxima vez', () => {
  const t = toFinal(), team = t.S().turn;
  t.g.perform(t.S().roller, 'final');
  for (const right of [false, true, false]) answerFinal(t, right);
  assert.equal(t.S().turn, team, 'con 2 fallos sigue jugando');
  answerFinal(t, false);
  assert.notEqual(t.S().turn, team, 'con 3 fallos pasa el turno');
  assert.equal(t.S().final, null);
  assert.equal(t.S().winner, null);
});
