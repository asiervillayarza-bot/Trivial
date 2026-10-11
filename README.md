# Trivial

Juego de preguntas por equipos al estilo Trivial para jugar en clase: en un solo ordenador con el proyector, o uniéndose cada uno desde su móvil con un código o un enlace.

## Cómo jugar

1. Abre `index.html` en el navegador (o la página de GitHub Pages del repositorio).
2. Elige de 2 a 6 equipos, sus nombres y el tiempo para responder.
3. Tira el dado y elige una de las dos casillas que parpadean.
4. Responde la pregunta del color de la casilla. Si aciertas, vuelves a tirar; si fallas, pasa el turno.
5. En las casillas grandes ganas un quesito. Con los 6, los demás equipos eligen la categoría de tu pregunta final. Si aciertas, ganas.

Atajos: teclas 1–4 para responder, Intro para continuar.

## Jugar con los móviles

El ordenador que abre el juego (el del profe o el del proyector) crea una **sala** con un código de 5 letras, un enlace y un QR (panel «Jugar con móviles»).

1. Cada alumno abre el enlace o escanea el QR (o abre el juego y escribe el código en «¿Te han pasado un código?»).
2. Escribe su nombre y pulsa el equipo al que se quiere unir. El profe ve en su pantalla quién está en cada equipo.
3. El profe pulsa «Empezar partida». Cuando le toca a un equipo, sus jugadores pueden tirar el dado, elegir casilla y responder desde el móvil; el resto ve la pregunta pero no puede contestar.
4. El ordenador del profe puede seguir jugando por cualquier equipo (por ejemplo, para los equipos sin móvil).

Si alguien pierde la conexión o recarga la página, vuelve a entrar solo y conserva su equipo. Si el profe recarga, la partida y el código se mantienen.

Para que el enlace funcione en los móviles, el juego tiene que estar publicado en una web (por ejemplo, GitHub Pages); abriendo `index.html` como archivo solo funciona el código. La conexión usa [PeerJS](https://peerjs.com/) (WebRTC) con su servidor público gratuito; no hace falta montar nada. Si en el centro está bloqueado, se puede usar un servidor PeerJS propio añadiendo `?servidor=host:puerto` a la dirección.

## Añadir preguntas

Las preguntas están en `index.html`, en la constante `QUESTIONS`. Cada una tiene este formato:

```js
['Enunciado', 'Respuesta correcta', 'Incorrecta', 'Incorrecta', 'Incorrecta'],
```

El juego mezcla el orden de las respuestas automáticamente.
