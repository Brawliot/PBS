# Pendiente para producción

Este documento recoge lo que falta para publicar la fase 1 (el flujo completo: idea, preguntas, informe) y las mejoras opcionales. Lo que se hace antes de cerrar la fase está fuera de aquí; lo que pertenece a fases siguientes está en `FUTURE.md`.

Hoy el proyecto funciona en local, sin usuarios y sin estado en el servidor. Casi todo lo de abajo nace de eso.

---

## Imprescindible para producción

### Autenticación real
**Qué es.** Registro, login, recuperación de contraseña, verificación de email y sesiones seguras (cookies `HttpOnly`, `Secure` y `SameSite`), con las contraseñas guardadas con un hash lento (argon2 o bcrypt). Opcionalmente, acceso con Google. Hoy los formularios no envían nada y `REQUIRE_LOGIN` está en `false` solo para pruebas.
**Por qué.** Sin saber quién es el usuario no se puede limitar el uso, guardar sus proyectos ni proteger sus datos. Una comprobación solo en el navegador no es seguridad: la validación tiene que estar en el servidor.
**Hecho cuando.** Solo un usuario autenticado puede llamar a `POST /api/planner`, y el servidor rechaza con 401 al que no lo esté.
**Categoría.** Crítico, seguridad.

### Control de abuso y de coste
**Qué es.** Límite de peticiones por usuario y por IP, cuota de análisis por usuario y un tope de gasto diario con alertas. Cada análisis llama a Jev y a OpenAI, que cuestan dinero.
**Por qué.** Hoy el endpoint es público: cualquiera puede lanzar miles de peticiones y generar una factura. Es el mayor riesgo económico.
**Hecho cuando.** Un usuario que supera su cuota recibe un 429, y hay una alerta cuando el gasto diario se acerca al tope.
**Categoría.** Crítico, seguridad. Depende de la autenticación (para limitar por usuario).

### Base de datos
**Qué es.** Almacenamiento persistente de usuarios, proyectos y resultados de los análisis (por ejemplo, Postgres), con migraciones y copias de seguridad.
**Por qué.** El servidor no guarda nada: si recarga la página, se pierde todo. También es imprescindible para "View my projects" y para cumplir con el derecho a exportar y borrar datos.
**Hecho cuando.** Un usuario puede cerrar la sesión, volver y encontrar sus análisis; y existe un procedimiento probado para restaurar una copia.
**Categoría.** Crítico, datos de los usuarios.

### Gestión de secretos
**Qué es.** Las claves de Jev y OpenAI no pueden vivir en un `.env` dentro del servidor de producción. Se guardan en un gestor de secretos del proveedor de alojamiento y se rotan periódicamente.
**Por qué.** Un `.env` en disco se filtra fácilmente (copias de seguridad, logs, accesos de otros procesos) y una clave expuesta permite gastar a tu cuenta.
**Hecho cuando.** Ninguna clave aparece en el repositorio, en las imágenes de despliegue ni en los logs, y se puede rotar una sin tocar el código.
**Categoría.** Crítico, seguridad.

### Reintentos con espera creciente y tolerancia a fallos
**Qué es.** Si Jev u OpenAI fallan por algo temporal (saturación, error 429 o 503), el servidor reintenta unas pocas veces con esperas cada vez mayores en lugar de fallar de inmediato. Si un proveedor está caído, el mensaje al usuario lo distingue de un error propio.
**Por qué.** Con tráfico real, los fallos temporales de los proveedores son frecuentes y sin reintentos cada uno acaba como un error visible para el usuario.
**Hecho cuando.** Un fallo temporal simulado se recupera solo, y uno persistente se corta tras un número fijo de intentos.
**Categoría.** Crítico, pero solo cuando hay volumen.

### Cierre ordenado del servidor
**Qué es.** Al recibir la señal de parada (por ejemplo, durante un despliegue), el servidor deja de aceptar peticiones nuevas y espera a que terminen las que están en curso, en vez de cortarlas.
**Por qué.** Cada análisis tarda decenas de segundos y cuesta dinero; cortarlo a medias lo desperdicia y deja al usuario con un error.
**Hecho cuando.** Un despliegue durante un análisis en curso no interrumpe a ese usuario.
**Categoría.** Crítico en producción.

