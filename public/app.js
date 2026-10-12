// Quesitos · navegador. Pinta las pantallas y manda las acciones a la sala (servidor en Cloudflare).
// La partida la lleva el servidor (src/game.js): aquí solo se recibe su estado y se dibuja.
import {CATS, TEAM_COLORS, DEFAULT_NAMES, N, CELLS, allowed, cleanCode, cleanName, playerTeam, teamPlayers as tp, playerName as pn} from './shared.js';

const QR_URL = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Ángulos de cada casilla del anillo: las de quesito son casi el doble de anchas que las normales.
const HQ_WIDTH = 1.9;
const CELL_ANG = (() => {
  const w = CELLS.map(c => c.type === 'hq' ? HQ_WIDTH : 1), unit = 360 / w.reduce((a, b) => a + b);
  let a = -90 - w[0] * unit / 2;
  return w.map(x => { const a0 = a; a += x * unit; return {a0, a1:a, ac:(a0 + a) / 2}; });
})();

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rnd = n => Math.floor(Math.random() * n);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const polar = (r, deg) => { const a = deg * Math.PI / 180; return [500 + r * Math.cos(a), 500 + r * Math.sin(a)]; };
const f = n => n.toFixed(2);
const store = (kind, key, val) => { try { const s = window[kind]; if (val === undefined) return s.getItem(key); s.setItem(key, val); } catch {} return null; };

/* ---------- Estado y conexión con la sala ---------- */
const PARAMS = new URLSearchParams(location.search);
const NET = {
  room:cleanCode(PARAMS.get('sala')) || null,
  crear:PARAMS.get('crear') === '1', // esta pestaña ha pulsado «Crear partida»
  status:'off', // connecting | open | lost | missing | full
  ws:null, everConnected:false, fails:0, retry:null, ping:null,
  pid:null, name:'', chat:[], chatTeam:null, showQR:false,
};
let S = null; // copia del estado que manda el servidor (sin respuestas)
let timerId = null, rollAnimId = null, confirmReset = false;

const lobbyState = () => ({phase:'setup', players:[], setupCount:4, setupNames:DEFAULT_NAMES.slice(), timeLimit:30, teams:[], hostPid:null, turn:0});
const amHost = () => !!S && S.hostPid === NET.pid;
const canAct = a => !!S && allowed(S, NET.pid, a);
const myTeam = () => playerTeam(S, NET.pid);
const me = () => S.players.find(p => p.pid === NET.pid) || null;
const teamPlayers = k => tp(S, k);
const playerName = pid => pn(S, pid);
const newCode = () => Array.from({length:5}, () => CODE_CHARS[rnd(CODE_CHARS.length)]).join('');
const homeURL = () => location.pathname;
const joinURL = code => location.origin + location.pathname + '?sala=' + code;
const wsURL = code => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/sala/' + code;

function connect() {
  clearTimeout(NET.retry);
  if (NET.ws) { NET.ws.onclose = null; try { NET.ws.close(); } catch {} }
  if (NET.status !== 'open') NET.status = NET.everConnected ? 'lost' : 'connecting';
  const ws = NET.ws = new WebSocket(wsURL(NET.room));
  ws.onopen = () => ws.send(JSON.stringify({t:'hello', pid:NET.pid, name:NET.name, crear:NET.crear}));
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'state') {
      if (NET.crear) { NET.crear = false; history.replaceState(null, '', '?sala=' + NET.room); }
      NET.status = 'open'; NET.everConnected = true; NET.fails = 0;
      S = m.S;
      if (S.q && S.q.left != null) S.q.deadline = Date.now() + S.q.left;
      if (NET.chatTeam !== myTeam()) { NET.chat = []; NET.chatTeam = myTeam(); }
      render();
    } else if (m.t === 'chat') {
      NET.chat = m.msgs; NET.chatTeam = m.team;
      renderChat();
    } else if (m.t === 'error') {
      if (m.code === 'taken') { location.replace(joinURL(newCode()) + '&crear=1'); return; } // código ocupado: otro
      NET.status = m.code === 'full' ? 'full' : 'missing';
      render();
    }
  };
  ws.onclose = () => {
    if (NET.ws !== ws || NET.status === 'missing' || NET.status === 'full') return;
    NET.status = NET.everConnected ? 'lost' : 'connecting';
    render();
    NET.retry = setTimeout(connect, Math.min(1000 * 2 ** NET.fails++, 8000));
  };
}
function act(a, v = null) {
  if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify({t:'act', a, v}));
}
function connText() {
  return NET.status === 'missing' ? 'No hay ninguna partida con este código. Revísalo o pide a tu amigo que te pase el enlace.'
    : NET.status === 'full' ? 'Esta sala está llena.'
    : NET.status === 'lost' ? 'Se ha perdido la conexión. Reconectando…'
    : 'Conectando con la sala…';
}

