# Pendiente para fases futuras

Cosas que no pertenecen a las fases ya construidas ni a su salida a producción, pero que hay que hacer. Para lo que falta antes de publicar, y las mejoras opcionales, ver `PRODUCTION.md`.

## Las fases del proyecto

| Fase | Qué es | Estado |
|---|---|---|
| **1. Planner** | La idea, las preguntas y el informe | Hecha. Falta la prueba real con claves y la calibración (abajo) |
| **2. El plan, sin IA** | Los cuatro niveles (departamento, fase, tarea, paso) con sus reglas, la base de datos, la API, las pantallas, el esqueleto desde el informe, "Build my plan", hechos y propuestas | Cerrada. Arrastra pendientes menores (ver "Fase 2: cerrada y lo que arrastra") |
| **3. La inteligencia del plan** | Un agente por nivel (plan, departamentos con su revisión, tareas y pasos), con su evaluación y su informe | Hecha, con limitaciones conocidas. Pendiente de la verificación final del dueño (ver "Fase 3: estado final") |
| **4. Producto** | Usuarios, "View my projects", retención de datos y despliegue | Pendiente (ver `PRODUCTION.md`) |

---

## Fase 2: cerrada y lo que arrastra

La fase 2 se da por cerrada. Lo que sigue son decisiones ya tomadas y pendientes menores que no bloquean la fase 3: los supuestos sin calibrar y la verificación final se hacen después, con el plan generado por la IA.

### Funcionalidad: decisiones tomadas

**Hechas**
1. **Lo obsoleto se deja marcado.** Una propuesta pendiente cuyo hecho ya no está confirmado queda listada con la etiqueta "Obsolete" y no se puede aceptar. Se retira con "Retire", que llama a `reject` (no hay acción nueva: rechazar una propuesta ya es retirarla, y se registra como `proposal_rejected` en `plan_log`). Nada desaparece solo.
5. **Mandan las relaciones entre pasos.** `taskStatus` lee lo que los pasos de la tarea esperan de otras tareas, con el grafo del plan entero. Una tarea sin trabajo empezado cuyos pasos esperan a pasos sin hacer de otras tareas figura "blocked"; una tarea con todos los pasos "done" sigue "done". `taskElapsedDays` no cuenta esas esperas (ver "Known limitations" del README).

**Aparcadas**
2. **`feedback: "deleted"` se conserva como retirado.** Deja de contar, pero queda en el historial. *Aparcado: es bastante mayor de lo previsto y hoy no afecta a nadie. Se retoma cuando haya datos de qué retiros hacen falta.* Hoy ningún código del servidor escribe `feedback`, ni en tareas ni en pasos. Para hacerlo bien hacen falta decisiones de producto:
   - Qué acción de servidor lo escribe. Los pasos pasan por `applyPlanAction`; las tareas no tienen historial, así que harían falta dos caminos. Y el registro (`plan_log`) tiene un CHECK con sus tipos, así que una acción nueva necesita una migración.
   - Un paso retirado, ¿libera a los pasos que espera? Propuesta: sí, no bloquea ni alimenta, pero es una decisión de producto.
   - Retirar una tarea, ¿retira también sus pasos?
   - Qué se toca: estados, progreso de fases y departamentos, `readiness`, `availableActions`, tiempo transcurrido y las relaciones que apuntan a un elemento retirado (`checkPlan` no debe quedarse con referencias rotas).
   - Los obsoletos derivados de un hecho cambiado (tareas y pasos con `derivedFrom`, `derived.stale`) hoy solo aparecen en una lista de la página de decisiones, sin acción para retirarlos. Dependen de esta decisión.
3. **Edición manual mínima.** Solo lo que ya existe (acciones sobre pasos), renombrar y añadir cosas sencillas. La edición libre queda aparcada.
4. **Vista de grupos aparcada.** La ruta `#/group/:id` sigue reservada; no bloquea nada.

### Supuestos sin calibrar (aprobar, cambiar o aparcar cada uno)
- Catálogo de aspectos de dependencia entre departamentos, claves de hechos y valores de `product_type` (`department-catalog.ts`, `fact-catalog.ts`).
- Tabla de dimensión a departamento y etiquetas de regulación y capital del esqueleto (`plan-skeleton.ts`).
- Tabla de unidades del calendario, duración total por tramo, y nombres y reparto de las tres fases.
- Constantes: `WORKDAY_HOURS`, `MAX_ROUNDS`, `MAX_EVENTS`, `MAX_OUTPUTS`, `LIMITS`, `MAX_DOCUMENT_BYTES`, los límites del informe y el tope de 20 intentos de ids de propuesta.
- Significado de `blocked` en tarea y fase, y avance de la fase por número de tareas.

### Cierre y verificación
- Prueba manual en local con PostgreSQL: el plan de ejemplo, "Build my plan", decisiones y propuestas.
- Prueba real con claves y calibración de la fase 1 (abajo). Era requisito de la fase 3 (ver "Fase 3: estado final", apartado f).
- Recorrido final de punta a punta, y revisar que `README.md`, `PRODUCTION.md` y este documento dicen la verdad.
- Unificar las ramas: dejar una sola, archivar las demás y decidir si todo pasa a `main` con un pull request.
- Huecos de tests: que cada código de `FAILURE` tenga su texto en `plan.js`, y la URL de más de 16 KB (431 frente a 400).

---

## Fase 3: estado final

**Estado: hecha, con limitaciones conocidas.** Queda pendiente la verificación final del dueño (apartado f). No hay más cambios de código previstos en esta fase; lo que sigue está descrito aquí para quien lo retome.

**Rama con la fase 3 completa: `claude/phase3-final`.** Es la punta de la cadena lineal de ramas de la fase (de `faa30d9` a `b093341`, más dos commits de documentación) y la que se fusiona con la rama principal. NO incluye `claude/phase3-relevance` (`211af1e`), que queda aparte como arreglo opcional (apartado c). Las ramas anteriores (`claude/phase3-agent-contracts`, `-slice-plan`, `-slice-departments`, `-slice-steps`, `-evaluation`, `-diagnostics`, `-relations`, `-levels-eval`, `-review-eval`) son antepasadas suyas y no hace falta conservarlas por separado.

### a) Qué es y qué se hizo