### CI/CD
**Qué es.** Un proceso automático que, con cada cambio, ejecuta la comprobación de tipos, los tests y la auditoría de dependencias, y despliega de forma repetible. Incluye un Dockerfile, entornos separados (desarrollo, staging y producción) y la versión de Node fijada.
**Por qué.** Sin esto, cada despliegue depende de que alguien se acuerde de los pasos, y un cambio que rompe algo llega a producción sin que nadie lo detecte.
**Hecho cuando.** Un cambio con tests rotos no se puede desplegar, y desplegar la versión anterior es un solo paso.
**Categoría.** Crítico en producción.

### Tests más allá de los unitarios
**Qué es.** Tests de integración de la API con los proveedores simulados, y tests de extremo a extremo con Playwright que recorran el flujo completo, incluidos errores y reintento.
**Por qué.** Los unitarios cubren funciones sueltas; no detectan que el front y el servidor dejen de entenderse. Un cambio en el formato de respuesta puede dejar la pantalla en blanco con todos los unitarios en verde.
**Hecho cuando.** Un cambio que rompe el flujo completo hace fallar el CI.
**Categoría.** Crítico al terminar el proyecto entero.

### Front en producción
**Qué es.** Compilar y minificar el JavaScript y el CSS, darles versión en el nombre para la caché, comprimirlos y servirlos desde un CDN o servidor web en lugar de desde el servidor Node.
**Por qué.** Hoy los archivos se sirven tal cual y sin caché. En producción eso hace la carga más lenta y consume recursos del servidor de la aplicación.
**Hecho cuando.** La página carga desde el CDN con caché larga y se invalida sola al desplegar una versión nueva.
**Categoría.** Producción.

### Revisión de accesibilidad completa
**Qué es.** Una auditoría contra WCAG nivel AA: teclado, lectores de pantalla, contraste, foco, etiquetas, tamaños táctiles y comportamiento con zoom, probada con herramientas automáticas y a mano.
**Por qué.** Es obligación legal en muchos mercados y amplía el público que puede usar la web.
**Hecho cuando.** Pasa las herramientas automáticas sin errores y un recorrido manual con teclado y lector de pantalla es posible de principio a fin.
**Categoría.** Producción.

### Capacidad (pruebas de carga)
**Qué es.** Medir cuántos usuarios simultáneos aguanta el sistema, simulando muchos análisis a la vez.
**Por qué.** Cada análisis mantiene una conexión abierta durante decenas de segundos y llama a proveedores externos. Es fácil saturar el servidor o los límites de los proveedores sin darse cuenta.
**Hecho cuando.** Hay un número documentado de usuarios simultáneos soportados y se sabe qué falla primero al superarlo.
**Categoría.** Producción.

### Cola de trabajos persistente
**Qué es.** Los análisis se ejecutan como trabajos: `POST /api/planner` responde al momento con un id y el front consulta `GET /api/planner/:id` hasta que termina. Hoy los trabajos viven en la memoria de un solo proceso. Hay que pasarlos a una cola de trabajos o a la base de datos, y asociar cada trabajo al usuario que lo creó, de modo que solo él pueda leer su resultado.
**Por qué.** En memoria, un reinicio o un despliegue pierde los análisis en curso y sus resultados, y con varias instancias el `GET` puede caer en un servidor que no conoce el trabajo. Además, hoy cualquiera que conozca el id puede leer el resultado de otra persona.
**Hecho cuando.** Un análisis sobrevive a un reinicio del servidor y se puede consultar desde cualquier instancia, y un usuario recibe 404 al pedir el trabajo de otro usuario.
**Categoría.** Crítico en producción, seguridad. Depende de la autenticación (para asociar cada trabajo a su usuario).

