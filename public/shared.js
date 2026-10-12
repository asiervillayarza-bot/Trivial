// Constantes y reglas que usan a la vez el servidor (src/) y el navegador (public/app.js).

export const CATS = [
  {name:'Geografía',            color:'#2f7de1', ink:'#ffffff'},
  {name:'Entretenimiento',      color:'#e84a9b', ink:'#ffffff'},
  {name:'Historia',             color:'#f5c518', ink:'#1d1a0a'},
  {name:'Arte y Literatura',    color:'#9a6233', ink:'#ffffff'},
  {name:'Ciencia y Naturaleza', color:'#2fb34a', ink:'#ffffff'},
  {name:'Deportes y Ocio',      color:'#f28c28', ink:'#1d1206'},
];

export const TEAM_COLORS = [
  {c:'#e5383b', ink:'#ffffff'},
  {c:'#8338ec', ink:'#ffffff'},
  {c:'#00c2d1', ink:'#0e2540'},
  {c:'#ffffff', ink:'#0e2540'},
  {c:'#1b1b1b', ink:'#ffffff'},
  {c:'#9aa5b1', ink:'#0e2540'},
];
export const DEFAULT_NAMES = ['Los Cerebritos','Las Enciclopedias','Los Sabelotodo','Las Lumbreras','Los Genios','Las Calculadoras'];

// Tablero: 6 sectores de 7 casillas = 42. Cada sector empieza con la casilla de quesito.
export const N = 42;
export const CELLS = [];
for (let s = 0; s < 6; s++) {
  CELLS.push({type:'hq', cat:s});
  [1, 'r', 2, 3, 'r', 4].forEach(p => CELLS.push(p === 'r' ? {type:'again'} : {type:'cat', cat:(s + p) % 6}));
}

export const CODE_RE = /^[A-Z0-9]{4,8}$/;
export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);

export const playerTeam = (S, pid) => { const p = S.players.find(p => p.pid === pid); return p ? p.team : null; };
export const teamPlayers = (S, k) => S.players.filter(p => p.team === k && p.online);
export const playerName = (S, pid) => { const p = S.players.find(p => p.pid === pid); return p ? p.name || 'Sin nombre' : ''; };

// ¿Puede este jugador hacer esta acción ahora? El servidor lo comprueba siempre; el navegador lo usa para pintar los botones.
export function allowed(S, pid, a) {
  if (['setup', 'start', 'addBot', 'clearBots'].includes(a)) return pid === S.hostPid && S.phase === 'setup';
  if (a === 'reset') return pid === S.hostPid && S.phase !== 'setup';
  if (a === 'team' || a === 'name') return S.phase === 'setup' || playerTeam(S, pid) === null;
  if (a === 'teamName') return S.phase === 'setup' && playerTeam(S, pid) !== null; // cualquiera del equipo puede renombrarlo
  const team = playerTeam(S, pid);
  if (a === 'chat') return S.phase !== 'setup' && team !== null;
  if (team === null || !S.teams[team]) return false;
  return team === S.turn && S.roller === pid; // solo tira y responde el jugador al que le toca
}
