# Persona B: Raquel Olmedo, profesional con equipo

Citas entre paréntesis = archivo donde se vio. Lo que el código no dice se marca como "No consta en el código".

## 1. Quién es

- **Nombre:** Raquel Olmedo.
- **Edad:** 41.
- **Situación laboral:** directora de operaciones en una empresa regional de logística, en Bilbao. Deja el cargo en dos meses para dirigir una nueva empresa a tiempo completo.
- **Experiencia en negocios:** 14 años en logística. Ha montado dos centros de distribución y gestionado presupuestos de seis cifras. Nunca ha creado una empresa desde cero.

## 2. Contexto

Con dos socios y una línea de ayudas autonómica monta una empresa de transporte con temperatura controlada para hospitales y farmacias. Ya tiene 11 personas confirmadas. El lunes presenta al consejo la estructura de la empresa y quiere contrastarla con un borrador propio de 8 departamentos. Un excolega le dijo que MANDO "saca los departamentos de una idea". Le preocupa que la salida sea genérica, que mezcle sectores y que sus datos se manden a servicios de IA: la portada avisa de "Guidance only, not professional advice" (index.html).

## 3. Objetivo

"Quiero salir con un plan donde cada departamento de mi empresa aparezca con sus fases, y llevarme las tareas a un CSV para la reunión del lunes."

Comprobable en la web: el plan lista departamentos en "Departments" con el enlace "Show all N departments" si hay más de 6 (plan.js, `OVERVIEW_DEPARTMENTS`). El menú "Export or print" descarga `<título>-tasks.csv` con las columnas `Task, Department, Phase, Status, Next step` (plan.js, `exportTasksCsv`).

## 4. Datos que tiene a mano

- **Idea (la teclea tal cual):** `A temperature-controlled delivery company for hospitals and pharmacies in Bilbao`
- **Budget:** `$800,000` (el deslizador avanza de 10.000 en 10.000, index.html).
- **Years in this industry:** `14 years` (index.html, `max="20"`; a 20 mostraría `20+ years`, script.js).
- **Team size:** `Large (10+)` (index.html).
- **Weekly hours:** `Full time` (index.html).
- **Datos de registro (ficticios):** nombre `Raquel Olmedo`, email de prueba inventado, contraseña de al menos 8 caracteres (index.html).
- **Respuestas a las preguntas aclaratorias.** El texto de las preguntas lo genera el modelo y no consta en el código. Cada una puede traer hasta 4 opciones y admite hasta 1000 caracteres (index.html, `maxlength="1000"`).
  - **Larga:** `Our first customers would be two public hospitals and about thirty pharmacies in Bizkaia, on a monthly contract with a fixed delivery window. Revenue comes from a per-route fee plus a surcharge for temperature-logged loads. We already have a letter of intent from one hospital network, and a regional grant covers a third of the vehicles. The main competitor is a national courier that does not guarantee cold chain below 8 degrees.`
  - **Corta:** `Yes, two hospitals`

## 5. Comportamiento

- **Instrucciones:** las lee. Lee "Your situation / These four answers shape the plan to your resources." y la nota del pie "We will ask a few questions · about 1 minute" (index.html).
- **Paciencia:** acepta hasta 5 minutos con el análisis. Sabe que hay un modelo de IA detrás. Si el loader lleva más de 3 minutos, entiende que hay un fallo: el código se rinde a los 180 s con "The request took too long. Please try again." (script.js, `JOB_TIMEOUT_MS`).
- **Registro:** **se registra de entrada**, antes de escribir nada, con el botón `Register` de la cabecera (index.html, `data-auth="register"`).
- **Tema:** Dark, que elige en el selector de la cabecera (theme.js, `CHOICES`). Trabaja de noche.
- **Si algo no se entiende:** pulsa `See full detail` en el informe (index.html) y relee. En las preguntas usa `Back` para corregir una respuesta anterior (script.js, `questionBack`). Si sigue sin entender, anota la duda y no busca ayuda en la web: no hay página de ayuda (No consta en el código).

## 6. Recorrido esperado

