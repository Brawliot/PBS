# Pendiente para fases futuras

Cosas que no pertenecen a la fase 1 ni a su salida a producción, pero que hay que hacer en siguientes fases. Para lo que falta antes de publicar la fase 1, ver `PRODUCTION.md`.

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

---

## "View my projects"

**Qué es.** La pantalla con los análisis guardados de cada usuario. Hoy el botón solo muestra un aviso de que no está disponible.

**Qué necesita antes.** Autenticación y base de datos (ver `PRODUCTION.md`), porque no se pueden listar proyectos sin saber de quién son ni sin haberlos guardado.