/* ---------- Logo e iconos ---------- */
function logoSVG(cls = 'logo', label = '') {
  let s = `<svg class="${cls}" viewBox="0 0 100 100" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><circle cx="50" cy="50" r="47" fill="var(--bg)" stroke="var(--ink)" stroke-width="5"/>`;
  CATS.forEach((c, k) => { s += `<path d="${sector(50, 50, 42, -90 + k*60, -30 + k*60)}" fill="${c.color}"/>`; });
  return s + '</svg>';
}
const CAT_ICONS = [
  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  // Entretenimiento: palomitas
  '<path d="M5 9h14l-1.7 11.2a1 1 0 0 1-1 .8H7.7a1 1 0 0 1-1-.8Z"/><path d="M9.6 9l.6 12M14.4 9l-.6 12"/><path d="M5.5 9a2.6 2.6 0 0 1 2.6-3.6A3.2 3.2 0 0 1 12 3.3a3.2 3.2 0 0 1 3.9 2.1A2.6 2.6 0 0 1 18.5 9"/>',
  '<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6Z"/>',
  // Arte y Literatura: pincel
  '<path d="M20.5 3.5 12 12M10 10.5l3.5 3.5"/><path d="M10.6 14.4c-1.6-1.6-4.3-1-4.9 1.2-.4 1.6-1.2 3-2.7 3.9 2.6 1 6 .7 7.7-1 1.2-1.2 1.2-2.9-.1-4.1Z"/>',
  '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9"/>',
  '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10Zm0-4v4m9 3h-5M3 10h5m-1 10 2.5-5.5M17 20l-2.5-5.5"/>',
];
const catIcon = (k, color) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CAT_ICONS[k]}</svg>`;
const BOT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01"/></svg>';
// Dado pequeño para las casillas de «tira otra vez» (24×24, como los iconos).
const DIE_ICON = '<rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#fff" stroke="currentColor" stroke-width="2"/>' +
  '<circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.9" fill="currentColor" stroke="none"/>';
const dieIcon = () => `<svg viewBox="0 0 24 24" aria-hidden="true" style="color:var(--neutral-ink)">${DIE_ICON}</svg>`;
const initial = n => (String(n || '?').trim()[0] || '?').toUpperCase();

/* ---------- Tablero ---------- */
function arcPath(r1, r2, a0, a1) {
  const [x1,y1] = polar(r2,a0), [x2,y2] = polar(r2,a1), [x3,y3] = polar(r1,a1), [x4,y4] = polar(r1,a0);
  return `M${f(x1)} ${f(y1)}A${r2} ${r2} 0 0 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${r1} ${r1} 0 0 0 ${f(x4)} ${f(y4)}Z`;
}
function sector(cx, cy, r, a0, a1) {
  const p0 = [cx + r*Math.cos(a0*Math.PI/180), cy + r*Math.sin(a0*Math.PI/180)];
  const p1 = [cx + r*Math.cos(a1*Math.PI/180), cy + r*Math.sin(a1*Math.PI/180)];
  return `M${cx} ${cy}L${f(p0[0])} ${f(p0[1])}A${r} ${r} 0 0 1 ${f(p1[0])} ${f(p1[1])}Z`;
}
function buildBoard() {
  let html = '';
  CELLS.forEach((c, i) => {
    const {ac, a0, a1} = CELL_ANG[i];
    const hq = c.type === 'hq';
    const fill = c.type === 'again' ? 'var(--neutral)' : CATS[c.cat].color;
    const label = c.type === 'again' ? 'Tira otra vez' : (hq ? 'Quesito de ' : '') + CATS[c.cat].name;
    html += `<path class="cell" data-i="${i}" d="${arcPath(hq ? 342 : 372, hq ? 497 : 482, a0, a1)}" fill="${fill}"><title>${label}</title></path>`;
    // Dibujo de cada casilla: icono de la categoría, medallón en las de quesito y un dado en las de «tira otra vez».
    const [x, y] = polar(hq ? 420 : 427, ac);
    const icon = (size, color, body, sw = 2, extra = '') =>
      `<g transform="translate(${f(x - size / 2)} ${f(y - size / 2)}) scale(${f(size / 24)})" fill="none" stroke="${color}" stroke-width="${sw}" ` +
      `stroke-linecap="round" stroke-linejoin="round" pointer-events="none"${extra}>${body}</g>`;
    if (hq) {
      html += `<circle cx="${f(x)}" cy="${f(y)}" r="33" fill="#fff" pointer-events="none"/>` +
              `<circle cx="${f(x)}" cy="${f(y)}" r="33" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3" pointer-events="none"/>` +
              icon(40, CATS[c.cat].color, CAT_ICONS[c.cat], 2.4);
    } else if (c.type === 'again') {
      html += `<g transform="rotate(${f(ac + 90 - 12)} ${f(x)} ${f(y)})" style="color:var(--neutral-ink)" pointer-events="none">` + icon(36, 'currentColor', DIE_ICON) + `</g>`;
    } else {
      html += icon(32, CATS[c.cat].ink, CAT_ICONS[c.cat], 2, ' opacity=".9"');
    }
  });
  $('cells').innerHTML = html;
  $('cells').addEventListener('click', e => {
    const el = e.target.closest('.cell.dest'); if (el) act('dest', +el.dataset.i);
  });
  $('cells').addEventListener('keydown', e => {
    const el = e.target.closest('.cell.dest');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act('dest', +el.dataset.i); }
  });
}
function pieSVG(wedges, size, cls = '') {
  let s = `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" fill="var(--bg)" stroke="var(--ink)" stroke-width="3"/>`;
  CATS.forEach((c, k) => {
    const a0 = -90 + k*60, a1 = a0 + 60;
    s += `<path d="${sector(50, 50, 43, a0, a1)}" fill="${wedges[k] ? c.color : 'transparent'}" stroke="var(--line)" stroke-width="1.5"/>`;
  });
  return s + '</svg>';
}

