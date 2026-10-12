# Trivial

Juego de preguntas por equipos al estilo Trivial para jugar con amigos, cada uno desde su ordenador o su móvil, uniéndose a una sala con un código o un enlace.

## Cómo jugar

Cada jugador juega desde su ordenador o su móvil.

1. Uno abre el juego (la página de GitHub Pages del repositorio) y pulsa **Crear partida**. Se abre una **sala** con un código de 5 letras y un enlace para invitar a los demás.
2. Los demás abren el enlace, o abren el juego, pulsan **Unirme a partida** y escriben el código.
3. En la sala, cada uno escribe su nombre y elige equipo. Quien ha creado la partida elige el número de equipos, sus nombres y el tiempo para responder, y pulsa **Empezar partida** (hacen falta al menos 2 equipos con jugadores; los equipos vacíos no juegan).
4. En cada turno de un equipo tira **uno de sus jugadores**, por orden: tira el dado, elige una de las dos casillas que parpadean y responde la pregunta del color de la casilla. Los demás lo ven en directo. Si acierta, vuelve a tirar; si falla, pasa el turno al siguiente equipo.
   Cada equipo tiene un **chat privado** (en el panel lateral y dentro de la pregunta). Mientras responde un compañero, los demás pueden pulsar una opción para **proponérsela**: aparece en el chat y en la propia opción.
5. En las casillas grandes se gana un quesito. Con los 6, los demás equipos eligen la categoría de la pregunta final. Si se acierta, ese equipo gana.

Atajos: teclas 1–4 para responder, Intro para continuar.

### Conexión

- El navegador de quien crea la partida hace de enlace entre todos: si cierra la página, la partida se corta (si solo la recarga, se recupera con el mismo código).
- Si alguien pierde la conexión o recarga, vuelve a entrar solo y conserva su equipo. Si un equipo se queda sin nadie conectado, pierde su turno a los 15 segundos.
- La conexión usa [PeerJS](https://peerjs.com/) (WebRTC). Funciona bien con cada uno en su casa o con datos móviles; en algunas redes (wifi de un centro, VPN) o con dos ventanas en el mismo ordenador puede no conectar. Se puede usar un servidor PeerJS propio añadiendo `?servidor=host:puerto` a la dirección.

## Añadir preguntas

Las preguntas están en `index.html`, en la constante `QUESTIONS`. Cada una tiene este formato:

```js
['Enunciado', 'Respuesta correcta', 'Incorrecta', 'Incorrecta', 'Incorrecta'],
```

El juego mezcla el orden de las respuestas automáticamente.