- La fase 3 pone IA en cada nivel del plan. **Los agentes solo proponen; la persona acepta o rechaza.** Una respuesta nunca cambia el plan por sí sola.
- **Niveles:** el plan (la estructura: fases, nivel de cada departamento y relaciones entre departamentos); los departamentos (sus tareas, una llamada por departamento, en paralelo); la revisión (una sola sobre las tareas de todos los departamentos: choques, duplicados, huecos y órdenes que faltan); la tarea (sus pasos, bajo demanda); y el paso (la ejecución de un paso de IA, con su documento).
- **Flujo:** esqueleto fijo a partir del informe → estructura del plan → departamentos en paralelo → revisión → pasos de una tarea, cuando la persona los pide → ejecución de un paso de IA, cuando la persona la lanza.
- **Pantallas:** en Decisions, con los botones "Suggest plan structure", "Suggest tasks for all departments", "Suggest steps" (en una tarea sin pasos) y la ejecución de un paso. Las rutas están en el README.
- **Todo o nada:** si un nivel falla, no se guarda nada de ese nivel. Cada llamada se escribe en una sola operación con la versión del plan que se leyó.
- **Validar, no reparar:** cada respuesta se comprueba (esquema, referencias, `checkPlan` y la relevancia por Jev). Si no encaja, se rechaza. El servidor nunca corrige lo que devuelve el modelo.
- **Hechos de agente:** los agentes pueden proponer hechos (origen `agent`, con su nivel). Solo la persona los confirma.
- **Evaluación** (`npm run agents:eval`): corre los agentes reales sobre cuatro casos fijos (restaurante, SaaS, fisioterapia y marketplace). Modo por defecto `--mode levels`: cada nivel parte del mismo punto de partida, así que una sola ejecución muestra los fallos de todos. `--mode chain`: de punta a punta, se para en el primer fallo. Grabar y repetir: `EVAL_RECORD=1` guarda rol y respuesta (nunca prompts ni claves), y `--replay` repite sin red ni claves. Tope duro de llamadas (`EVAL_MAX_CALLS`, 100 por caso por defecto). Los informes empiezan por "Resumen por nivel" y no contienen prompts, claves ni texto crudo del modelo. Sin `AGENTS_EVAL=1` no se envía nada.
- **Modelos:** OpenAI, con el mismo endpoint y las mismas variables que la fase 1; y Jev para la relevancia.

### b) Resultados medidos con la IA real

Cifras de las ejecuciones del dueño, tal como las dio. Los nombres de modelo son los que imprime el informe y se citan solo como dato de medición.

- **Restaurante y fisioterapia:** pasan los 5 niveles.
- **Cadena completa del restaurante** (modo `chain`): pasa de punta a punta. 15 llamadas al modelo y 15 a Jev, unos 19 s.
- **SaaS y marketplace:** fallan en el nivel de departamentos con `not_relevant` de Jev. En SaaS fallan HR y Health (6 intentos); en marketplace, HR (3 intentos). Como la regla es todo o nada, un departamento irrelevante tumba el nivel entero. En esta rama, su revisión sale fallida porque se ejecuta con tareas sintéticas, no con las de los departamentos.
- **Restaurante, modo por niveles:** 10 de 10 departamentos a la primera, con 48 tareas. La revisión encontró 1 duplicado, 3 órdenes que faltaban y 2 huecos, pero dejó sin marcar duplicados evidentes: "Conduct Market Research" en Marketing, Product y Sales; proveedores en Product y Operations; y "Obtain necessary permits and licenses" en Infrastructure frente a "Obtain licences" de Legal.
- **Reintentos del nivel plan por `plan_check`:** dos casos, sin decir qué regla se rompió. En esta rama el motivo sigue siendo solo `plan_check`, sin códigos. El arreglo que añade los códigos está en `claude/phase3-relevance` (commit `211af1e`), sin medir con la IA real.
- **Flechas al revés:** dos ejecuciones seguidas pusieron tareas nuevas antes de `verify-location`, cuando debía ir antes. En esta rama el prompt no tiene ese segundo ejemplo. El arreglo está en `claude/phase3-relevance` (commit `211af1e`), sin medir con la IA real.
- **Coste de los cuatro casos:** modelo, 89.694 tokens de entrada y 21.300 de salida; Jev, 30.120 de entrada y 2.443 de salida.
- **Coste de un negocio entero:** del orden de 1 dólar con gpt-4o. **Sin verificar:** no se han comprobado los precios, y no se conoce el precio de Jev.

### c) Limitación conocida principal (el arreglo NO está implementado)

**El problema.** Con ideas de software (SaaS, marketplace), un departamento sin trabajo relevante para el negocio (HR, Health) agota sus reintentos con `not_relevant` de Jev. Como el nivel es todo o nada, el nivel de departamentos entero falla y, en el producto, el botón "Suggest tasks for all departments" da error. Es una estimación del asistente, a partir de que 2 de los 4 casos fallaron (SaaS y marketplace): podría pasar en torno a la mitad de los casos de software. **La estimación no está medida.**

**Causa probable (no confirmada):** el prompt del departamento no deja decir "nada que proponer", así que el modelo inventa tareas genéricas; y a Jev solo le llegan los títulos, sin el nombre del departamento, así que no puede saber si encajan.

**Arreglo propuesto, en cuatro partes:**
1. **Prompt de departamento:** permitir `tasks: []` (el esquema ya lo permite) y explicar el peso del departamento (`core`, `important`, `light`).
2. **Texto del juez** en `runDepartmentTasks`: incluir el nombre del departamento, además de los títulos, respetando el recorte.
3. **Relaciones:** un segundo ejemplo en el prompt, con la tarea existente antes que la nueva ("verify-location" antes de una tarea nueva de operaciones), y la instrucción de no encadenar tareas solo para listarlas. El validador no cambia.
4. **Evaluación por niveles:** la revisión pasa a "no evaluada" cuando los departamentos no produjeron propuestas, y el motivo de `plan_check` lleva los códigos de las reglas rotas.

**Hay una implementación de estos cuatro puntos en la rama `claude/phase3-relevance` (commit `211af1e`).** No está incluida en la rama final. Se puede revisar y traer si el dueño lo decide. Además de los cuatro puntos, ese commit toca `server/plan/plan-check.ts` (un ayudante `problemCodes` que solo junta y ordena los códigos de problema que ya existen; no añade códigos nuevos), `server/plan/agents/contract.ts` y `server/plan/proposals.ts` (al rechazar una propuesta por `invalid_result`, devuelve esos códigos), y `server/plan/agents/plan-agent.ts`, `department-agent.ts` y `task-agent.ts`, que los reciben como detalle del intento. Sus tests pasan con modelos falsos. **No se ha ejecutado con la IA real.**