### Ligar informes y planes a usuarios
**Qué es.** Hoy todos los informes y los planes pertenecen a un único usuario local (`LOCAL_USER` en `server/plan-routes.ts`), y cada consulta lo usa. Cuando haya autenticación, el informe y el plan deben guardar el usuario real, y cada ruta debe comprobar que el usuario que pregunta es el dueño: `POST /api/plan`, `GET /api/plan/:id` y las acciones de los pasos.
**Por qué.** Si dos personas usan la aplicación, hoy compartirían todo, y el `reportId` que el navegador recibe serviría para leer el informe de cualquiera que lo conozca.
**Hecho cuando.** Un usuario recibe 404 al pedir un informe o un plan que no es suyo, y no hay ninguna consulta a la base de datos sin el usuario.
**Categoría.** Crítico, seguridad. Depende de la autenticación.

### Afirmaciones del análisis enviadas por el navegador
**Qué es.** La petición final del planner toma las afirmaciones del análisis (`analysis`) del navegador, que las devuelve tal como las recibió. De ellas salen las tareas "Verify X" del informe guardado. El servidor no las calcula ni las compara con la fase 2 que guardó.
**Por qué.** Una persona puede cambiar sus propias afirmaciones y el plan que se construye con ellas cambia. Solo afecta al plan de quien lo hace, pero el informe no es lo que el servidor produjo.
**Hecho cuando.** El informe guarda las afirmaciones que el servidor produjo (no las del navegador), o el navegador deja de enviarlas, y `server/plan/report.ts` y `server/planner/planner-run.ts` no lo describen como un valor del cliente.
**Categoría.** Producción, integridad. Afecta solo al propio plan de la persona.

### Retención de los informes
**Qué es.** La tabla `reports` (migración `002_reports.sql`) guarda el informe completo de cada análisis que termina con uno, y no se borra nunca. Hace falta una política: cuánto tiempo se guardan, cómo se borran los informes que no tienen plan, y cómo se borra todo lo de un usuario cuando lo pida.
**Por qué.** Cada análisis crece la tabla, y el informe contiene la idea del usuario y sus respuestas: datos personales que no deberían quedarse para siempre.
**Hecho cuando.** Hay un trabajo periódico que borra los informes sin plan con más de N días (N decidido con el equipo), el borrado de un usuario elimina también sus informes y planes, y la política está escrita en la política de privacidad.
**Categoría.** Crítico, datos de los usuarios. Depende de la autenticación (para saber de quién es cada informe).

---

## Hecho (rendimiento, seguridad y registros)

- **Cabeceras de seguridad en toda respuesta**: `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` y una Content-Security-Policy sin `unsafe-inline`. Calculadas en una sola función (`server/security.ts`) y comprobadas con valores exactos en cada tipo de respuesta. Las páginas no tienen script ni estilo en línea, y los e2e fallan ante cualquier violación.
- **Tiempos del pool de PostgreSQL**: máximo de conexiones (10), espera para conectar (5 s), inactividad (30 s) y tiempo máximo por consulta (10 s), todos ajustables por variable (`DB_POOL_MAX`, `DB_CONNECT_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`). Probado contra PostgreSQL real: una consulta que excede el tiempo se cancela.
- **Registros sin contenido**: una sola función (`server/log.ts`) escribe contexto, nombre del error y un código seguro, nunca el mensaje, la pila, la causa ni el cuerpo de un proveedor. Probado con textos secretos en cada uno de esos sitios.
- **Modo de desarrollo**: el servidor no arranca con `ENABLE_DEV_ROUTES=1` y `NODE_ENV=production`, y las rutas de desarrollo responden 404 en producción.
- **Datos que la base de datos acepta**: un texto con el carácter NUL (U+0000) o con caracteres de control (U+0001 a U+001F salvo tabulador y salto de línea, y U+007F) se rechaza antes de llegar a PostgreSQL, en la idea, en las respuestas, en los textos del plan y en los del informe. Un documento de plan de más de 5 MiB de JSON no se guarda (`MAX_DOCUMENT_BYTES`, sin calibrar). Un paso con 200 eventos no admite más acciones (`events_full`).
- **Una URL mal formada no tumba el servidor**: una petición con un destino que no se puede interpretar recibe `400` con las cabeceras de seguridad y sin contenido, y el servidor sigue atendiendo.

