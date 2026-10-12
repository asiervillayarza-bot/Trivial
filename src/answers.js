// Corrección de las preguntas «para escribir»: se acepta la respuesta aunque cambien mayúsculas, tildes,
// artículos o haya una errata pequeña, y basta con el apellido o la palabra clave («Cervantes», «Volga»).

const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'y', 'e', 'en', 'al', 'a']);

export const normalize = s => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')    // tildes
  .replace(/[«»"“”'’.,;:¡!¿?()\-–—/]/g, ' ')
  .replace(/\s+/g, ' ').trim();

const words = s => normalize(s).split(' ').filter(w => w && !STOP.has(w));
const digits = s => String(s || '').replace(/\D/g, '');

// Solo se preguntan para escribir las respuestas cortas (nada de frases).
// Las respuestas con números solo se preguntan para escribir si lo demás son unidades («343 m/s», «40 minutos»),
// porque se corrigen por el número (así «0 positivo» no valdría por «0 negativo»).
const UNITS = new Set(['km', 'm', 's', 'c', 'f', 'a', 'd', 'minutos', 'segundos', 'unos']);
export function canBeOpen(answer) {
  const w = normalize(answer).split(' ').filter(Boolean);
  if (answer.length > 28 || w.length > 4) return false;
  return !/\d/.test(answer) || w.every(x => /\d/.test(x) || UNITS.has(x.replace(/[^a-z]/g, '')));
}

function distance(a, b) {
  const d = Array.from({length:a.length + 1}, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Erratas permitidas solo en palabras largas («Velazques» vale por «Velázquez»; «mogol» no vale por «mongol»).
// Los números romanos y las palabras muy cortas tienen que coincidir exactamente («Felipe III» no es «Felipe II»).
const ROMAN = /^[ivxlcdm]+$/;
const closeWord = (a, b) => {
  if (a === b) return true;
  if (ROMAN.test(a) || ROMAN.test(b) || /\d/.test(a + b)) return false;
  const n = Math.max(a.length, b.length);
  return n >= 7 && distance(a, b) <= (n >= 10 ? 2 : 1);
};
const closeWords = (a, b) => a.length === b.length && a.every((w, i) => closeWord(w, b[i]));

export function judge(input, answer) {
  const given = words(input);
  if (!given.length) return false;
  const full = words(answer);
  // Respuestas numéricas (años, cantidades): tiene que coincidir el número, y la unidad si se escribe.
  if (/\d/.test(answer)) {
    const extra = given.filter(w => !/\d/.test(w));
    return digits(input) !== '' && digits(input) === digits(answer) && extra.every(w => full.some(f => closeWord(w, f)));
  }
  if (closeWords(given, full)) return true;
  // Basta con la última palabra importante (el apellido, el nombre propio…) si la respuesta es corta.
  const last = full[full.length - 1];
  return given.length === 1 && full.length <= 3 && last.length >= 4 && closeWord(given[0], last);
}
