# Trivial

Juego de preguntas por equipos al estilo Trivial para jugar en clase, en un solo ordenador o con el proyector.

## Cómo jugar

1. Abre `index.html` en el navegador (o la página de GitHub Pages del repositorio).
2. Elige de 2 a 6 equipos, sus nombres y el tiempo para responder.
3. Tira el dado y elige una de las dos casillas que parpadean.
4. Responde la pregunta del color de la casilla. Si aciertas, vuelves a tirar; si fallas, pasa el turno.
5. En las casillas grandes ganas un quesito. Con los 6, los demás equipos eligen la categoría de tu pregunta final. Si aciertas, ganas.

Atajos: teclas 1–4 para responder, Intro para continuar.

## Añadir preguntas

Las preguntas están en `index.html`, en la constante `QUESTIONS`. Cada una tiene este formato:

```js
['Enunciado', 'Respuesta correcta', 'Incorrecta', 'Incorrecta', 'Incorrecta'],
```

El juego mezcla el orden de las respuestas automáticamente.