/* ---------- Render ---------- */
const inLobby = () => S.phase === 'setup' || !NET.everConnected;
function render() {
  if (!S) return;
  const lobby = inLobby();
  $('lobby').hidden = !lobby; $('app').hidden = lobby;
  if (lobby) {
    closeModal(); modalKey = '';
    $('roompanel').innerHTML = '';
    return renderLobby();
  }
  $('lobby').innerHTML = '';
  // destinos
  const pick = S.phase === 'choose' && canAct('dest');
  document.querySelectorAll('.cell').forEach(el => {
    const d = pick && S.dests.includes(+el.dataset.i);
    el.classList.toggle('dest', d);
    if (d) { el.setAttribute('tabindex','0'); el.setAttribute('role','button'); }
    else { el.removeAttribute('tabindex'); el.removeAttribute('role'); }
  });
  // fichas
  let ph = '', top = '';
  const byCell = {};
  S.teams.forEach((t, k) => (byCell[t.pos] = byCell[t.pos] || []).push(k));
  Object.entries(byCell).forEach(([cell, ks]) => {
    const ac = CELL_ANG[cell].ac, m = ks.length, hq = CELLS[cell].type === 'hq';
    ks.forEach((k, j) => {
      // Varias fichas en la misma casilla: de dos en dos (tres en las de quesito, que son más anchas)
      const per = hq ? 3 : 2, row = Math.floor(j / per), rows = Math.ceil(m / per);
      const inRow = Math.min(per, m - row * per), col = (j % per) - (inRow - 1) / 2;
      const rr = 425 + (row - (rows - 1) / 2) * 44;
      const [bx, by] = polar(rr, ac);
      const ta = (ac + 90) * Math.PI / 180;
      const x = bx + Math.cos(ta) * col * 40, y = by + Math.sin(ta) * col * 40;
      const t = S.teams[k], cur = k === S.turn && S.phase !== 'setup';
      const g = `<g class="piece${cur ? ' cur' : ''}" style="transform:translate(${f(x)}px,${f(y)}px)">` +
        (cur ? `<circle r="29" fill="none" stroke="#FFC93C" stroke-width="6"/>` : '') +
        `<circle r="23" fill="#0C1A2E" cy="2"/>` +
        `<circle r="19" fill="${t.color}" stroke="#fff" stroke-width="3.5"/>` +
        `<text text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="${t.ink}">${k+1}</text></g>`;
      if (cur) top = g; else ph += g; // la ficha del equipo en turno, siempre por encima
    });
  });
  $('pieces').innerHTML = ph + top;
  renderHub();
  renderSide();
  renderRoom();
  renderModal();
  renderChat();
}

function dieHTML(n, rolling) {
  const faces = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  const on = faces[n] || [];
  let s = '';
  for (let i = 0; i < 9; i++) s += `<i class="${on.includes(i) ? 'on' : ''}"></i>`;
  return `<div class="die${rolling ? ' rolling' : ''}" id="die" role="img" aria-label="${n ? 'Dado: ' + n : 'Dado'}">${s}</div>`;
}
function animateDie() {
  clearInterval(rollAnimId);
  if (S.phase !== 'rolling' || reduced) return;
  rollAnimId = setInterval(() => {
    const d = $('die');
    if (d && S.phase === 'rolling') d.outerHTML = dieHTML(1 + rnd(6), true); else clearInterval(rollAnimId);
  }, 70);
}
const teamColor = t => t.color === '#1b1b1b' ? 'var(--ink)' : t.color;

function renderHub() {
  const hub = $('hub');
  if (S.phase === 'won') {
    const t = S.teams[S.winner];
    hub.innerHTML = `<div class="label">Ganador</div>${pieSVG(t.wedges, 90, 'bigpie')}<div class="who">${esc(t.name)}</div>` +
      (amHost() ? `<button class="btn primary" id="hubNew">Nueva partida</button>` : '');
    if ($('hubNew')) $('hubNew').onclick = () => act('reset');
    return;
  }
  const t = S.teams[S.turn], mine = myTeam() === S.turn, isRoller = S.roller === NET.pid;
  const roller = S.roller ? playerName(S.roller) : '';
  let action = '', msg = S.msg;
  if (S.phase === 'roll') {
    if (canAct('roll')) action = `<button class="btn primary" id="rollBtn">Tirar dado</button>`;
    else msg = roller ? `Esperando a que tire ${roller}.` : `${t.name} no tiene a nadie conectado.`;
  }
  if (S.phase === 'choose' && !isRoller) msg = `${roller || t.name} está eligiendo casilla.`;
  if (S.phase === 'final') {
    if (canAct('final')) action = `<button class="btn primary" id="finalBtn">Ronda final</button>`;
  }
  hub.innerHTML =
    `<div class="label">${isRoller ? '¡Te toca!' : mine ? 'Le toca a tu equipo' : 'Turno de'}</div>` +
    `<div class="who" style="color:${teamColor(t)}">${esc(t.name)}</div>` +
    (roller ? `<div class="roller">Tira ${isRoller ? 'tú' : esc(roller)}</div>` : '') +
    `<div class="row">${pieSVG(t.wedges, 90, 'bigpie')}${dieHTML(S.die, S.phase === 'rolling')}</div>` +
    action + `<div class="msg">${esc(msg)}</div>`;
  if ($('rollBtn')) $('rollBtn').onclick = () => act('roll');
  if ($('finalBtn')) $('finalBtn').onclick = () => act('final');
  animateDie();
}

function membersHTML(k) {
  const ps = S.players.filter(p => p.team === k);
  if (!ps.length) return '';
  return `<div class="members">` + ps.map(p =>
    `<span class="chip${p.pid === NET.pid ? ' me' : ''}${p.online ? '' : ' off'}${S.phase !== 'setup' && p.pid === S.roller ? ' turn' : ''}">` +
    `${p.pid === S.hostPid ? '<i title="Dirige la partida">★</i>' : ''}${p.bot ? BOT_ICON : ''}${esc(p.name || 'Sin nombre')}${p.pid === NET.pid ? ' (tú)' : ''}` +
    `${S.phase !== 'setup' && p.pid === S.roller ? ' · tira' : ''}</span>`).join('') + `</div>`;
}
function avatarsHTML(k) {
  const ps = S.players.filter(p => p.team === k);
  return `<div class="members">` + ps.map(p =>
    `<span class="avatar${p.online ? '' : ' off'}"><b>${p.bot ? BOT_ICON : esc(initial(p.name))}</b>` +
    `<span>${p.pid === S.hostPid ? '★ ' : ''}${esc(p.name || 'Sin nombre')}${p.pid === NET.pid ? ' (tú)' : ''}</span></span>`).join('') + `</div>`;
}

// Redibuja un panel sin perder el foco, el cursor ni lo que se está escribiendo en un campo de texto.
function setPanel(el, cls, html) {
  const a = document.activeElement, id = a && el.contains(a) && a.id;
  const typing = id && a.tagName === 'INPUT' ? {value:a.value, sel:[a.selectionStart, a.selectionEnd]} : null;
  el.className = cls; el.innerHTML = html;
  const b = id && $(id);
  if (b) {
    if (typing && !b.readOnly) b.value = typing.value;
    b.focus({preventScroll:true});
    if (typing) try { b.setSelectionRange(typing.sel[0], typing.sel[1]); } catch {}
  }
}