**Decisión abierta (del dueño):** ¿un departamento irrelevante debe seguir tumbando todo el nivel (todo o nada, como ahora), o descartarse solo su propuesta, avisando? La primera opción mantiene la regla del producto. La segunda la relaja, y por eso no se ha tomado aquí.

**Cómo comparar con un modelo mejor, sin tocar código:** cambiar `OPENAI_MODEL` en `server\.env` y repetir `npm run agents:eval -- --all`. Cada ejecución crea su propia carpeta de informes, así que se pueden comparar.

### d) Otros límites conocidos y aceptados

- Los ajustes de orden de la revisión son solo texto en las notas; nunca se aplican solos.
- Una estructura no se marca como obsoleta si cambia un hecho del que salió.
- Las peticiones y preguntas de un departamento que no propone tareas se pierden.
- El límite de 240 s no cancela las llamadas en curso: se siguen pagando.
- Un plan demasiado grande se detecta después de pagar la llamada.
- Un paso que depende de otro solo ve el resumen de su salida, no su documento.
- `invalid_proposal` no se reintenta. Los ids entre propuestas pendientes de distintos departamentos solo los protegen los prefijos, sin comprobación explícita.
- La revisión detecta pocos duplicados (ver b).
- El paso pide siempre el máximo de preguntas (5 por ronda). Sin verificar.
- La confianza de lo propuesto es fija (50); el modelo no la devuelve.
- El JSON schema que se envía a OpenAI va con `strict` desactivado; la respuesta se valida de nuevo con zod.
- Algunas relaciones salen encadenadas de forma arbitraria.
- Las relaciones "feeds" entre tareas solo usan el resumen de la salida del paso.
- Un hueco ya existente: la acción genérica de paso deja aplicar `attach_output` a la persona. La pantalla no lo ofrece; cerrarlo cambia un test existente, así que se deja para una decisión aparte.
- La ejecución de un paso es síncrona, de hasta 240 s, con un indicador como único progreso.
- Los pasos no tienen una forma de regenerar solo su propuesta si cambia el hecho del que salió.
- Los tests de las rutas de pasos usan el repositorio en memoria; falta un test propio contra PostgreSQL para la escritura con dos eventos.

### e) Lo que la fase 3 no incluye (pasa a otras fases)

- Las vistas "Hoy", el panel lateral y el diagrama de dependencias: son de interfaz, y su diseño no está decidido.
- Cuentas, límites de uso y control de coste: ver `PRODUCTION.md`.
- Despliegue: ver `PRODUCTION.md`.
- Privacidad y moderación de la entrada: ver "Moderación de la entrada".
- La calibración de la fase 1: ver "Pendiente de cerrar de la fase 1".

### f) Verificación final pendiente (solo la puede hacer el dueño)

- **Prueba a mano en la app con IA real:** aceptar tareas por departamento, pedir pasos de una tarea, ejecutar un paso de IA, responder una pregunta y confirmar el resultado.
- **Tests con `TEST_DATABASE_URL`** en la rama final. En la última comprobación no estaba definida, y no se ejecutaron.
- **Los commits con una línea `Co-Authored-By` de un modelo: DECIDIDO, se dejan como están.** El dueño lo ha resuelto ("da igual"): no se reescribe la historia y no hay nada pendiente. Dentro de la fase 3 son tres (`485ff69`, `2cba54e`, `4d57b9c`; se comprueba con `git log faa30d9..b093341 --format='%h %s' --grep='Co-Authored-By: Claude [A-Z]'`, que no incluye `faa30d9`, el cierre de la fase 2, que también la lleva).
- **La decisión sobre la relevancia** (apartado c), incluida la de traer o no el commit `211af1e`.
- **Las ejecuciones de evaluación con la IA real** con los cambios de la última revisión: la fila `review` del "Resumen por nivel", las expectativas y los motivos de cada fallo.

### Historial de las entregas (consolidado)

#### Contratos, estructura, departamentos y pasos

- **Contratos (P11).** Pipeline común (`plan/agents/contract.ts`): esquema, copia del plan revisada con `checkPlan`, juez de relevancia (Jev) y conversión a propuestas con `createProposal`. Hasta 3 intentos (`MAX_AGENT_ATTEMPTS`), solo para errores que un nuevo intento puede arreglar. Si todos fallan, un error tipado y nada guardado. Niveles: plan (`plan-agent.ts`: generar y revisar), departamento (`department-agent.ts`: una llamada por departamento, en paralelo, todo o nada; los ids llevan el prefijo del departamento), tarea (`task-agent.ts`: pasos, cada uno por `StepSchema`) y paso (`step-runner.ts`). Modelo real: `openai-model.ts` (mismo endpoint y variables que la fase 1) y `jev-judge.ts` (reutiliza `callJev`). Los tests nunca llaman a un modelo.
- **Script manual** (`server/scripts/real-plan-agent.ts`, `npm run agents:real-plan`): sin `AGENTS_REAL=1` no envía nada; con él, una sola llamada a OpenAI sobre el plan del restaurante, y Jev solo con `AGENTS_JEV=1`.
- **Decisiones de los contratos que siguen vigentes:** la confianza de lo propuesto es fija (50); el JSON schema va con `strict: false`, y la respuesta se valida de nuevo con zod (el schema es una pista, no la puerta); el script manual deja `checked: false` si no se pide Jev; los ids de los contratos usan `IdSchema` de `plan-model.ts`.
- **Primera rebanada (la estructura en pantalla).** Botón "Suggest plan structure", que solo se pulsa a mano. Propuesta de fases, cambios de tier y relaciones entre departamentos; peticiones y preguntas son texto de solo lectura. Aceptar la aplica entera y comprueba el plan otra vez; rechazar no cambia nada. Ruta `POST /api/plan/:id/agents/structure`, síncrona. Límites compartidos en `STRUCTURE_LIMITS`.
- **Segunda rebanada (los departamentos en pantalla).** Botón "Suggest tasks for all departments". Ruta `POST /api/plan/:id/agents/departments`: una llamada por departamento sin propuesta pendiente (como mucho 5 a la vez), y después una revisión del nivel plan sobre todas las tareas. Todo o nada, en una sola escritura. Límite de 240 s para todo, por debajo de los 300 s que Node da a una petición. Cada departamento ve solo la idea, los hechos confirmados, sus propias tareas, las salidas confirmadas que le alimentan y sus relaciones de orden. Las propuestas se aceptan o rechazan por departamento, con notas de solo lectura (peticiones, preguntas y hallazgos). Un fallo corregido: una propuesta pendiente de un departamento ya no bloquea a otro que cite el mismo hecho.
- **Tercera rebanada (los pasos en pantalla).** "Suggest steps" en una tarea sin pasos, solo al pulsarlo. Ruta `POST /api/plan/:id/agents/tasks/:taskId/steps`: una llamada, hasta tres intentos (con Jev en cada uno), dentro de los 240 s; las comprobaciones baratas van antes. Tarjeta "Steps for <tarea>" en Decisions. Ejecución de un paso (`POST /api/plan/:id/agents/steps/:stepId/run`, con `launch` o `answer`): la acción de la persona, la salida de la IA y sus hechos, en una escritura con dos eventos. Si algo falla, el paso queda como estaba.
- **El documento solo en la última versión.** Al adjuntar una ronda nueva, las anteriores conservan resumen, preguntas y peticiones, pero pierden el documento. Motivo: el plan es un único JSON de 5 MiB como máximo (`MAX_DOCUMENT_BYTES`). Límite de 8.000 tokens por petición del paso; una respuesta cortada por ese límite es un fallo, no un documento parcial.