1. **Portada.** Elige Dark en el selector. Pulsa `Register`, rellena nombre, email, contraseña y repetir contraseña. Queda con sesión iniciada: aparecen el círculo del perfil y el botón `View my projects` (index.html; script.js, `renderHeader`).
2. **Idea.** La teclea en la barra.
3. **Deslizadores.** Los coloca en `$800,000`, `14 years`, `Large (10+)` y `Full time`. Hay que mover o pulsar cada uno: si alguno no se toca, sale `Select a value for ...` (script.js, `markSet`).
4. **Envío.** Pulsa la flecha. Ya no hay diálogo de login.
5. **Loader.** Espera. Puede cancelar con `Cancel` (index.html, `wait-cancel`), pero no lo hace.
6. **Preguntas.** Respuestas largas con la opción de `Back`. El contador `N / 1000` aparece al llegar a 900 caracteres (script.js, `COUNT_FROM`). Más de 4 preguntas le parecerían demasiadas.
7. **Informe.** Lee "Worth checking" y "Key areas", con las marcas `Essential`, `Recommended` y `Optional` (script.js, `TIERS`). Abre `See full detail`. ▶ **Decide si le sirve:** compara las áreas con sus 8 departamentos. Con equipo grande el informe puede mostrar departamentos en lugar de grupos (README.md: depende de `departmentLevel`; script.js: `validation.level === 2`). Si salen solo grupos, lo anota como duda.
8. **Plan.** `Build my plan`. En la vista general lee el resumen, el avance, la sección "Timeline" y "Departments". Pulsa `Show all N departments` si hay más de 6 (plan.js).
9. **Departamentos y tareas.** Entra en uno o dos departamentos. Ve las tareas agrupadas por fase y el estado de cada una (plan.js, `deptView`). Abre la pestaña `Timeline` (plan.js, `tabs`).
10. **Proposals.** Entra por "Ask the assistant for more proposals" (plan.js, `decisionsRegistry`). Allí hay `Suggest plan structure` y `Suggest tasks for all departments`, este último solo si ya hay una decisión confirmada (plan.js, `decisionsView`). Si no hay ninguna, añade una en "Add a decision" con `Save and confirm` (plan.js, `decisionForm`). Esa espera puede ser larga y tiene su propio `Cancel` (plan.js, `waitCancel`; README.md, 240 s).
11. **Exportar.** `Export or print` → `Export tasks as CSV` (plan.js).
12. **My projects.** Comprueba que el plan está en la lista.

## 7. Criterio de éxito

- En el informe, "Key areas" muestra al menos 3 filas con su marca `Essential`, `Recommended` u `Optional`.
- Tras `Build my plan` se abre `/plan?id=<uuid>` y la sección "Departments" lista al menos 3 departamentos con su etiqueta `Core level`, `Important level` o `Light level` (plan.js, `TIER`).
- El navegador descarga `<título>-tasks.csv` y tiene al menos una fila además de la cabecera `Task, Department, Phase, Status, Next step` (plan.js, `exportTasksCsv`).
- En `/projects` hay una fila con el título del plan.

## 8. Señales de abandono

- Las áreas o departamentos del informe no se parecen en nada a una empresa de logística sanitaria.
- Todos los campos del informe salen como `Not specified` o el informe muestra "Not enough information yet" (script.js, `showResult`).
- El plan abre departamentos con "has no tasks yet" y el CSV sale con solo la cabecera.
- El botón `Build my plan` está desactivado con el aviso "This analysis could not be saved, so a plan cannot be built from it." (index.html, `result-plan-note`).
- Un error de red o de límite de tiempo en el análisis, dos veces seguidas.
- Tener que usar `Start over` para corregir un dato: avisa de que "Your analysis and answers will be lost" (index.html, `restart-modal`).

## 9. Supuesto a validar

Se asume que alguien con 14 años de experiencia contrasta el resultado con su propio organigrama en vez de aceptarlo tal cual; el código no confirma que el informe muestre departamentos concretos (y no solo grupos) para un equipo de 10 o más personas.