function renderSide() {
  const p = $('sidepanel'), mine = myTeam();
  const rows = S.teams.map((t, k) =>
    `<li class="team${k === S.turn && S.phase !== 'won' ? ' current' : ''}${k === mine ? ' mine' : ''}" style="--tc:${t.color}">` +
    `<span class="bar"></span><span class="name" title="${esc(t.name)}">${esc(t.name)}</span>` +
    `<span class="count" aria-label="${t.wedges.filter(Boolean).length} de 6 quesitos">${t.wedges.filter(Boolean).length}<small>/6</small></span>${membersHTML(k)}` +
    (mine === null ? `<button class="btn ghost small jointeam" data-k="${k}">Unirme</button>` : '') + `</li>`).join('');
  setPanel(p, 'panel', `<ul class="teams">${rows}</ul>` +
    (mine === null ? `<p class="hint">Todavía no estás en ningún equipo: únete a uno para jugar.</p>` : '') +
    (!amHost() ? '' : confirmReset
      ? `<div class="confirm"><p>¿Seguro? Se terminará la partida para todos y volveréis a la sala.</p><button class="btn small" id="yesReset">Sí, volver a la sala</button><button class="btn ghost small" id="noReset">Seguir jugando</button></div>`
      : `<button class="btn ghost small" id="resetBtn" style="align-self:flex-start">Nueva partida</button>`));
  p.querySelectorAll('.jointeam').forEach(b => b.onclick = () => act('team', +b.dataset.k));
  if ($('resetBtn')) $('resetBtn').onclick = () => { if (S.phase === 'won') act('reset'); else { confirmReset = true; renderSide(); } };
  if ($('yesReset')) $('yesReset').onclick = () => { confirmReset = false; act('reset'); };
  if ($('noReset')) $('noReset').onclick = () => { confirmReset = false; renderSide(); };
}

// Estado de la sala durante la partida: enlace para invitar a más gente y conexión.
function renderRoom() {
  const p = $('roompanel');
  const ok = NET.status === 'open';
  const st = ok ? 'Conectado' : connText();
  const online = S.players.filter(p => p.online && !p.bot).length;
  const ss = $('sidestatus');
  ss.className = 'status' + (ok ? ' ok' : ''); ss.innerHTML = `<b></b>Sala ${esc(NET.room || '')}${ok ? '' : ' · ' + esc(st)}`;
  setPanel(p, 'panel room',
    `<h2>Invitar</h2>` +
    `<div class="linkrow"><input id="roomLink" readonly value="${esc(joinURL(NET.room))}" aria-label="Enlace de la sala"><button class="btn ghost small" id="copyLink">Copiar</button></div>` +
    `<p class="hint">${online === 1 ? '1 persona conectada' : online + ' personas conectadas'} · <button class="link linkbtn" id="leaveBtn">Salir de la partida</button></p>`);
  bindRoomButtons();
}
function bindRoomButtons() {
  if ($('copyLink')) $('copyLink').onclick = () => {
    const url = joinURL(NET.room), inp = $('roomLink');
    if (inp) inp.select();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).catch(() => inp && document.execCommand('copy'));
    $('copyLink').textContent = '¡Copiado!';
  };
  if ($('leaveBtn')) $('leaveBtn').onclick = leaveGame;
  if ($('toggleQR')) $('toggleQR').onclick = () => { NET.showQR = !NET.showQR; renderLobby(); };
}
function leaveGame() {
  if (S && S.phase !== 'setup' && !confirm('¿Salir de la partida? Tu equipo seguirá jugando sin ti.')) return;
  location.href = homeURL();
}