#### Evaluación de los agentes

Esta parte es el historial detallado de la evaluación. Cada apartado se conserva tal como se escribió, con sus cifras.

**Diagnóstico de fallos (hecho).** La primera ejecución real (caso restaurante) falló en el nivel de departamentos con `invalid_output`: 26 llamadas al modelo y solo 2 a Jev. Ocho de los diez departamentos agotaron sus tres intentos. La causa: el servidor exige que cada id de tarea empiece por el id de su departamento (`legal-…`), para que dos departamentos nunca propongan el mismo id, pero el prompt no se lo decía al modelo, que propuso ids naturales (`obtain-licences`). Los tests con modelos falsos no lo vieron porque el falso ya devolvía ids con prefijo. Además, el informe solo decía `invalid_output`, sin la regla que lo causó.

Lo que se hizo para que no vuelva a pasar:
- **Prompts alineados con los validadores.** Cada prompt de los cuatro niveles de agentes y del paso dice las reglas que el código comprueba (prefijos de ids, ids de fase, ids de hechos copiados tal cual, catálogo de hechos y de aspectos, destino de las peticiones, bucles, orden entre fases). Un test por nivel comprueba que la instrucción está en el prompt. Dos prompts recibían datos que no podían cumplir la regla y ahora los reciben: el paso recibe la lista de ids de departamento (`<departments>`) y la revisión del plan recibe las relaciones ya existentes (`<plan_relations>`).
- **Relaciones con tareas que ya existen.** La segunda ejecución real (restaurante, con el prompt de departamentos ya corregido) falló en el nivel de departamentos: dos departamentos agotaron sus tres intentos y uno necesitó reintento, todos con `relation_ref`. La regla era que una relación solo podía unir tareas nuevas de la misma respuesta, y el modelo quería ordenar sus tareas nuevas respecto a las que el departamento ya tenía. Los tres casos eran departamentos con tareas en el esqueleto (de los cinco que tienen tareas previas, tres fallaron; los cinco sin tareas previas pasaron todos a la primera). Ahora una relación puede unir una tarea nueva con una tarea de `<own_tasks>` (usando su id tal cual), pero nunca dos tareas ya existentes (`relation_existing_only`) ni una tarea de otro departamento (`relation_ref`). El prompt lo dice con un ejemplo. La relación se guarda en la propuesta y se vuelve a comprobar al aceptar, con las mismas reglas de `checkPlan`. Lo que no se ha medido: si el modelo usa la regla bien en una ejecución real (lo decide la siguiente evaluación).
- **Motivo de cada intento fallido.** Cada fallo de validación tiene una etiqueta fija (`schema`, `id_prefix`, `phase_unknown`, `fact_unknown`, `relation_ref`, `relation_existing_only`, `task_ref`, `fact_catalog`, `request_target`, `step_rules`, `structure`, `plan_check`, `model_error`, `relevance`, `judge_unavailable`, o el código de la propuesta que se rechazó). Con `onFailure` (opcional) cada intento fallido se entrega con su nivel, su número y su etiqueta. Los errores del esquema llevan solo los caminos y códigos de Zod, nunca valores. El resultado público de cada nivel no cambia: sigue siendo `{ ok: false, code }`, porque más de treinta tests comparan ese objeto entero.
- **El informe lo muestra.** Por nivel: los intentos fallidos y su recuento por motivo. En departamentos: cuántos pasaron a la primera, cuántos necesitaron reintentos y los ids de los que fallaron del todo. Sin prompts, claves ni texto del modelo.

Si el arreglo de los prompts no bastara (el modelo sigue sin poner el prefijo), la siguiente opción sería que el servidor añadiera el prefijo él mismo. No se hace ahora por dos razones: el modelo se corregiría sin que nadie lo viera (el informe dejaría de mostrar el fallo), y la regla del producto es que las respuestas se validan, no se reparan. Primero se mide con el informe si el prompt basta.

**Auditoría de validadores (hecha, fase 3).** Lección de los tres fallos reales: cada uno era un validador más estricto de lo que un modelo sensato hace. Un modelo que sigue el prompt propone ids naturales, ordena sus tareas respecto a las que ya tiene, y no puede nombrar una tarea cuando el hallazgo es un hueco. Los modelos falsos de los tests siempre devuelven respuestas que ya cumplen las reglas, así que no lo detectan. Por eso cada validador se audita contra lo que un modelo sensato hace, no contra lo que el código dice que quiere, y las respuestas realistas (las imperfectas, pero plausibles) van en un catálogo con su resultado esperado (`server/test/plan/agents/realistic-answers.test.ts`). El servidor valida; no repara.

Cambios que salieron de la auditoría:
- **La revisión del plan acepta un hueco sin tarea.** Un hallazgo `gap` lleva `taskIds: []`; `clash`, `duplicate` y `missing_order` siguen exigiendo al menos una tarea. El prompt lo dice, y el reparto de notas manda el hueco a la primera propuesta (con test).
- **El título de una tarea de departamento tiene el límite del plan (200).** Antes el agente aceptaba 300 y el servidor rechazaba después (`invalid_proposal`), sin reintento. Ahora el esquema rechaza a 200 y se reintenta.
- **Los prompts dicen los límites que ya se cumplen:** ids de 64 caracteres, título de 200, esfuerzo hasta 1000 horas y espera hasta 3650 días; "si dudas, cita el hecho más relevante" (la cita es obligatoria y el servidor ya exige un hecho confirmado antes de llamar); y "devuelve solo los campos descritos" (el esquema sigue siendo estricto: un campo extra se rechaza, no se borra).

