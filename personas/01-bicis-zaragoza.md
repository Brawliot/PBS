# Persona A: Marta Quiroga, principiante con poco presupuesto

Citas entre paréntesis = archivo donde se vio. Lo que el código no dice se marca como "No consta en el código".

## 1. Quién es

- **Nombre:** Marta Quiroga.
- **Edad:** 29.
- **Situación laboral:** auxiliar de biblioteca en Zaragoza, contrato a media jornada. Tiene las tardes libres entre semana, pero con cansancio.
- **Experiencia en negocios:** ninguna. Nunca ha facturado ni ha hecho un plan. Sabe reparar bicicletas porque lo hace desde adolescente en el taller de su tío.

## 2. Contexto

Su tío le ha prestado un remolque y una caja de herramientas. Ella quiere arreglar bicis a domicilio y en el campus los sábados, sin local. Tiene 10.000 $ ahorrados (los convierte de euros) y no quiere pedir un préstamo hasta saber si la idea se sostiene. Llega a MANDO porque una amiga le dijo "escribe tu idea y te devuelve un plan". Le preocupa gastar sus ahorros en algo que no funcione y no saber ni por dónde empezar. También le da miedo que la herramienta "no entienda" un negocio tan pequeño.

## 3. Objetivo

"Quiero salir con un plan de mi servicio de reparación de bicis que pueda volver a abrir mañana, hecho con 10.000 $ y menos de 10 horas a la semana."

Comprobable en la web: al enviar, los deslizadores muestran `$10,000` y `Under 10 h`; al final se abre `/plan?id=...` (script.js) y el plan aparece en `/projects` (projects.js).

## 4. Datos que tiene a mano

- **Idea (la teclea tal cual):** `A mobile bicycle repair service for students and commuters in Zaragoza`
- **Budget:** `$10,000`. Es el primer valor por encima de $0, porque el deslizador avanza de 10.000 en 10.000 (index.html, `min="0" max="1000000" step="10000"`).
- **Years in this industry:** `0 years`. La web arranca en 5, así que tiene que bajarlo (index.html, `value="5"`).
- **Team size:** `Solo` (index.html, `data-labels="Solo|Small (2-3)|Medium (4-10)|Large (10+)"`).
- **Weekly hours:** `Under 10 h` (index.html). La web arranca en `10-20 h`, así que tiene que moverlo.
- **Datos de registro (ficticios):** nombre `Marta Quiroga`, email de prueba inventado, contraseña de al menos 8 caracteres (index.html, `minlength="8"`).
- **Respuestas a las preguntas aclaratorias.** El texto de las preguntas lo genera el modelo y no consta en el código; solo se sabe que cada una trae un tema y a veces hasta 4 opciones (script.js, `options.slice(0, 4)`).
  - **Larga:** `I would start with Saturday visits near the university and house calls on weekday evenings. I already have a trailer and a basic toolkit from my uncle. Customers would be students and commuters who cannot reach a shop during opening hours. I would charge around 20 euros for a flat tire or brake repair.`
  - **Corta:** `Not yet`

## 5. Comportamiento

- **Instrucciones:** no las lee. Mira el placeholder de la barra y escribe. Ignora "Your situation" y la nota "We will ask a few questions · about 1 minute" (index.html).
- **Paciencia:** aguanta unos 90 segundos de espera con el loader. Si pasa de 2 minutos sin cambio visible, se marcha. El código da 180 s de límite total (script.js, `JOB_TIMEOUT_MS`).
- **Registro:** **no se registra a la primera.** Al pulsar la flecha sin sesión sale el diálogo con solo dos botones, `Log In` y `Register`, sin ninguna explicación (index.html, `gate-modal`; script.js, `if (!currentUser) gate.showModal()`). Lo cierra con la ×, mira la portada buscando otra salida y no la hay. Se registra en el **segundo** intento, porque ya tiene escrita la idea y movidos los deslizadores.
- **Tema:** System. No toca el selector.
- **Si algo no se entiende:** si la pregunta trae opciones, elige la primera. Si no, escribe `Not yet`. No busca ayuda: el código no tiene página de ayuda (No consta en el código).
- **Fricción esperada:** no mueve Team size porque ya pone `Solo` (el valor de ejemplo aparece como `e.g. Solo`, index.html). Al enviar sale el error `Select a value for Team size.` (script.js, `showFieldError(range, ...)`).