/* ---------- Sala de espera: nombre, equipos y ajustes ---------- */
function renderLobby() {
  const el = $('lobby');
  const connected = NET.status === 'open' || (NET.everConnected && NET.status === 'lost');
  const host = S.players.find(p => p.pid === S.hostPid);
  const hostName = host && host.name ? host.name : 'quien creó la sala';
  const meP = connected ? me() : null;
  const mine = myTeam();
  const myName = meP && meP.name ? meP.name : NET.name;
  const online = S.players.filter(p => p.online && !p.bot).length;
  const filled = new Set(S.players.filter(p => p.team !== null && p.online).map(p => p.team)).size;
  const boss = amHost();

  // Cabecera: título, código y salir
  const sub = NET.status !== 'open' ? esc(connText())
    : boss ? 'Pasa el código a tus amigos y elegid equipo'
    : `Esperando a que ${esc(hostName)} empiece la partida`;
  const head =
    `<header class="lobhead">` +
      `<div class="lobtitle">${logoSVG()}<div><strong>Sala de espera</strong><span>${sub}</span></div></div>` +
      (NET.status !== 'missing' ? `<div class="codechip"><span>Código</span><span class="code" aria-label="Código de la sala">${esc(NET.room)}</span>` +
        `<button class="btn small" id="copyLink">Copiar enlace</button></div>` : '') +
      `<button class="btn ghost small" id="leaveBtn">Salir</button>` +
    `</header>`;

  // Equipos
  let teams = '';
  if (connected) for (let k = 0; k < S.setupCount; k++) {
    const tc = TEAM_COLORS[k], name = (S.setupNames[k] || '').trim() || `Equipo ${k+1}`;
    const ps = S.players.filter(p => p.team === k);
    teams += `<button class="tcard${k === mine ? ' mine' : ''}${ps.length ? '' : ' empty-team'}" data-k="${k}" style="--tc:${tc.c};--tink:${tc.ink}" aria-pressed="${k === mine}">` +
      `<span class="tchead"><span class="tname">${esc(name)}</span><span class="join">${k === mine ? 'Tu equipo' : 'Unirme'}</span></span>` +
      `<span class="tbody">${ps.length ? avatarsHTML(k) : '<span class="empty">Nadie todavía · no jugará si sigue vacío</span>'}</span></button>`;
  }
  const loose = S.players.filter(p => p.team === null);
  const teamsSec =
    `<section class="lob-teams">` +
      `<div class="head"><h2>Elige equipo</h2>${connected ? `<span class="hint">${online === 1 ? '1 persona en la sala' : online + ' personas en la sala'}</span>` : ''}</div>` +
      (connected ? `<div class="tcards">${teams}</div>`
        : `<div class="lobwait"><strong>${NET.status === 'missing' ? 'Sala no encontrada' : 'Conectando…'}</strong><span class="hint">${esc(connText())}</span>` +
          (NET.status === 'missing' ? `<a class="btn small" href="${esc(homeURL())}" style="align-self:flex-start;text-decoration:none">Volver al inicio</a>` : '') + `</div>`) +
      (loose.length ? `<div class="field"><span class="eyebrow">Sin equipo todavía</span><div class="members">` +
        loose.map(p => `<span class="chip${p.pid === NET.pid ? ' me' : ''}">${esc(p.name || 'Sin nombre')}${p.pid === NET.pid ? ' (tú)' : ''}</span>`).join('') + `</div></div>` : '') +
    `</section>`;

  // Invitar (enlace y QR)
  const invite = connected
    ? `<section class="invite lob-invite"><div class="txt"><strong>Invita a más gente</strong>` +
        `<div class="linkrow"><input id="roomLink" readonly value="${esc(joinURL(NET.room))}" aria-label="Enlace de la sala"></div></div>` +
        `<button class="btn ghost small" id="toggleQR">${NET.showQR ? 'Ocultar QR' : 'QR para el móvil'}</button>` +
        (NET.showQR ? `<div class="qr" id="qr"></div>` : '') + `</section>` : '';

  // Tú
  const meSec = `<section class="panel lob-me"><label class="eyebrow" for="myName">Tu nombre</label>` +
    `<div class="names"><div class="tline"><input id="myName" maxlength="24" placeholder="Escribe tu nombre" value="${esc(myName)}" autocomplete="nickname"${connected ? '' : ' disabled'}></div></div>` +
    `<p class="hint" id="nameHint">${!myName ? 'Escribe tu nombre para poder elegir equipo.' : mine === null ? 'Ahora elige tu equipo.' : 'Puedes cambiarte de equipo hasta que empiece la partida.'}</p>` +
    (mine !== null && connected ? `<label class="eyebrow" for="myTeamName" style="margin-top:6px">Nombre de tu equipo</label>` +
      `<div class="names"><div class="tline"><span class="dot" style="background:${TEAM_COLORS[mine].c};color:${TEAM_COLORS[mine].ink}">${mine + 1}</span>` +
      `<input id="myTeamName" maxlength="24" placeholder="Equipo ${mine + 1}" value="${esc(S.setupNames[mine] || '')}" autocomplete="off"></div></div>` +
      `<p class="hint">Cualquiera del equipo puede cambiarlo.</p>` : '') +
    `</section>`;

  // Ajustes (solo quien dirige la partida)
  let settings = '';
  if (boss) {
    let names = '';
    for (let k = 0; k < S.setupCount; k++) {
      const tc = TEAM_COLORS[k];
      names += `<div class="tline"><span class="dot" style="background:${tc.c};color:${tc.ink}">${k+1}</span>` +
               `<input id="name${k}" maxlength="24" aria-label="Nombre del equipo ${k+1}" value="${esc(S.setupNames[k])}"></div>`;
    }
    settings = `<section class="panel setup lob-settings"><h2>Ajustes</h2>` +
      `<div class="field"><label>Equipos</label><div class="seg" id="countSeg">` +
        [2,3,4,5,6].map(n => `<button aria-pressed="${n === S.setupCount}" data-n="${n}">${n}</button>`).join('') + `</div></div>` +
      `<div class="field"><label>Nombres de los equipos</label><div class="names">${names}</div></div>` +
      `<div class="field"><label>Tiempo para responder</label><div class="seg" id="timeSeg">` +
        [[0,'Libre'],[20,'20 s'],[30,'30 s'],[45,'45 s']].map(([v,l]) => `<button aria-pressed="${v === S.timeLimit}" data-v="${v}">${l}</button>`).join('') + `</div></div>` +
      `<div class="field"><label>Bots para practicar</label><div class="seg" id="botSeg">` +
        Array.from({length:S.setupCount}, (_, k) => `<button data-k="${k}" title="Añadir un bot al equipo ${k+1}"><span class="dot mini" style="background:${TEAM_COLORS[k].c}"></span>+ Bot</button>`).join('') + `</div>` +
        (S.players.some(p => p.bot) ? `<button class="link linkbtn" id="clearBots">Quitar todos los bots</button>` : `<p class="hint">Juegan solos cuando les toca.</p>`) +
      `</div></section>`;
  }
  const startArea = !connected ? ''
    : boss ? `<div class="startarea"><button class="btn primary big" id="startBtn"${filled >= 2 ? '' : ' disabled'}>Empezar partida</button>` +
      `<p class="hint">${filled >= 2 ? `${filled} equipos listos${filled < S.setupCount ? ' · los vacíos no jugarán' : ''}` : 'Hacen falta al menos 2 equipos con jugadores.'}</p></div>`
    : `<div class="startarea"><div class="lobwait"><strong>${mine === null ? 'Elige un equipo' : '¡Listo!'}</strong>` +
      `<span class="hint">Esperando a que ${esc(hostName)} empiece la partida · ${S.timeLimit ? S.timeLimit + ' s para responder' : 'sin límite de tiempo'}.</span></div></div>`;

  const qrOld = $('qr') && $('qr').dataset.room === NET.room ? $('qr').innerHTML : '';
  setPanel(el, 'lobbyscr', head +
    `<div class="lobgrid">` +
      `<div class="lobcol">${teamsSec}${invite}</div>` +
      `<div class="lobcol">${meSec}${settings}${startArea}</div>` +
    `</div>`);

  if ($('qr')) drawQR($('qr'), qrOld);
  bindRoomButtons();
  const inp = $('myName');
  let deb;
  inp.addEventListener('input', () => {
    NET.name = cleanName(inp.value);
    store('localStorage', 'quesitos-name', NET.name);
    inp.classList.remove('need');
    $('nameHint').textContent = NET.name ? 'Ahora elige tu equipo.' : 'Escribe tu nombre para poder elegir equipo.';
    clearTimeout(deb); deb = setTimeout(() => act('name', NET.name), 300);
  });
  if ($('myTeamName')) {
    let tdeb;
    $('myTeamName').addEventListener('input', e => {
      const v = e.target.value, card = el.querySelector(`.tcard[data-k="${mine}"] .tname`);
      if (card) card.textContent = v.trim() || `Equipo ${mine + 1}`;
      clearTimeout(tdeb); tdeb = setTimeout(() => act('teamName', {name:v}), 300);
    });
  }
  el.querySelectorAll('.tcard').forEach(b => b.onclick = () => {
    if (!NET.name) { inp.focus(); inp.classList.add('need'); return; }
    if (!meP || meP.name !== NET.name) act('name', NET.name);
    act('team', +b.dataset.k);
  });
  if (!boss) return;
  let nameDeb;
  el.querySelectorAll('.names input[id^="name"]').forEach(i => i.addEventListener('input', () => {
    const k = +i.id.slice(4);
    const card = el.querySelector(`.tcard[data-k="${k}"] .tname`);
    if (card) card.textContent = i.value.trim() || `Equipo ${k + 1}`;
    clearTimeout(nameDeb);
    nameDeb = setTimeout(() => act('setup', {names:Array.from({length:6}, (_, j) => $('name' + j) ? $('name' + j).value : S.setupNames[j])}), 300);
  }));
  $('countSeg').onclick = e => { const b = e.target.closest('button'); if (b) act('setup', {count:+b.dataset.n}); };
  $('timeSeg').onclick = e => { const b = e.target.closest('button'); if (b) act('setup', {time:+b.dataset.v}); };
  $('startBtn').onclick = () => act('start');
  $('botSeg').onclick = e => { const b = e.target.closest('button'); if (b) act('addBot', +b.dataset.k); };
  if ($('clearBots')) $('clearBots').onclick = () => act('clearBots');
}