Tabla de la auditoría (agente · restricción · ¿puede un modelo sensato incumplirla? · qué se hizo):

| Agente | Restricción | ¿Un modelo sensato puede incumplirla? | Qué se hizo |
| --- | --- | --- | --- |
| Plan, generar | `phases` mínimo 1 | No: debe conservar todas las fases | Mantener (caso `plan-no-phases`) |
| Plan, generar | Máximos de fases, niveles, relaciones, hechos, peticiones, preguntas (40, 5, 5) | Raro | Mantener; decisión del dueño |
| Plan, generar | Texto de 300 caracteres | Sí, en respuestas verbosas | Mantener (tamaño máximo); decisión del dueño |
| Plan, generar | Nombre de fase de 120 caracteres | Raro | Mantener; decisión del dueño |
| Plan, generar | Ids en minúsculas, ids de departamento y de fase existentes | No: el prompt las lista | Mantener |
| Plan, generar | Relación de departamento con origen distinto del destino y aspecto del catálogo | No | Mantener |
| Plan, generar | Relación duplicada o con bucle (`checkPlan`) | Raro | Mantener; `checkPlan` no se toca |
| Plan, generar | Campos extra (esquema estricto) | Sí, puede añadir un campo | Prompt: "devuelve solo los campos descritos". Esquema sin cambios |
| Plan, revisar | `taskIds` mínimo 1 en cada hallazgo | **Sí: un hueco no nombra tarea** | **Cambiado** (Parte 1): `gap` puede ir vacío; el resto exige 1. Prompt y tests |
| Plan, revisar | `taskIds` máximo 10, hallazgos máximo 20, ajustes máximo 10 | Raro | Mantener (casos `review-eleven-tasks`); decisión del dueño |
| Plan, revisar | Referencias a tareas inexistentes y ajustes a sí mismo o repetidos | No | Mantener (`task_ref`, `relation_ref`) |
| Departamento | Ids con el prefijo del departamento | No, si el prompt lo dice (regresión 1) | Mantener (`id_prefix`) |
| Departamento | Id de 64 caracteres como máximo | Sí, en ids largos | Prompt lo dice. Esquema sin cambios |
| Departamento | Título de 300 caracteres en el esquema, 200 en el plan | **Sí: se rechazaba tarde y sin reintento** | **Cambiado**: el esquema usa `MAX_TITLE` (200); prompt lo dice |
| Departamento | `derivedFrom` mínimo 1 | Sí, si no encuentra cita. El servidor ya exige un hecho confirmado (`no_confirmed_facts`) | Mantener (la propuesta necesita un motivo). Prompt: "si dudas, cita la más relevante" |
| Departamento | Relación nueva↔nueva o nueva↔tarea propia (regresión 2) | No | Ya cambiado antes; mantener (`relation_existing_only`, `relation_ref`) |
| Departamento | Hechos citados dentro de los 50 más recientes | No: el modelo ve esa misma lista | Mantener (`fact_unknown`) |
| Departamento | Máximos de tareas (20) y relaciones (30) | Raro | Mantener; el prompt los dice |
| Departamento | Hechos del catálogo (clave e id) | No: el prompt lista el catálogo | Mantener (`fact_catalog`) |
| Departamento | Campos extra (esquema estricto) | Sí | Prompt. Esquema sin cambios |
| Tarea | Máximos de pasos (60) y relaciones (120) | Raro | Mantener; el prompt los dice |
| Tarea | Id de paso con el prefijo de la tarea | No | Mantener (`id_prefix`) |
| Tarea | Id de paso de 64 caracteres como máximo | Sí, en ids largos | Prompt lo dice |
| Tarea | Horas hasta 1000 y días hasta 3650 | Raro, pero el prompt no lo decía | Prompt lo dice. Límites sin cambios; decisión del dueño |
| Tarea | `derivedFrom` mínimo 1 | Igual que en departamento | Prompt: "si dudas, cita la más relevante" |
| Tarea | Usuario con modo, IA sin modo, `accepted_output` solo para IA (`step_rules`) | No: el prompt lo dice | Mantener |
| Tarea | `feeds` solo desde un paso de IA | No: el prompt lo dice | Mantener (`invalid_result`, caso `task-feeds-from-user`) |
| Paso | Resumen de 1000 caracteres | Sí, si es verboso | Mantener; decisión del dueño |
| Paso | Documento no vacío (mínimo 1) | No: el prompt dice que no esté vacío | Mantener |
| Paso | Documento de 20000 caracteres | Sí, en documentos largos | Mantener (lo que cabe en un resultado); decisión del dueño |
| Paso | Hasta 5 preguntas de 300 caracteres | Sí, si quiere preguntar más | Mantener (validar, no recortar); decisión del dueño |
| Paso | Peticiones solo a `plan` o a un departamento conocido (`request_target`) | No | Mantener |
| Paso | Campos extra (esquema estricto) | Sí | Prompt. Esquema sin cambios |

Hallazgos que no se tocaron y quedan para decidir:
- **Ids entre propuestas pendientes.** `createProposal` (proposals.ts) comprueba los ids contra las tareas y pasos del plan y contra las propuestas, pero no contra las tareas de otras propuestas pendientes. Hoy los prefijos por departamento y por tarea lo evitan, pero no hay una comprobación explícita.
- **`invalid_proposal` no se reintenta.** `RETRYABLE` (contract.ts) no lo incluye, así que un fallo de la propuesta termina en el primer intento. El cambio del título era el caso práctico; el resto de códigos de la propuesta se mantiene igual.

**Primera evaluación real por niveles (fase 3, revisión).** El caso restaurante pasó plan, departamentos (10 de 10 a la primera), tareas y pasos. La revisión falló tres veces con `not_relevant`. La causa estaba en la evaluación y en el texto del juez, no en el modelo: la revisión leía tareas sintéticas ("Revisar el trabajo de …") que no tienen nada que ver con un restaurante, y a Jev le llegaba cada hallazgo como "tipo: texto" sin los títulos de las tareas que nombra. Lo que se hizo:
- **Jev recibe los títulos.** Cada hallazgo llega con los títulos de las tareas que nombra, entre corchetes; un hueco (`gap`) solo lleva su texto. Afecta también a la revisión de producción, que usa la misma función.
- **La revisión lee lo que propusieron los departamentos de la misma ejecución.** Si ninguno propuso tareas, usa las sintéticas, y el informe dice cuál de las dos fuentes usó. El resultado de la revisión no depende de que los departamentos pasen: siempre se ejecuta.
- **El informe cuenta la revisión.** Hallazgos por tipo, ajustes, y para cada hallazgo el tipo y los títulos de las tareas que nombra (un hueco se marca "sin tarea"). El texto libre del hallazgo nunca se escribe.
- **Las comprobaciones cuentan las tareas del esqueleto.** La expectativa de licencias del restaurante y la de titulación de fisioterapia las cumplía ya el esqueleto ("Obtain licences"), así que se sustituyeron por expectativas que exigen trabajo de la IA. Las otras dos ya no las cumple el esqueleto.
- **Las relaciones entre departamentos salen del nivel de plan.** Antes el informe decía "ninguna" en el modo por niveles.