**Pendiente de la infraestructura** (no es código de la aplicación):

- **HSTS y TLS** los pone el proxy delante del servidor: certificado válido, redirección a HTTPS y `Strict-Transport-Security`.
- **Un rol de base de datos sin privilegios de administrador**: la aplicación debe conectarse con un rol que solo pueda leer y escribir sus tablas (no crear ni borrar esquemas, ni cambiar los disparadores de `plan_log` y `plan_events`).
- **Control de abuso**: sigue en la sección "Control de abuso y de coste" de arriba.

## Pendiente de la fase 2 (decisiones y propuestas)

### Retirar lo obsoleto
Los pasos, tareas y propuestas que una decisión deja sin efecto (un hecho sustituido o rechazado) se listan hoy como "derivados obsoletos" y no se retiran. Falta decidir qué pasa con ellos: retirarlos, rehacerlos o dejarlos, y la acción correspondiente en la API.
**Hecho cuando.** Cada elemento obsoleto tiene una acción de la persona y un registro de ella en `plan_log`.

### El significado de `feedback: "deleted"`
`plan.js` todavía oculta las tareas y los pasos con `feedback: "deleted"`. Nada del servidor escribe ese valor todavía. Hay que decidir si se mantiene, se sustituye por el registro de decisiones o se elimina.

### Propuestas generadas por IA
Hoy las propuestas salen solo de plantillas fijas (`server/plan/proposal-templates.ts`). Falta que la IA proponga hechos desde sus pasos y que proponga tareas para valores sin plantilla (hoy responden `needs_ai`). Incluye revisar qué entra en el plan sin que la persona lo acepte.

### Retención de `plan_log`
La tabla `plan_log` (migración `003_plan_log.sql`) solo crece. Hace falta la misma política que para `reports`: cuánto tiempo se guarda, y cómo se borra todo lo de un usuario cuando lo pida. Su historial no puede borrarse por el disparador: la política tendrá que decidir si el borrado es con una función aparte, en una migración.

---

## Nice to have

### Pasada de teclado y lector de pantalla (versión ligera)
Recorrer el flujo solo con teclado y con un lector de pantalla (Narrator, NVDA, VoiceOver) para comprobar que el foco se mueve de forma lógica al abrir y cerrar los popups, que Escape los cierra y que se anuncian la carga, la pregunta actual, el informe y los errores. Es la versión pequeña de la revisión completa de accesibilidad, que sí es de producción.

### Internacionalización
Hoy toda la interfaz está en inglés y los usuarios escriben en español. Consiste en separar los textos de la interfaz de la lógica y ofrecer varios idiomas, y que las preguntas y el informe salgan en el idioma del usuario.

### Etiquetas para compartir, SEO y páginas de error propias
Metadatos Open Graph para que el enlace se vea bien al compartirlo, descripción y títulos pensados para buscadores, y páginas 404 y 500 con el estilo de la web en lugar de un JSON o una pantalla del navegador.

### Analítica respetuosa con la privacidad y canal de soporte
Medir cómo se usa la web sin rastrear a las personas (herramientas que no usan cookies de seguimiento) y ofrecer una vía clara de contacto o ayuda dentro de la propia página.

### Facturación y planes, correo transaccional y onboarding
Cobro con Stripe y distintos planes, correos automáticos (bienvenida, recuperación de contraseña, avisos) y una introducción guiada para quien llega por primera vez.

### Herramientas de calidad de código
ESLint y Prettier para unificar el estilo, ganchos que los ejecuten antes de cada commit, protección de las ramas importantes (nada entra sin revisión ni tests), un CHANGELOG y versionado de las publicaciones.

### Estado del servicio, procedimientos de incidencias y objetivos de disponibilidad
Una página pública de estado, guías para actuar ante un fallo (qué mirar y a quién avisar) y objetivos medibles de disponibilidad del servicio.