const scripts = {};
function loadScript(src) {
  return scripts[src] || (scripts[src] = new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok;
    s.onerror = () => { delete scripts[src]; s.remove(); ko(new Error('No se pudo cargar ' + src)); };
    document.head.appendChild(s);
  }));
}
async function drawQR(el, cached) {
  el.dataset.room = NET.room;
  if (cached) { el.innerHTML = cached; return; }
  try {
    await loadScript(QR_URL);
    const qr = qrcode(0, 'M'); qr.addData(joinURL(NET.room)); qr.make();
    if (el.dataset.room === NET.room) el.innerHTML = qr.createSvgTag({cellSize:4, margin:2, scalable:true, title:'Código QR para unirse a la sala'});
  } catch { el.hidden = true; }
}

/* ---------- Chat de equipo ---------- */
const myChat = () => NET.chatTeam === myTeam() ? NET.chat : [];
// Propuestas de los compañeros para la pregunta actual (la última de cada uno).
function currentVotes() {
  const votes = new Map();
  if (S.q) myChat().forEach(m => { if (m.kind === 'vote' && m.q === S.q.id) votes.set(m.pid, m); });
  return [...votes.values()];
}
function chatBox(el, compact) {
  if (!el.querySelector('.chatlog')) {
    const t = S.teams[myTeam()];
    el.innerHTML = `<h2>Chat de ${t ? esc(t.name) : 'tu equipo'}</h2><div class="chatlog${compact ? ' compact' : ''}" aria-live="polite"></div>` +
      `<form class="chatform"><input maxlength="200" placeholder="Escribe a tu equipo…" aria-label="Mensaje para tu equipo" autocomplete="off"><button class="btn small">Enviar</button></form>`;
    el.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const inp = e.target.querySelector('input'), text = inp.value.trim();
      if (text) { act('chat', {text}); inp.value = ''; }
    };
  }
  const log = el.querySelector('.chatlog'), msgs = myChat();
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  log.innerHTML = msgs.length ? msgs.map(m => m.kind === 'vote'
    ? `<div class="msgv"><b>${esc(m.pid === NET.pid ? 'Tú' : m.name || 'Sin nombre')}</b> ${m.pid === NET.pid ? 'propones' : 'propone'} «${esc(m.text)}»</div>`
    : `<div class="msgb${m.pid === NET.pid ? ' own' : ''}"><b>${esc(m.name || 'Sin nombre')}</b>${esc(m.text)}</div>`).join('')
    : `<p class="empty">Aquí podéis poneros de acuerdo. Solo lo ve tu equipo.</p>`;
  if (atBottom || log.dataset.n !== String(msgs.length)) log.scrollTop = log.scrollHeight;
  log.dataset.n = msgs.length;
}
function renderChat() {
  if (!S || inLobby()) return;
  const side = $('chatpanel'), show = S.phase !== 'setup' && myTeam() !== null;
  side.hidden = !show;
  if (show) chatBox(side, false); else side.innerHTML = '';
  if ($('qchat')) chatBox($('qchat'), true);
  // Etiquetas de propuestas en las opciones de la pregunta
  if ($('opts') && S.q) {
    const votes = currentVotes();
    $('opts').querySelectorAll('.opt').forEach((b, i) => {
      const vs = votes.filter(v => v.i === i);
      b.classList.toggle('voted', vs.some(v => v.pid === NET.pid));
      let tag = b.querySelector('.votes');
      if (!vs.length) { if (tag) tag.remove(); return; }
      if (!tag) { tag = document.createElement('span'); tag.className = 'votes'; b.appendChild(tag); }
      tag.setAttribute('aria-label', 'Lo proponen: ' + vs.map(v => v.pid === NET.pid ? 'tú' : v.name).join(', '));
      tag.innerHTML = vs.map(v => `<span class="${v.pid === NET.pid ? 'mine' : ''}">${esc(v.pid === NET.pid ? 'Tú' : v.name)}</span>`).join('');
    });
  }
}

