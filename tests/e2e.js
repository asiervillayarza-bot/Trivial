// Prueba de extremo a extremo: varios navegadores juegan una partida contra el servidor local (wrangler dev).
// Uso: npm run dev (en otra terminal) y después npm run test:e2e.
//   BASE=http://127.0.0.1:8787  CHROMIUM=/ruta/a/chrome  (opcionales)
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const W = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath:process.env.CHROMIUM} : {});
async function player(name, viewport = {width:1280, height:860}) {
  const ctx = await browser.newContext({viewport});
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  p.name = name;
  return p;
}
const state = p => p.evaluate(() => window.__quesitos && window.__quesitos());
// Pulsa una de las casillas que parpadean (las casillas son arcos: un clic en el centro de su recuadro puede caer fuera).
const pickCell = p => p.waitForSelector('.cell.dest').then(() => p.evaluate(() => document.querySelector('.cell.dest').dispatchEvent(new MouseEvent('click', {bubbles:true}))));

try {
  // Ane crea la partida
  const ane = await player('Ane');
  await ane.goto(BASE);
  await ane.click('#createBtn');
  await ane.waitForSelector('.code');
  await ane.fill('#myName', 'Ane'); await W(400);
  await ane.click('.tcard[data-k="0"]'); await W(300);
  const code = (await ane.textContent('.code')).trim();
  assert.match(code, /^[A-Z0-9]{5}$/);
  assert.equal(await ane.$eval('#startBtn', b => b.disabled), true, 'con un solo equipo no se puede empezar');

  // Jon se une con el código y Mikel con el enlace
  const jon = await player('Jon', {width:390, height:844});
  await jon.goto(BASE);
  await jon.fill('#homeCode', code.toLowerCase()); await jon.click('#joinHome .btn');
  await jon.waitForSelector('.tcard');
  await jon.fill('#myName', 'Jon'); await W(400); await jon.click('.tcard[data-k="0"]');
  const mikel = await player('Mikel');
  await mikel.goto(`${BASE}/?sala=${code}`);
  await mikel.waitForSelector('.tcard');
  await mikel.fill('#myName', 'Mikel'); await W(400); await mikel.click('.tcard[data-k="1"]');
  await W(600);
  assert.deepEqual(await ane.$$eval('.tcard[data-k="0"] .avatar > span', els => els.map(e => e.textContent.replace('★ ', ''))), ['Ane (tú)', 'Jon']);
  assert.equal(await jon.$('#startBtn'), null, 'solo quien crea la partida la puede empezar');
  // Cualquiera del equipo puede cambiar su nombre
  await jon.fill('#myTeamName', 'Los Txapeldunak'); await W(900);
  assert.equal(await ane.textContent('.tcard[data-k="0"] .tname'), 'Los Txapeldunak');
  assert.equal(await mikel.textContent('.tcard[data-k="0"] .tname'), 'Los Txapeldunak');
  // (Los bots se prueban en tests/game.test.js: aquí solo personas, para que la partida avance a un ritmo fijo.)
  await ane.click('#startBtn'); await W(800);

  const pages = {Ane:ane, Jon:jon, Mikel:mikel};
  const turns = [];
  let chatChecked = false;
  const end = Date.now() + 180000;
  while (Date.now() < end && (turns.length < 6 || !chatChecked)) {
    const st = await state(ane);
    const roller = st.players.find(p => p.pid === st.roller);
    if (!roller || roller.bot || st.phase === 'rolling' || st.phase === 'moving') { await W(400); continue; }
    const pl = pages[roller.name];
    if (st.phase === 'roll') {
      turns.push(roller.name);
      for (const [n, p] of Object.entries(pages)) assert.equal(!!(await p.$('#rollBtn')), n === roller.name, `${n}: botón de tirar`);
      await pl.click('#rollBtn'); await W(1000);
      for (const [n, p] of Object.entries(pages)) if (n !== roller.name) assert.equal((await p.$$('.cell.dest')).length, 0, `${n}: no elige casilla`);
      await pickCell(pl); await W(1600);
    } else if (st.phase === 'choose') {
      await pickCell(pl); await W(1600);
    } else if (st.phase === 'question' && st.q.picked === null) {
      for (const p of Object.values(pages)) assert.equal((await state(p)).q.answer, undefined, 'la respuesta no llega antes de contestar');
      if (!chatChecked && roller.name !== 'Mikel') {
        chatChecked = true;
        const mate = roller.name === 'Ane' ? jon : ane;
        await mate.fill('#qchat input', 'Yo diría la C'); await mate.press('#qchat input', 'Enter');
        await mate.click('.opt[data-i="2"]'); await W(600);
        assert.match(await pl.textContent('#qchat .chatlog'), /Yo diría la C/);
        assert.ok(await pl.$('.opt[data-i="2"] .votes'), 'la propuesta aparece en la opción');
        assert.doesNotMatch(await mikel.textContent('#chatpanel .chatlog'), /Yo diría/, 'el otro equipo no ve el chat');
      }
      await pl.click('.opt[data-i="0"]'); await W(500);
      assert.notEqual((await state(ane)).q.answer, undefined, 'tras contestar se ve la respuesta');
      await pl.click('#contBtn'); await W(500);
    } else await W(400);
  }
  assert.ok(turns.length >= 3, 'se han jugado varios turnos');
  assert.ok(chatChecked, 'se ha probado el chat de equipo');

  // Quien creó la partida recarga: la partida sigue en el servidor.
  await ane.reload();
  await ane.waitForSelector('#app:not([hidden])', {timeout:15000});
  const after = await state(ane);
  assert.notEqual(after.phase, 'setup');
  assert.equal(after.players.filter(p => p.online && !p.bot).length, 3);
  assert.deepEqual(errors, []);
  console.log(`OK · sala ${code} · turnos: ${turns.join(', ')}`);
} catch (e) {
  console.error(errors.length ? 'Errores en la página:\n' + errors.join('\n') : '');
  throw e;
} finally {
  await browser.close();
}
