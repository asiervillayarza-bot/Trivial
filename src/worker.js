// Servidor de Quesitos en Cloudflare.
// - Sirve la web (carpeta public/).
// - /api/sala/<CÓDIGO> abre un WebSocket con la sala de ese código: un Durable Object que lleva la partida.
import {createGame} from './game.js';
import {CODE_RE} from '../public/shared.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/sala\/([^/]+)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('Código no válido', {status:400});
      const stub = env.SALAS.get(env.SALAS.idFromName(code));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

const SAVE_EVERY = 2000;              // guarda la partida como mucho cada 2 s
const FORGET_AFTER = 6 * 3600 * 1000; // sala vacía durante 6 h: se borra

export class Sala {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.sockets = new Map(); // WebSocket → pid
    this.game = null;
    this.saveTimer = null;
    this.tickTimer = null;
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('partida');
      if (saved) this.game = this.makeGame(saved);
    });
  }

  makeGame(saved = null) {
    return createGame({saved, hooks:{
      changed: () => { this.broadcast(); this.scheduleSave(); },
      chat: (team, msgs, pids) => {
        const data = JSON.stringify({t:'chat', team, msgs});
        for (const [ws, pid] of this.sockets) if (pids.includes(pid)) this.send(ws, data);
        this.scheduleSave();
      },
    }});
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Se esperaba un WebSocket', {status:426});
    const pair = new WebSocketPair();
    const [client, ws] = Object.values(pair);
    ws.accept();
    ws.addEventListener('message', e => this.onMessage(ws, e.data));
    ws.addEventListener('close', () => this.onClose(ws));
    ws.addEventListener('error', () => this.onClose(ws));
    return new Response(null, {status:101, webSocket:client});
  }

  onMessage(ws, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (typeof msg.pid !== 'string' || !msg.pid || msg.pid.length > 40) return ws.close(1008, 'pid');
      if (!this.game) {
        // La sala solo se crea cuando la pide quien pulsa «Crear partida».
        if (!msg.crear) { this.send(ws, JSON.stringify({t:'error', code:'missing'})); return ws.close(1000, 'missing'); }
        this.game = this.makeGame();
        this.ctx.storage.deleteAlarm();
      } else if (msg.crear && !this.game.state.players.some(p => p.pid === msg.pid)) {
        // Ese código ya está en uso por otra partida: el navegador probará con otro.
        this.send(ws, JSON.stringify({t:'error', code:'taken'}));
        return ws.close(1000, 'taken');
      }
      for (const [other, pid] of this.sockets) if (pid === msg.pid && other !== ws) { this.sockets.delete(other); try { other.close(1000, 'replaced'); } catch {} }
      this.sockets.set(ws, msg.pid);
      if (!this.game.join(msg.pid, msg.name)) { this.send(ws, JSON.stringify({t:'error', code:'full'})); return ws.close(1000, 'full'); }
      this.startTicking();
      const team = this.game.state.players.find(p => p.pid === msg.pid)?.team;
      if (team !== null && team !== undefined && this.game.state.phase !== 'setup') this.send(ws, JSON.stringify({t:'chat', team, msgs:this.game.chatFor(team)}));
    } else if (msg.t === 'act') {
      const pid = this.sockets.get(ws);
      if (pid && this.game) this.game.perform(pid, msg.a, msg.v);
    } else if (msg.t === 'ping') {
      this.send(ws, '{"t":"pong"}');
    }
  }

  onClose(ws) {
    const pid = this.sockets.get(ws);
    if (pid === undefined) return;
    this.sockets.delete(ws);
    if (this.game && ![...this.sockets.values()].includes(pid)) this.game.leave(pid);
    if (!this.sockets.size) {
      clearInterval(this.tickTimer); this.tickTimer = null;
      this.save();
      this.ctx.storage.setAlarm(Date.now() + FORGET_AFTER);
    }
  }

  async alarm() {
    if (this.sockets.size) return;
    this.game && this.game.stop();
    this.game = null;
    await this.ctx.storage.deleteAll();
  }

  startTicking() {
    if (!this.tickTimer) this.tickTimer = setInterval(() => this.game && this.game.tick(), 300);
  }

  broadcast() {
    if (!this.game || !this.sockets.size) return;
    const data = JSON.stringify({t:'state', S:this.game.publicState()});
    for (const ws of this.sockets.keys()) this.send(ws, data);
  }

  send(ws, data) {
    try { ws.send(data); } catch { this.onClose(ws); }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, SAVE_EVERY);
  }

  save() {
    if (this.game) this.ctx.storage.put('partida', this.game.snapshot());
  }
}