## 6. Recorrido esperado

1. **Portada.** Escribe la idea en la barra. Ve los chips `Japanese restaurant`, `Fitness app`, `Online store` y no los usa (index.html).
2. **Deslizadores.** Mueve Budget, Years y Weekly hours. Se salta Team size y recibe el error `Select a value for Team size.` (script.js). Lo corrige con una pulsación sobre el deslizador.
3. **Envío 1.** Pulsa la flecha. Sale el diálogo de login obligatorio. ▶ **Primera decisión:** si esto vale la pena. Cierra el diálogo.
4. **Envío 2.** Vuelve a pulsar. Elige `Register`, rellena nombre, email, contraseña y repetir contraseña (index.html). No hay verificación de email, así que queda dentro al instante (README.md, "Accounts and sessions"; script.js, `authDialog.close()`).
5. **Envío 3.** Registrarse **no envía la idea sola**: el diálogo se cierra y ella debe pulsar la flecha otra vez (script.js, `submitAuth` termina en `authDialog.close()`). La idea y los deslizadores se conservan.
6. **Loader.** Ve el título MANDO convertirse en loader (script.js, `startLoading`). Mínimo 2,35 s visible (`EXIT_MS` + `MIN_LOADER_MS`). La espera real es de 20 a 90 s (README.md).
7. **Preguntas.** Aparece un popup con `Question 1 of N` (script.js). N va de 1 a 5 (README.md, "Question policy"). Responde una larga y el resto cortas.
8. **Informe.** Ve "Your business at a glance", las filas definidas, "Worth checking" (por ejemplo, aviso de presupuesto), "Key areas" y "Still to define" (index.html). ▶ **Segunda decisión:** si el informe habla de su negocio.
9. **Plan.** Pulsa `Build my plan`. Se abre la vista general con el título igual a su idea, los departamentos y la pestaña Timeline (plan.js).
10. **My projects.** Desde la barra del plan pulsa `My projects` y confirma que su plan está en la lista (plan.js, `plan-bar__link`; projects.js).

## 7. Criterio de éxito

Se cumplen las tres cosas a la vez:

- Los valores mostrados al enviar son `$10,000`, `0 years`, `Solo` y `Under 10 h`.
- Se carga `/plan?id=<uuid>` con el texto de su idea como título en la cabecera del plan y al menos un departamento listado en "Departments" (plan.js, `generalView`).
- En `/projects` hay una fila con el título de su idea, el texto `Updated <fecha> · 0 of N steps done` y la etiqueta de estado (projects.js).

## 8. Señales de abandono

- El diálogo de login sale **antes** de mostrar nada del análisis y sin explicar por qué (index.html, `gate-modal`).
- Dos errores seguidos en el registro (contraseña de menos de 8 caracteres, contraseñas distintas).
- El loader supera 2 minutos sin cambio visible.
- Una pregunta pide algo que ella no sabe (por ejemplo, un dato financiero) y no hay opciones.
- Una pantalla de error con `Retry` que vuelve a fallar (script.js, `showSubmitError`).
- Un departamento sin tareas ("has no tasks yet", plan.js, `deptView`) cuando esperaba "qué hago el lunes".

## 9. Supuesto a validar

Se asume que una persona sin experiencia y con ahorros muy limitados llega a escribir una idea concreta antes de saber que hace falta cuenta; el código no confirma que ese público acepte registrarse a media tarea.
