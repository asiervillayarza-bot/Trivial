# Quesitos

Juego de preguntas por equipos al estilo Trivial para jugar con amigos, cada uno desde su ordenador o su móvil, uniéndose a una sala con un código o un enlace.

## Cómo jugar

Cada jugador juega desde su ordenador o su móvil.

1. Uno abre el juego y pulsa **Crear partida**. Se abre una **sala** con un código de 5 letras y un enlace para invitar a los demás.
2. Los demás abren el enlace, o abren el juego, pulsan **Unirme a partida** y escriben el código.
3. En la sala, cada uno escribe su nombre y elige equipo. Quien ha creado la partida elige el número de equipos, sus nombres y el tiempo para responder, y pulsa **Empezar partida** (hacen falta al menos 2 equipos con jugadores; los equipos vacíos no juegan).
4. En cada turno de un equipo tira **uno de sus jugadores**, por orden: tira el dado, elige una de las dos casillas que parpadean y responde la pregunta del color de la casilla. Los demás lo ven en directo. Si acierta, vuelve a tirar; si falla, pasa el turno al siguiente equipo.
   Cada equipo tiene un **chat privado** (en el panel lateral y dentro de la pregunta). Mientras responde un compañero, los demás pueden pulsar una opción para **proponérsela**: aparece en el chat y en la propia opción.
5. En las casillas grandes se gana un quesito. Con los 6, el equipo juega la **ronda final**: 6 preguntas seguidas, una de cada categoría en orden aleatorio. Si acierta 4, gana; si falla 3, pasa el turno y vuelve a intentarlo la próxima vez.
6. Algunas preguntas son **para escribir**: no salen opciones y quien responde escribe la respuesta. Se corrige con manga ancha (mayúsculas, tildes, erratas pequeñas, basta con el apellido) en `src/answers.js`. Las preguntas de quesito son siempre así; para las demás, quien crea la partida elige en la sala si no hay ninguna, algunas (1 de cada 3) o todas.

Atajos: teclas 1–4 para responder, Intro para continuar.

### Probar solo con bots

En la sala, quien crea la partida tiene «Bots para probar»: cada botón «+ Bot» añade un bot a ese equipo. Los bots juegan solos cuando les toca (tiran, eligen casilla y aciertan más o menos 2 de cada 3) y, si están en tu equipo, te proponen una respuesta en el chat. Así se puede probar el juego sin nadie más.

### Conexión

- La partida vive en un **servidor de salas en Cloudflare** (Workers + Durable Objects, plan gratuito). Cada uno se conecta a él desde su navegador, así que funciona en casi cualquier red.
- Si alguien pierde la conexión o recarga, vuelve a entrar solo y conserva su equipo. Si quien creó la partida se va, otra persona pasa a dirigirla. Si un equipo se queda sin nadie conectado, pierde su turno a los 15 segundos.
- Las respuestas correctas solo se envían a los navegadores después de contestar.

## Cómo está hecho

```
public/            La web (lo que ve cada jugador)
  index.html       Estructura de las pantallas
  styles.css       Diseño
  app.js           Pantallas y conexión con la sala
  shared.js        Constantes y reglas que comparten la web y el servidor
src/               El servidor (Cloudflare Worker)
  worker.js        Sirve la web y abre las salas (/api/sala/CÓDIGO, WebSocket)
  game.js          Motor de la partida: turnos, preguntas, chat, bots
  questions.js     Las preguntas
tests/             Pruebas automáticas
wrangler.jsonc     Configuración de Cloudflare
```

### Probar en tu ordenador

Necesitas [Node.js](https://nodejs.org) 22 o posterior.

```
npm install
npm run dev          # abre http://localhost:8787
npm test             # pruebas del motor de la partida
npm run test:e2e     # partida completa con navegadores simulados (con «npm run dev» abierto)
```

### Publicar

Cloudflare está conectado al repositorio:

- **Web de verdad** (`trivial`): se publica sola con cada cambio que llega a `main`.
- **Web de pruebas** (`trivial-pruebas`): se publica sola con cada cambio de la rama de trabajo (`npx wrangler deploy --env pruebas`), para probar antes de pasar a `main`.

Las pruebas automáticas se ejecutan en GitHub en cada cambio.

El `index.html` de la raíz es la versión anterior (para GitHub Pages, sin servidor) y se mantiene hasta que la nueva esté en marcha.

## Añadir preguntas

Las preguntas están en `src/questions.js`, en la constante `QUESTIONS`. Cada una tiene este formato:

```js
['Enunciado', 'Respuesta correcta', 'Incorrecta', 'Incorrecta', 'Incorrecta'],
```

El juego mezcla el orden de las respuestas automáticamente.