/* ---------- Ventanas (se dibujan a partir del estado) ---------- */
let modalKey = '', winClosed = false;
function openModal(html, narrow) { $('qcard').innerHTML = html; $('qcard').classList.toggle('narrow', !!narrow); $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; clearInterval(timerId); }
function renderModal() {
  if (S.phase !== 'won') winClosed = false;
  let key = '';
  if (S.phase === 'question' && S.q) key = `q${S.q.id}:${S.q.picked}:${canAct('answer')}:${myTeam()}`;
  else if (S.phase === 'won' && !winClosed) key = 'won';
  if (key === modalKey) return;
  modalKey = key;
  if (!key) closeModal();
  else if (key[0] === 'q') drawQuestion();
  else drawWin();
}

function drawQuestion() {
  const q = S.q, cat = CATS[q.cat], t = S.teams[S.turn], mine = canAct('answer');
  const tag = q.kind === 'wedge' ? 'Pregunta de quesito' : q.kind === 'final' && S.final ? `Ronda final · ${S.final.idx + 1} de 6` : '';
  const teammate = !mine && myTeam() === S.turn && q.picked === null; // compañero: puede proponer
  const opts = q.options.map((o, i) => `<button class="opt" data-i="${i}"${mine || teammate ? '' : ' disabled'}><kbd>${'ABCD'[i]}</kbd><span>${esc(o)}</span></button>`).join('');
  const withChat = myTeam() === S.turn && teamPlayers(S.turn).length > 1;
  const who = teammate ? `Responde <b>${esc(playerName(S.roller))}</b> · pulsa una opción para proponérsela`
    : S.roller === NET.pid ? (withChat ? '<b>Respondes tú</b> · mira lo que te propone tu equipo' : '<b>Respondes tú</b>')
    : S.roller ? `Responde <b>${esc(playerName(S.roller))}</b> (${esc(t.name)})` : `Responde <b>${esc(t.name)}</b>`;
  openModal(
    `<div class="qhead" style="background:${cat.color};color:${cat.ink}">${catIcon(q.cat, cat.ink)}<span class="cat" id="qtitle">${cat.name}</span>` +
      `${tag ? `<span class="tag">${tag}</span>` : ''}${S.timeLimit && q.picked === null ? `<span class="tnum" id="tnum" style="color:${cat.color}" aria-label="Segundos restantes"></span>` : ''}</div>` +
    (S.timeLimit ? `<div class="timer"><i id="tbar"></i></div>` : '') +
    `<div class="qbody${withChat ? ' with-chat' : ''}"><div class="qmain">${q.kind === 'final' ? finalTrack() : ''}<p class="qteam">${who}</p><h2 class="qtext">${esc(q.text)}</h2>` +
    `<div class="opts" id="opts">${opts}</div></div>` +
    (withChat ? `<section class="qchat chat" id="qchat"></section>` : '') +
    `<div class="qfoot"><p class="verdict" id="verdict"></p><button class="btn primary" id="contBtn" hidden>Continuar</button></div></div>`,
    !withChat
  );
  $('opts').onclick = e => {
    const b = e.target.closest('.opt'); if (!b || b.disabled) return;
    if (canAct('answer')) act('answer', {q:q.id, i:+b.dataset.i});
    else act('chat', {vote:+b.dataset.i, q:q.id});
  };
  $('contBtn').onclick = () => act('cont', q.id);
  clearInterval(timerId);
  renderChat();
  if (q.picked !== null) return showVerdict();
  if (mine) $('opts').querySelector('.opt').focus({preventScroll:true});
  if (S.timeLimit) {
    const tick = () => {
      if (!S.q || !S.q.deadline) return;
      const left = Math.max(0, S.q.deadline - Date.now()), frac = left / (S.timeLimit * 1000);
      const bar = $('tbar');
      if (bar) { bar.style.transform = `scaleX(${frac})`; bar.classList.toggle('low', frac < .25); }
      if ($('tnum')) $('tnum').textContent = Math.ceil(left / 1000);
    };
    tick();
    timerId = setInterval(tick, 100);
  }
}
function showVerdict() {
  const q = S.q, t = S.teams[S.turn];
  $('opts').querySelectorAll('.opt').forEach((b, k) => {
    b.disabled = true;
    if (q.options[k] === q.answer) b.classList.add('right');
    else if (k === q.picked) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  const v = $('verdict');
  let text, btn;
  if (q.kind === 'final' && S.final) {
    const F = S.final, out = F.ko > 2, nextName = S.teams[(S.turn + 1) % S.teams.length].name;
    v.className = 'verdict ' + (q.ok ? 'ok' : 'bad');
    text = S.winner !== null ? `¡Correcto! ${F.ok} de 6: ¡habéis ganado!`
      : q.ok ? `¡Correcto! Lleváis ${F.ok} de 4.`
      : out ? `${q.picked === -1 ? 'Se acabó el tiempo' : 'Incorrecto'}. Ya no podéis llegar a 4.`
      : `${q.picked === -1 ? 'Se acabó el tiempo' : 'Incorrecto'}. Lleváis ${F.ok} de 4 y ${F.ko} ${F.ko === 1 ? 'fallo' : 'fallos'}.`;
    btn = S.winner !== null ? 'Ver resultado' : out ? `Turno de ${nextName}` : 'Siguiente pregunta';
  } else if (q.ok) {
    v.className = 'verdict ok';
    text = q.kind === 'wedge' ? '¡Correcto! Quesito conseguido.' : '¡Correcto!';
    btn = 'Volver a tirar';
  } else {
    v.className = 'verdict bad';
    text = q.picked === -1 ? 'Se acabó el tiempo.' : 'Incorrecto.';
    btn = `Turno de ${S.teams[(S.turn + 1) % S.teams.length].name}`;
  }
  v.textContent = text;
  const c = $('contBtn');
  if (canAct('cont')) { c.textContent = btn; c.hidden = false; c.focus({preventScroll:true}); }
  else v.insertAdjacentHTML('beforeend', `<span class="wait">Esperando a ${esc(S.roller ? playerName(S.roller) : t.name)}…</span>`);
}
// Marcador de la ronda final: una casilla por categoría con su resultado.
function finalTrack() {
  const F = S.final;
  return `<div class="ftrack" aria-label="Ronda final: ${F.ok} aciertos y ${F.ko} fallos">` + F.cats.map((k, n) => {
    const res = n < F.idx ? (F.res && F.res[n]) : null;
    const st = n < F.idx ? (res ? 'ok' : 'ko') : n === F.idx ? 'now' : '';
    return `<span class="${st}" style="--c:${CATS[k].color};--i:${CATS[k].ink}" title="${CATS[k].name}">${catIcon(k, n === F.idx || n > F.idx ? CATS[k].ink : '#fff')}</span>`;
  }).join('') + `<b>${F.ok}/4</b></div>`;
}
function drawWin() {
  const t = S.teams[S.winner];
  openModal(
    `<div class="qhead" style="background:${t.color};color:${t.ink}"><span class="cat" id="qtitle">Fin de la partida</span></div>` +
    `<div class="qbody" style="align-items:center;text-align:center">${pieSVG(t.wedges, 140)}<p class="win">¡${esc(t.name)} gana!</p>` +
    `<div class="qfoot" style="justify-content:center">${amHost() ? `<button class="btn primary" id="againBtn">Nueva partida</button>` : ''}<button class="btn ghost" id="closeWin">Ver tablero</button></div></div>`, true
  );
  if ($('againBtn')) { $('againBtn').onclick = () => act('reset'); $('againBtn').focus({preventScroll:true}); }
  $('closeWin').onclick = () => { winClosed = true; renderModal(); };
}

document.addEventListener('keydown', e => {
  if (!S || inLobby() || e.target.matches('input')) return;
  const k = /^[1-4]$/.test(e.key) ? +e.key - 1 : 'abcd'.indexOf(e.key.toLowerCase());
  if (S.phase === 'question' && S.q && S.q.picked === null && e.key.length === 1 && k >= 0 && canAct('answer')) act('answer', {q:S.q.id, i:k});
  else if (S.phase === 'roll' && $('modal').hidden && (e.key === ' ' || e.key === 'Enter') && !e.target.closest('button,.cell')) { e.preventDefault(); act('roll'); }
});

/* ---------- Pantalla de inicio: crear partida o unirse con un código ---------- */
function showHome() {
  $('app').hidden = true; $('lobby').hidden = true; $('modal').hidden = true;
  const home = $('home');
  home.hidden = false;
  const ring = Array.from({length:12}, (_, k) => `<path d="${arcPath(380, 478, -90 + k*30 + 1, -60 + k*30 - 1)}" fill="${CATS[k % 6].color}"/>`).join('');
  home.innerHTML =
    `<svg class="home-ring" viewBox="0 0 1000 1000" aria-hidden="true"><circle cx="500" cy="500" r="497" fill="none" stroke="#F4F7FB" stroke-width="4"/>${ring}</svg>` +
    `<div class="home-in">` +
      `<div class="hero">${logoSVG('home-logo', 'Quesito completo')}` +
        `<h1>Quesitos</h1>` +
        `<p class="tagline">El trivial para jugar con tus amigos: seis categorías, seis quesitos, cada uno desde su pantalla.</p>` +
        `<div class="pills"><span>2–6 equipos</span><span>Chat de equipo</span><span>Bots para practicar</span></div></div>` +
      `<div class="choices">` +
        `<div class="choice"><h2>Crear partida</h2><p>Abre una sala y pasa el código a tus amigos. Tú también juegas.</p>` +
          `<button class="btn primary" id="createBtn">Crear partida</button></div>` +
        `<form class="choice" id="joinHome" novalidate><h2>Unirme</h2><label for="homeCode" class="hint" style="font-size:17px">Código de la sala</label>` +
          `<div class="joinrow"><input id="homeCode" maxlength="8" placeholder="ABC12" autocapitalize="characters" autocomplete="off" spellcheck="false">` +
          `<button class="btn ghost">Entrar</button></div>` +
          `<p class="err" id="homeErr" aria-live="polite"></p></form>` +
      `</div>` +
    `</div>`;
  $('createBtn').onclick = () => { location.href = joinURL(newCode()) + '&crear=1'; };
  $('homeCode').addEventListener('input', () => { $('homeCode').classList.remove('need'); $('homeErr').textContent = ''; });
  $('joinHome').onsubmit = e => {
    e.preventDefault();
    const code = cleanCode($('homeCode').value);
    if (code.length < 4) {
      $('homeCode').classList.add('need');
      $('homeErr').textContent = code ? 'El código tiene 5 letras o números.' : 'Escribe el código de la partida.';
      return $('homeCode').focus();
    }
    location.href = joinURL(code);
  };
}
function buildLegend() {
  $('legend').innerHTML = CATS.map((c, k) => `<div><b style="background:${c.color}">${catIcon(k, c.ink)}</b>${c.name}</div>`).join('') +
    `<div><b style="background:var(--neutral)">${dieIcon()}</b>Tira otra vez</div>`;
}

/* ---------- Arranque ---------- */
// Identidad del jugador: se guarda por pestaña, así dos pestañas del mismo navegador son jugadores distintos.
NET.pid = store('sessionStorage', 'quesitos-pid') || Math.random().toString(36).slice(2) + Date.now().toString(36);
store('sessionStorage', 'quesitos-pid', NET.pid);
NET.name = cleanName(store('localStorage', 'quesitos-name'));
buildLegend(); buildBoard();
if (NET.room) {
  $('home').hidden = true;
  S = lobbyState();
  render();
  connect();
  // Mantiene viva la conexión aunque nadie haga nada durante un rato.
  NET.ping = setInterval(() => { if (NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"ping"}'); }, 25000);
  addEventListener('online', () => { if (NET.status !== 'open') connect(); });
} else showHome();
// Para las pruebas automáticas: el estado público que ha llegado del servidor (no contiene respuestas).
window.__quesitos = () => S && JSON.parse(JSON.stringify(S));