Lección: **una revisión no se puede juzgar sobre tareas inventadas, y el juez necesita el contexto de lo que mira.** Si el juez solo ve el tipo de hallazgo, no puede decir que encaja, y eso parece un fallo del modelo cuando es de la evaluación. Antes de culpar a un nivel, hay que comprobar que recibe lo que debe. Lo que no está probado: que la revisión con tareas reales encuentre de verdad los duplicados que hay (Conduct Market Research, proveedores, licencias); eso lo dirá la siguiente evaluación real.

---

## Pendiente de cerrar de la fase 1

Tres comprobaciones con las APIs reales que se dejaron aparcadas para poder avanzar. No cambian la estructura de los datos, así que la fase siguiente puede construirse encima; pero hay que hacerlas.

### 1. Ejecución completa con claves reales
**Qué es.** Un análisis de principio a fin (idea, preguntas, informe) con Jev y OpenAI de verdad, tras la llegada de los trabajos asíncronos y de la validación en ejecución.
**Por qué.** Es lo único que no se ha ejercitado con los dos cambios juntos. El riesgo concreto es que el esquema de validación (Zod) sea más estricto que lo que OpenAI devuelve en realidad: los tests pasarían, pero el flujo real fallaría con "The phase 2 analysis returned no usable result".
**Si falla.** El log del servidor indica qué campo no cumplía el esquema (rutas y códigos, sin valores).

### 2. Calibración
**Qué es.** Ejecutar casos reales y comprobar que los umbrales dan resultados razonables. Los umbrales son estimaciones sin datos: el límite de dos preguntas (`POLICY` en `question-policy.ts`), el 50 % de respaldo y de coherencia, y los cortes Core/Important/Light (en `planner-validation-handler.ts`).

| Caso | Qué esperar |
|---|---|
| "Una app" (sliders bajos) | 1 pregunta; casi todo sin definir |
| SaaS para gestión de restaurantes | 2-3 preguntas |
| Fisioterapia a domicilio | Pregunta si eres fisioterapeuta; no repite lo del formulario |
| Plataforma de IA de facturación con prototipo y usuarios de prueba | 3-4 preguntas; no pregunta lo que ya se dijo |
| Marketplace donde la plataforma gestiona los pagos | `money_handling` detectado y `regulatory_load` alto |
| App de suscripción para clínicas dentales con MVP, Stripe y regulación explícitos | Muchas dimensiones definidas |

**Qué anotar en cada caso** (el JSON final se ve en la pestaña Network): número de preguntas y si son específicas de la idea; dimensiones sin definir; datos sin respaldo y avisos "Worth checking"; áreas Core, Important y Light; tiempo total.
**Qué ajustar.** Si casi todo sale Core, subir el corte de Core. Si casi todo sale sin respaldo o con avisos, bajar el 50 %. Si una idea vaga recibe demasiadas preguntas, bajar la base de la madurez.
**Relación con lo que viene.** Esto es la primera ejecución manual de la evaluación de modelos descrita más abajo.

### 3. Ruta de cero preguntas
**Qué es.** Cuando OpenAI no devuelve preguntas, el servidor calcula el perfil y la validación en la primera respuesta y el front salta directamente al informe, sin popup ni petición final. Casi nunca ocurre de forma natural (el prompt solo le pide lista vacía cuando las respuestas dadas bastan, y en la primera ronda no hay ninguna), así que hay que forzarla.
**Cómo.**
1. En `server/server.ts`, dentro de `runPlanner`, sustituye la llamada a `selectQuestions(...)` por `const questions: typeof phase2.questions = [];` (`npm run dev` recarga solo).
2. Envía una idea cualquiera con los sliders tocados.
3. Revierte: `git checkout -- server/server.ts`. No lo subas a la rama.
**Qué comprobar.**
- En pantalla: el loader gira, no aparece ningún popup, el loader se desvanece, el texto de fondo sube y el informe aparece con su fundido, sin ver ni un instante la página inicial.
- En Network: un único POST (202) y las consultas GET, ninguna petición con `final: true`; el resultado trae `phase2` con `questions: []`, más `profile` y `validation`, y no trae `questionTotal`.
- En el informe: la fila "Business" aparece, hay muchas dimensiones sin definir, "Still to define" tiene contenido, y "See full detail", "Start over" y "Build my plan" funcionan.
- En la terminal del servidor: sin errores. Después, un envío normal (sin el cambio temporal) sigue funcionando.
**Cobertura de test.** Esta rama no tiene ningún test automático. Cuando se añadan los tests de integración de producción, uno debe simular a OpenAI devolviendo `questions: []` y comprobar que la respuesta trae `profile` y `validation`.

---

## Evaluación de modelos

**Qué es.** Un sistema repetible para medir la calidad de lo que devuelven Jev y OpenAI. Consiste en un conjunto fijo de ideas de prueba (empezando por los 5 ejemplos de la calibración y creciendo hasta 30-50) con el resultado esperado de cada una, que se ejecuta automáticamente cada vez que cambia un prompt, un modelo o un umbral.

**Por qué.** El valor del producto depende de lo que devuelven los modelos, y eso cambia sin tocar el código: una versión nueva de un modelo, un retoque de un prompt o un umbral distinto. Sin una medida, no se detecta que algo empeoró.

**Qué se mide.**
- Número de preguntas por idea (y que crezca con la madurez de la idea).
- Porcentaje de dimensiones sin definir (una idea vaga debe dejar casi todo sin definir; una completa, casi nada).
- Porcentaje de datos marcados sin respaldo.
- Casos concretos esperados (por ejemplo, "si la idea menciona Stripe, `money_handling` es cobro mediante proveedor").
- Coste y latencia por análisis.

