# Persona C: Iván Cortés, usuario con prisa

Citas entre paréntesis = archivo donde se vio. Lo que el código no dice se marca como "No consta en el código".

## 1. Quién es

- **Nombre:** Iván Cortés.
- **Edad:** 33.
- **Situación laboral:** técnico de soporte informático por cuenta ajena, jornada completa, en Talavera de la Reina.
- **Experiencia en negocios:** ninguna propia. Lleva 3 años ayudando a su pareja, ceramista, a vender en ferias: él lleva la caja y el Instagram.

## 2. Contexto

Su pareja hace tazas de cerámica a mano y quiere vender por internet. El viernes hablan con el banco por un préstamo y Iván quiere llegar con "algo en papel". Un compañero de trabajo le habló de MANDO y tiene 20 minutos en la pausa de comida, en su ordenador de sobremesa. Si en ese tiempo no ve algo útil, no vuelve. Le preocupa perder el tiempo y que la herramienta le pida más datos de los que tiene. Cuenta con ayuda de un primo que hace las fotos, por eso el equipo es pequeño.

## 3. Objetivo

"En menos de 10 minutos quiero ver el informe de mi tienda de tazas y comprobar que la búsqueda del plan encuentra `finance`."

Comprobable en la web: aparece "Your business at a glance" (index.html). Tras `Build my plan`, la búsqueda `finance` en la barra del plan lleva a `#/search?q=finance` y muestra al menos un resultado (plan.js, `searchView`).

## 4. Datos que tiene a mano

- **Idea (la teclea tal cual):** `An online store for handmade ceramic mugs made in Talavera de la Reina`
- **Budget:** `$30,000` (el deslizador avanza de 10.000 en 10.000, index.html).
- **Years in this industry:** `3 years` (script.js, formato `years`).
- **Team size:** `Small (2-3)` (index.html).
- **Weekly hours:** `10-20 h` (index.html). Es el valor que trae el deslizador por defecto; tiene que tocarlo igualmente para que cuente como elegido (script.js, `markSet`).
- **Cuenta:** ya creada de antes, con la sesión abierta. El código guarda la sesión 30 días en una cookie (README.md, "Security"). Si la sesión ha caducado, usa `Log In` con email y contraseña (index.html). Las credenciales no constan: las pone quien haga la prueba.
- **Respuestas a las preguntas aclaratorias.** El texto de las preguntas lo genera el modelo y no consta en el código.
  - **Larga:** `Customers are people in Spain and Portugal between 30 and 55 who buy gifts or tableware. We sell through our own website and Instagram. Prices are between 18 and 35 euros per mug, and each one is made to order in about two weeks.`
  - **Corta:** `Not sure yet`

## 5. Comportamiento

- **Instrucciones:** no lee nada. No ve el "Try:" ni "Your situation". Va a la barra de texto y a los deslizadores (index.html).
- **Paciencia:** muy poca. Pulsa `Cancel` a los 8 o 10 segundos del primer envío para ver qué pasa. En el segundo intento aguanta hasta 30 segundos de loader. Si hay más, se va.
- **Registro:** no se registra ahora; ya tiene cuenta. Si la sesión ha caducado, hace login (no registro).
- **Tema:** Contrast, porque trabaja en una terraza con reflejos (theme.js, `CHOICES`).
- **Si algo no se entiende:** lo salta. En las preguntas pulsa la primera opción si la hay y escribe `Not sure yet` si no. Si le piden una respuesta larga, escribe la larga de arriba una sola vez.
- **Dispositivo:** ordenador de sobremesa. Si usara móvil, sería un riesgo y no un requisito: las páginas llevan etiqueta de viewport (index.html, `<meta name="viewport">`), pero los archivos leídos no dicen nada del diseño en móvil (No consta en el código).

## 6. Recorrido esperado

1. **Portada.** Elige Contrast en el selector (theme.js). Teclea la idea.
2. **Deslizadores.** Los coloca rápido con el teclado o el ratón en `$30,000`, `3 years`, `Small (2-3)` y `10-20 h`. Si olvida uno, sale `Select a value for ...` y lo arregla (script.js).
3. **Envío 1 y Cancel.** Pulsa la flecha. Aparece el loader. A los 8 o 10 segundos pulsa `Cancel` (index.html, `wait-cancel`). El resultado esperado: vuelve la portada con la idea y los deslizadores como estaban, y aparece el mensaje "Analysis cancelled. Your idea is still there." para el lector de pantalla (script.js, `cancelWait`). El texto de ese mensaje no se ve en pantalla, solo se anuncia (index.html, `id="status"` con `sr-only`); lo visible es el regreso a la portada.
4. **Envío 2.** Pulsa la flecha de nuevo. ▶ **Primera decisión:** si el loader pasa de 30 segundos, se va.
5. **Preguntas.** Contesta pulsando opciones o con `Not sure yet`. Lo que le irrita: ver un `Question 1 of 4` o más (script.js, `Question ${n} of ${total}`).
6. **Informe.** Mira "Your business at a glance" y "Key areas". ▶ **Segunda decisión (la importante):** si el informe le dice algo que no sabía, sigue. Si no, cierra.
7. **Plan, solo para buscar.** Pulsa `Build my plan`. En la vista general no lee nada y va a la barra de búsqueda de arriba. Escribe `finance` y pulsa `Search` (plan.js, `planBar`). Mira los resultados. Prueba un filtro (`All`, `Blocked`, `Waiting for me`, `Done`).
8. Cierra la pestaña. No abre `My projects`.

## 7. Criterio de éxito

- Al enviar, los deslizadores muestran `$30,000`, `3 years`, `Small (2-3)` y `10-20 h`.
- Tras `Cancel`, se ve de nuevo la barra con el texto de la idea y los deslizadores con sus valores. No queda el loader ni el popup de preguntas.
- El informe "Your business at a glance" aparece con la barra `N of 15 topics defined` (script.js, `result-meta`; README.md, 15 dimensiones).
- Con la búsqueda `finance` en el plan, la URL cambia a `#/search?q=finance` y la página muestra al menos una fila en "Departments", tareas o fases. No debe salir "Nothing matches." (plan.js, `searchView`).
- Todo ocurre en menos de 10 minutos.

## 8. Señales de abandono

- El loader supera 30 segundos en el segundo intento.
- El contador de preguntas marca `of 4` o más.
- Una pregunta sin opciones que exige escribir un párrafo.
- El informe sale con "Not enough information yet" o con todo `Not specified` (script.js, `showResult`).
- La búsqueda devuelve "Nothing matches." en dos palabras seguidas.
- Que `Cancel` no devuelva la portada o borre su idea.
- Que la sesión haya caducado y tenga que recordar la contraseña: no hay "Forgot password?" visible (index.html, el botón está oculto con `hidden`).

## 9. Supuesto a validar

Se asume que alguien con prisa llega a abrir el plan solo para buscar en él; el código no confirma que la búsqueda se vea desde el informe, porque solo existe dentro de la página del plan (plan.js, `planBar`).
