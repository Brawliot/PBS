# Pendiente para fases futuras

Cosas que no pertenecen a la fase 1 ni a su salida a producción, pero que hay que hacer en siguientes fases. Para lo que falta antes de publicar la fase 1, ver `PRODUCTION.md`.

---

## Pendiente de cerrar de la fase 1

Tres comprobaciones con las APIs reales que se dejaron aparcadas para poder avanzar. No cambian la estructura de los datos, así que la fase siguiente puede construirse encima; pero hay que hacerlas.

### 1. Ejecución completa con claves reales
**Qué es.** Un análisis de principio a fin (idea, preguntas, informe) con Jev y OpenAI de verdad, tras la llegada de los trabajos asíncronos y de la validación en ejecución.
**Por qué.** Es lo único que no se ha ejercitado con los dos cambios juntos. El riesgo concreto es que el esquema de validación (Zod) sea más estricto que lo que OpenAI devuelve en realidad: los tests pasarían, pero el flujo real fallaría con "The phase 2 analysis returned no usable result".
**Si falla.** El log del servidor indica qué campo no cumplía el esquema (rutas y códigos, sin valores).

### 2. Calibración
**Qué es.** Ejecutar casos reales y comprobar que los umbrales dan resultados razonables. Los umbrales son estimaciones sin datos: el límite de preguntas por madurez y los ajustes por compromiso (`POLICY` en `question-policy.ts`), el 50 % de respaldo y de coherencia, y los cortes Core/Important/Light (en `planner-validation-handler.ts`).

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

---

## Moderación de la entrada

**Qué es.** Revisar el texto del usuario antes de usarlo, por dos motivos distintos.

1. **Contenido abusivo o ilegal** (odio, violencia, negocios fraudulentos, contenido sexual con menores). El producto lo procesaría y, además, los proveedores pueden suspender la cuenta por incumplir sus normas. OpenAI ofrece un servicio gratuito de moderación que clasifica el texto antes de usarlo; si se marca, se rechaza con un mensaje y no se gasta en el análisis.
2. **Inyección de prompt** (por ejemplo, "ignora tus instrucciones y haz X"). Hoy está mitigada en parte: el texto va delimitado dentro de los prompts, hay límites de longitud y OpenAI responde con un esquema estricto. Falta detectar los intentos y registrarlos.

**Qué incluye también.** Un aviso visible de que el análisis es orientativo y no sustituye asesoría profesional, y un registro de los rechazos (la categoría, no el contenido).

---

## Siguiente fase del producto: "Build my plan"

**Qué es.** La fase que genera el plan de ejecución a partir del informe. Hoy el botón "Build my plan" solo hace la animación (el loader aparece, el informe se va y, a los tres segundos, vuelve con un aviso de que aún no está disponible). El código tiene un `// TODO` donde irá la petición real.

**Datos que ya se generan para esta fase.** El análisis de OpenAI produce, y hoy no se muestra, la ubicación, el cliente objetivo, la propuesta de valor, el modelo de ingresos, la etapa, la competencia y las restricciones (rango de presupuesto necesario y si el presupuesto dado alcanza, exclusiones, riesgos y supuestos), cada sección con su origen (dicho o inferido) y su confianza. Se mantienen en el análisis precisamente para que esta fase los use.

**Qué hay que decidir.** Qué datos recibe (el informe completo, el perfil, la validación y las respuestas del usuario), qué devuelve y cómo se muestra. Encajará con el tiempo de respuesta como un trabajo asíncrono, igual que el análisis actual.

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