**Relación con lo ya hecho.** La calibración con APIs reales que se hace al cerrar la fase 1 es la primera ejecución manual de esto; aquí se convierte en algo automático y permanente.

**Falta.**
- **Comparar dos ejecuciones.** Hoy cada informe es independiente. Hace falta un comando que compare dos JSON (antes y después de cambiar un prompt o un modelo) y marque lo que empeoró.
- **Crecer a 30-50 casos.** Hoy son cuatro. Hay que añadir los cinco ejemplos de la calibración de la fase 1 y casos de cada sector.
- **Revisión humana de la dirección de las flechas.** Las relaciones entre departamentos y entre tareas se imprimen en lenguaje natural, pero no se pueden comprobar automáticamente: que "A debe estar antes que B" sea lo correcto lo decide una persona.
- **Comprobaciones más fuertes.** Las expresiones regulares detectan un tema ausente, no un mal plan. Con más casos convendrá una revisión humana por caso o un juez dedicado.
- **Tokens sin dato.** Si OpenAI o Jev no envían el recuento de tokens, el informe lo marca como "sin dato" y el coste queda por debajo de lo real. Jev no expone el código de estado de sus errores (`callJev` no lo devuelve), así que sus fallos se registran sin código.
- **La fase 1 se evalúa aparte.** Este sistema mide los agentes de la fase 3; el análisis de Jev y OpenAI de la fase 1 tiene su propia medida (la calibración de arriba).
- **Ejecución manual.** No corre en CI: cada ejecución cuesta dinero y la decide la persona que la lanza.

---

## Moderación de la entrada

**Qué es.** Revisar el texto del usuario antes de usarlo, por dos motivos distintos.

1. **Contenido abusivo o ilegal** (odio, violencia, negocios fraudulentos, contenido sexual con menores). El producto lo procesaría y, además, los proveedores pueden suspender la cuenta por incumplir sus normas. OpenAI ofrece un servicio gratuito de moderación que clasifica el texto antes de usarlo; si se marca, se rechaza con un mensaje y no se gasta en el análisis.
2. **Inyección de prompt** (por ejemplo, "ignora tus instrucciones y haz X"). Hoy está mitigada en parte: el texto va delimitado dentro de los prompts, hay límites de longitud y OpenAI responde con un esquema estricto. Falta detectar los intentos y registrarlos.

**Qué incluye también.** Un aviso visible de que el análisis es orientativo y no sustituye asesoría profesional, y un registro de los rechazos (la categoría, no el contenido).

---

## Siguiente fase del producto: "Build my plan"

> **Nota.** El botón "Build my plan" ya crea un plan real desde el informe guardado por el servidor (fase 2, ver `README.md`). El texto de esta sección es el planteamiento original. La generación con IA se hizo en la fase 3 (ver "Fase 3: estado final"); lo que sigue pendiente de aquí es la saturación del plan.

**Qué es.** La fase que genera el plan de ejecución a partir del informe. Hoy el botón "Build my plan" solo hace la animación (el loader aparece, el informe se va y, a los tres segundos, vuelve con un aviso de que aún no está disponible). El código tiene un `// TODO` donde irá la petición real.

**Datos que ya se generan para esta fase.** El análisis de OpenAI produce, y hoy no se muestra, la ubicación, el cliente objetivo, la propuesta de valor, el modelo de ingresos, la etapa, la competencia y las restricciones (rango de presupuesto necesario y si el presupuesto dado alcanza, exclusiones, riesgos y supuestos), cada sección con su origen (dicho o inferido) y su confianza. Se mantienen en el análisis precisamente para que esta fase los use.

**Qué hay que decidir.** Qué datos recibe (el informe completo, el perfil, la validación y las respuestas del usuario), qué devuelve y cómo se muestra. Encajará con el tiempo de respuesta como un trabajo asíncrono, igual que el análisis actual.

### ¿Guardar el análisis o pasarlo directamente a "Build my plan"?

**Decisión.** En el producto final el análisis se guarda; pero la primera versión de "Build my plan" puede recibirlo directamente, siempre que se diseñe para cambiar después el origen de los datos sin cambiar cómo se usan.

**Pasarlo directamente (sin guardar).** El front ya tiene en memoria el análisis, el perfil y la validación, y los manda en la petición del plan, como ya se hace con las afirmaciones del análisis en la petición final.
- A favor: no necesita base de datos ni usuarios, y funciona ya.
- En contra:
  - Integridad: el servidor recibe datos que vienen del cliente y podrían estar alterados. Solo afecta al plan del propio usuario, pero hay que validarlos con esquema y límites de tamaño.
  - Se pierde al recargar: el informe vive en la memoria de la página, y repetir el análisis cuesta más de un minuto y varias llamadas de pago.
  - Impide "View my projects", reanudar, regenerar el plan o comparar versiones.

**Guardarlo.** El servidor guarda el análisis completo con un id de proyecto y "Build my plan" solo manda ese id.
- A favor: datos de confianza (el servidor lee lo que él mismo calculó); se puede reanudar tras recargar o volver otro día; permite varios planes sobre el mismo análisis, "View my projects" y el desbloqueo de frentes por progreso; ahorra dinero al no repetir un análisis ya pagado; sirve de base para la evaluación de modelos con casos reales.
- En contra: necesita base de datos y autenticación (para saber de quién es cada proyecto) y obliga a cumplir con la privacidad: las ideas de negocio son información confidencial, hay que pedir consentimiento, fijar cuánto se conservan y permitir borrarlas.

**Opción intermedia.** El servidor ya guarda en memoria el resultado de cada trabajo (`JobStore`, 10 minutos). "Build my plan" podría mandar solo el `jobId` del análisis y el servidor leerlo de ahí: datos de confianza sin base de datos. Es una solución provisional: la caducidad es de 10 minutos y se pierde al reiniciar, así que habría que alargarla.

**Plan recomendado.**
1. Diseñar ya un "paquete de proyecto" con una versión de esquema (`ProjectSnapshot`): idea, sliders, respuestas, análisis de OpenAI, perfil, validación y resultado de Jev. Es el contrato entre el análisis y el plan.
2. Primera versión: "Build my plan" recibe ese paquete directamente, validado con Zod y con tope de tamaño.
3. Con la base de datos: se guarda el mismo paquete y el plan pasa a recibir solo el id. Como el contrato ya es el paquete, el cambio es de dónde sale, no de cómo se usa.

**Señal de que hay que guardarlo.** Hoy el servidor olvida el análisis de OpenAI entre la primera petición y la final, y es el front quien se lo devuelve. Es una pista de que, a medio plazo, ese estado debe vivir en el servidor.

**Pendiente de decidir con la base de datos.** Qué se guarda exactamente (por ejemplo, si se conservan las respuestas en bruto de los proveedores o solo el resultado), cuánto tiempo y con qué consentimiento.

### Saturación del plan: cuánto mostrar y cuánto hacer a la vez

**Qué es.** Adaptar el plan a la capacidad de la persona. Una persona sola con pocas horas necesita ir poco a poco (por ejemplo, 2 áreas activas y el resto desbloqueándose); un equipo grande con dinero y experiencia prefiere la imagen completa del proyecto. Son dos cosas distintas que hay que separar: cuánto se **muestra** (revelado progresivo) y cuánto se **hace a la vez** (límite de frentes en curso).

**Datos que ya existen.**
- Del formulario: equipo, horas por semana, años en el sector y presupuesto.
- Del perfil de Jev: `team_requirement`, `capital_intensity`, `time_to_revenue`, `deadline_rigidity`, `founder_profile` y `validation_stage`.
- De la validación: los avisos `budget_fit`, `team_fit` y `experience_fit`, y el peso de cada área (Core, Important, Light).
- `departmentLevel` ya aplica una versión simple de la misma idea (6 grupos o 10 departamentos según el tamaño); la capacidad la generalizaría y ambas deben compartir la misma noción de tamaño para no contradecirse.

**Tres capas independientes (decisión de diseño).** Una capacidad fija calculada a partir del formulario trataría como un hecho algo que es una estimación y una preferencia. Por eso se separa en:
1. **Capacidad estimada (el sistema).** Cuánto trabajo puede absorber la persona, calculado con los datos del formulario. Solo es un punto de partida.
2. **Preferencia (el usuario).** Cuánto quiere ver: todo abierto o paso a paso. Siempre manda sobre la capacidad. La capacidad solo sugiere el valor por defecto, y un control visible ("Guiado" frente a "Ver todo") permite cambiarlo en cualquier momento.
3. **Ritmo real (la evidencia).** Lo que el usuario demuestra al usar el plan: cuántos frentes cierra y en cuánto tiempo.

**Cómo estimar la capacidad.**
- Horas-persona a la semana = personas del equipo por horas de dedicación. Conversión aproximada: "Solo" 1, "Small (2-3)" 2,5, "Medium (4-10)" 7, "Large (10+)" 12; "Under 10 h" 6, "10-20 h" 15, "30+ h" 30, "Full time" 40.
- Tramos de horas-persona que dan el número de frentes simultáneos (por ejemplo 2, 3, 5 o todos).
- El resultado es un **rango** (por ejemplo, 2-3 frentes), no un número único, y el modo por defecto se escoge con holgura para que un cambio pequeño en un dato no cambie la experiencia de golpe.
- Una función pura en el servidor, como `questionLimit`, con constantes en un solo sitio y tests de fronteras. Devuelve `{ rango de frentes, modo sugerido, motivos }`.

**La experiencia afecta a la velocidad, no solo a la capacidad.** Una persona con experiencia no necesita menos frentes: los cierra antes y por eso se desbloquean antes. Se modela como un factor sobre la duración esperada de cada frente, que baja con los años en el sector y con el perfil de fundador que encaja con esa área (un perfil técnico cierra Tecnología más rápido que Legal). El presupuesto alto permite delegar o contratar, y suma en el mismo sentido.

**Orden y desbloqueo.**
- Orden de las áreas: por peso (Core, Important, Light), con las básicas siempre presentes (Legal, Finanzas, Crecimiento) y teniendo en cuenta dependencias (por ejemplo, producto antes que captación en algo que aún no existe).
- Modo guiado: se activan las primeras áreas y el resto aparece como "A continuación", bloqueadas, con un contador ("2 de 6 áreas activas"). Modo panorámico: todas visibles, con orden y dependencias, quizá como línea de tiempo.
- Desbloqueo: manual (el usuario marca un área como terminada), por tiempo (el plan se reparte en semanas) o híbrido (por tiempo, con posibilidad de adelantar). Se recomienda el manual, atado a "View my projects".
- **Aprender del ritmo real:** cuando exista progreso guardado, el sistema ajusta. Si alguien cierra tres frentes en una semana con una capacidad estimada de 2, se liberan más; si lleva semanas sin cerrar ninguno, se le propone reducir. La estimación inicial solo cubre el arranque.

**Cosas que cuidar.**
- No ocultar nada crítico: los avisos de regulación, presupuesto o contradicciones se muestran siempre, aunque el área esté bloqueada.
- Cambiar de modo no pierde nada.
- Explicar el porqué con un mensaje corto ("Te mostramos 3 áreas porque trabajas a medio tiempo en solitario; puedes ver todo cuando quieras").
- Si el negocio pide más de lo que la persona tiene (por ejemplo, un equipo en solitario con `team_requirement` grande), repartir en frentes no lo arregla: avisar de que el alcance no cuadra con los recursos y proponer reducirlo.
- Plazo fijo con poca capacidad es una contradicción que merece su propio aviso.

**Qué necesita antes.** La fase del plan, que es lo que se muestra u oculta. El desbloqueo manual y el ajuste por ritmo real necesitan autenticación y base de datos. Lo que se puede adelantar sin nada de eso es la función de capacidad (con rangos y factor de experiencia) y su batería de tests.

**Advertencia.** Los tramos y las conversiones de horas son estimaciones sin datos reales; se calibran con el uso, igual que la política de preguntas.

---

## "View my projects"

**Qué es.** La pantalla con los análisis guardados de cada usuario. Hoy el botón solo muestra un aviso de que no está disponible.

**Qué necesita antes.** Autenticación y base de datos (ver `PRODUCTION.md`), porque no se pueden listar proyectos sin saber de quién son ni sin haberlos guardado.

## Fase 4: pendiente del registro y el inicio de sesión

Lo que la fase 4 deja fuera a propósito. La recuperación y la verificación necesitan enviar correos, y la fase no envía ninguno. Los botones y el enlace se quedan visibles, sin función, por decisión del dueño.

- **Recuperar contraseña ("Forgot password?").** El enlace sigue en el diálogo de inicio de sesión pero no hace nada. Se hará con el envío de correos.
- **Entrar con Google.** Los botones de Google siguen en los dos diálogos pero no hacen nada.
- **Verificar el email.** Hoy quien se registra entra directamente. La columna `email_verified_at` existe y se queda sin usar.
- **Foto de perfil.** El círculo de perfil muestra solo la inicial.
