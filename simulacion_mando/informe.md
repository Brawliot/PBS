# Simulación de 500 clientes potenciales de MANDO

**Lee esto primero.** Esto es una simulación hecha por un modelo de lenguaje, no una encuesta ni datos de mercado. Sirve para sacar hipótesis y preguntas para entrevistas reales.

**Cómo se hizo (importante).** No he "interpretado" a las 500 personas una a una. He escrito reglas por segmento (en `perfiles.py`, todas son *suposiciones* mías) y un generador con semilla fija (`generar.py`) que crea a cada persona, decide qué alternativa prefiere, cuánto pagaría y por qué. Las notas cortas se montan combinando frases que escribí yo (`textos.py`), así que tienen menos variedad que 500 personas de verdad. Las 20 citas de la sección 4 sí las he escrito a mano a partir de filas concretas. Todas las sumas del resumen se calculan leyendo los CSV (`resumen.py`) y el script falla si algo no cuadra.

**Qué es entrada mía y qué es resultado.** Son entradas (las puse yo, no se "descubren"): la proporción de gente que nunca paga o abandona en cada segmento, cuánto está dispuesta a pagar cada segmento en el punto de partida, la retención a 3 meses y el enfado con las ventanas de espera y con el contador de créditos. Lo que sale del cruce de esas entradas con los rasgos de cada persona (preferencias, rechazos, cómo cae la compra al subir el precio) es lo que se puede mirar, y aun así sigue siendo una hipótesis.

**Archivos**

| Archivo | Contenido |
|---|---|
| `personas_bloque_1.csv` … `personas_bloque_5.csv` | Las 500 filas, 100 por bloque, con las 16 columnas pedidas |
| `personas_500.csv` | Las mismas 500 filas juntas |
| `extra_sensibilidad_precio.csv` | Por persona: estado (nunca paga / abandona / pagaría), máximo que pagaría por cada alternativa A–E, si compraría a mitad, referencia y doble de precio, qué le haría marcharse y qué le sorprendería |
| `extra_costes.csv`, `resumen_costes.py`, `resumen_costes.md` | Anexo 1: costes de IA por persona y márgenes (ver final del informe) |
| `extra_nuevas_formas.csv`, `resumen_nuevas.py`, `resumen_nuevas.md` | Anexo 2: cuatro formas de cobrar nuevas (F, G, H, L), por persona |
| `generar.py`, `perfiles.py`, `textos.py`, `resumen.py` | El generador y los cálculos, reproducibles (`python3 generar.py && python3 resumen.py`) |

**Definiciones.** *Nunca paga*: no pagaría aunque le guste (38 % de las 500; se pedía al menos 25 %). *Abandona*: prueba el producto y lo deja sin pagar (21 %; se pedía al menos 20 %). *Pagaría algo*: dice un importe mayor que 0 por su alternativa preferida. En `pago_mensual_o_por_proyecto` el importe va en la unidad de su preferida: €/mes para A, D y E; €/proyecto para B; €/paquete para C. En `sigue_pagando_a_3_meses`, "n/a" significa que no paga nada. En B y C, "seguir pagando" significa volver a comprar (otro proyecto o paquete).

**Sobre el reparto de segmentos.** Lo he dejado tal como lo pedías (25 / 15 / 15 / 15 / 8 / 7 / 10 / 5 %). El segmento 8 ("Otros", 25 personas) lo he llenado con seis subtipos inventados: jubilado con una idea pequeña (6), persona en paro que se autoemplea (5), asociación o cooperativa (4), profesor que lo usaría en clase (4), inversor pequeño que filtra ideas ajenas (3) y emprendedor en serie (3). El reparto por países (España 40 %, Latinoamérica 27 %, EE. UU. 10 %, resto de Europa 15 %, otros 8 %) es *suposición* mía.

## 2. Las 500 filas

Están en `personas_bloque_1.csv` a `personas_bloque_5.csv` (columnas: id, segmento, país, edad, tecnología, sensibilidad_precio, presupuesto, experiencia, equipo, horas, alternativa_preferida, alternativa_rechazada, pago_mensual_o_por_proyecto, sigue_pagando_a_3_meses, objecion_codigo, nota_corta). No las pego aquí porque son unas 500 líneas largas; no hay ninguna resumida ni omitida.

## 1. Tabla de segmentos

| Seg. | Personas | País más frecuente | Edad (mediana) | Tecnología | Sens. precio | Presupuesto USD (mediana) | Exp. (mediana) | Equipo | Horas | Nunca paga | Abandona | Pagaría algo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 Primerizo | 125 (25 %) | España | 30 | media | alta | 1,000 | 2 | solo | <10 | 42 (34 %) | 31 (25 %) | 52 (42 %) |
| 2 Autónomo | 75 (15 %) | España | 36 | media | media | 2,100 | 8 | solo | 20-40 | 21 (28 %) | 15 (20 %) | 39 (52 %) |
| 3 Dueño pyme | 75 (15 %) | España | 46 | media | media | 19,000 | 11 | pequeño | 10-20 | 22 (29 %) | 14 (19 %) | 39 (52 %) |
| 4 Estudiante | 75 (15 %) | España | 22 | alta | alta | 0 | 0 | solo | <10 | 50 (67 %) | 15 (20 %) | 10 (13 %) |
| 5 Consultor/mentor | 40 (8 %) | España | 43 | media | media | 14,000 | 15 | solo | 20-40 | 6 (15 %) | 7 (18 %) | 27 (68 %) |
| 6 Con capital | 35 (7 %) | España | 47 | media | baja | 150,000 | 4 | pequeño | <10 | 9 (26 %) | 7 (20 %) | 19 (54 %) |
| 7 Escéptico | 50 (10 %) | Latinoamérica | 42 | alta | alta | 2,300 | 7 | solo | 10-20 | 33 (66 %) | 10 (20 %) | 7 (14 %) |
| 8 Otros | 25 (5 %) | España | 50 | media | alta | 3,900 | 7 | solo | 10-20 | 8 (32 %) | 6 (24 %) | 11 (44 %) |

Segmento 8 (25 personas, subtipos inventados): Otros: jubilado 6, Otros: inversor pequeño 3, Otros: profesor 4, Otros: desempleado 5, Otros: ONG/cooperativa 4, Otros: serial 3.

## 3. Resumen cuantitativo (calculado desde las 500 filas)

**Estados.** Nunca pagarían: 191 (38 %). Prueban y abandonan sin pagar: 105 (21 %). Pagarían algo por su preferida: 204 (41 %). Suma: 500 = 500.

**Alternativa preferida (personas)**

| Seg. | A | B | C | D | E | Total |
|---|---|---|---|---|---|---|
| 1 Primerizo | 79 | 14 | 13 | 4 | 15 | 125 |
| 2 Autónomo | 30 | 20 | 7 | 13 | 5 | 75 |
| 3 Dueño pyme | 26 | 19 | 4 | 16 | 10 | 75 |
| 4 Estudiante | 52 | 0 | 7 | 5 | 11 | 75 |
| 5 Consultor/mentor | 3 | 1 | 1 | 34 | 1 | 40 |
| 6 Con capital | 7 | 13 | 1 | 10 | 4 | 35 |
| 7 Escéptico | 20 | 2 | 14 | 6 | 8 | 50 |
| 8 Otros | 12 | 7 | 3 | 2 | 1 | 25 |
| **Total** | **229** (46 %) | **76** (15 %) | **50** (10 %) | **90** (18 %) | **55** (11 %) | 500 |

**Alternativa rechazada con más fuerza (personas)**

| Seg. | A | B | C | D | E | Total |
|---|---|---|---|---|---|---|
| 1 Primerizo | 1 | 20 | 18 | 55 | 31 | 125 |
| 2 Autónomo | 3 | 10 | 21 | 13 | 28 | 75 |
| 3 Dueño pyme | 4 | 10 | 29 | 7 | 25 | 75 |
| 4 Estudiante | 0 | 40 | 4 | 13 | 18 | 75 |
| 5 Consultor/mentor | 7 | 17 | 6 | 0 | 10 | 40 |
| 6 Con capital | 5 | 2 | 10 | 5 | 13 | 35 |
| 7 Escéptico | 3 | 9 | 9 | 11 | 18 | 50 |
| 8 Otros | 1 | 6 | 3 | 3 | 12 | 25 |
| **Total** | **24** (5 %) | **114** (23 %) | **100** (20 %) | **107** (21 %) | **155** (31 %) | 500 |

**Disposición a pagar por la alternativa preferida** (importe que dicen aceptar; unidades distintas, no se suman entre filas)

| Preferida | Personas | Con pago > 0 | Pago medio entre quienes pagan | Mediana | Unidad |
|---|---|---|---|---|---|
| A gratis con asignación mensual | 229 | 67 (29 %) | 7.4 | 4 | €/mes |
| B pago por proyecto | 76 | 44 (58 %) | 49.5 | 35 | €/proyecto |
| C créditos prepago | 50 | 21 (42 %) | 12.9 | 10 | €/paquete |
| D suscripción por niveles | 90 | 52 (58 %) | 41.4 | 30 | €/mes |
| E ventanas de uso tipo chat | 55 | 20 (36 %) | 9.4 | 8 | €/mes |

Sobre las 500 personas (incluye ceros), el pago medio por la preferida mezcla unidades y no tiene sentido; entre quienes pagan algo, mediana 13.

**Sensibilidad al precio: ¿cuántas de las 500 comprarían cada alternativa si fuera la única oferta?** (mitad / referencia / doble)

| Alternativa (unidad) | Precios | Compran: mitad | referencia | doble | WTP medio (500, con ceros) | WTP medio (solo WTP>0) | Ingreso inicial por 100 personas ofrecidas (mitad / ref / doble) |
|---|---|---|---|---|---|---|---|
| A gratis con asignación mensual (€/mes) | 6 / 12 / 24 | 103 (21 %) | 48 (10 %) | 15 (3 %) | 3.5 | 9.9 | 124 / 115 / 72 € |
| B pago por proyecto (€/proyecto) | 14.5 / 29 / 58 | 114 (23 %) | 70 (14 %) | 36 (7 %) | 12.7 | 41.9 | 331 / 406 / 418 € |
| C créditos prepago (€/paquete) | 7.5 / 15 / 30 | 80 (16 %) | 57 (11 %) | 19 (4 %) | 4.5 | 16.6 | 120 / 171 / 114 € |
| D suscripción por niveles (€/mes) | 9.5 / 19 / 38 | 89 (18 %) | 61 (12 %) | 30 (6 %) | 7.6 | 25.5 | 169 / 232 / 228 € |
| E ventanas de uso tipo chat (€/mes) | 10 / 20 / 40 | 36 (7 %) | 11 (2 %) | 3 (1 %) | 2.2 | 9.3 | 72 / 44 / 24 € |

Nivel Negocio de D a 49 €/mes: 22 personas lo pagarían (de ellas 14 de los 40 consultores).

Lectura: el "ingreso inicial" de B y C es un solo cobro; el de A, D y E es un mes. No son comparables sin tener en cuenta cuánto dura el pago (ver siguiente tabla).

**Ingreso en 12 meses por 100 personas ofrecidas, a precio de referencia** (suposición: quien responde 'sí' a 3 meses paga 12 meses de suscripción o compra otro proyecto/paquete; 'depende' paga 6 meses o 0,4 compras extra; 'no' paga 2 meses o ninguna extra. Escenario pesimista: 9 / 3 / 1 meses)

| Alternativa | Compradores a precio ref. | Ingreso 12 m (base) | Ingreso 12 m (pesimista) |
|---|---|---|---|
| A gratis con asignación mensual | 48 | 682 € | 442 € |
| B pago por proyecto | 70 | 543 € | 474 € |
| C créditos prepago | 57 | 226 € | 198 € |
| D suscripción por niveles | 61 | 1315 € | 817 € |
| E ventanas de uso tipo chat | 11 | 216 € | 132 € |

Esto ignora el coste de la IA de quienes no pagan (ver sección 6) y supone que cada persona ve una sola oferta.

**Seguirían pagando a los tres meses**

- Entre quienes pagarían algo (204): sí 34 (17 %), depende 65 (32 %), no 105 (51 %). Suma 204 = 204.
- Sobre las 500: sí 7 %, depende 13 %.

| Segmento | Pagan | sí | depende | no |
|---|---|---|---|---|
| 1 Primerizo | 52 | 4 | 18 | 30 |
| 2 Autónomo | 39 | 7 | 15 | 17 |
| 3 Dueño pyme | 39 | 13 | 13 | 13 |
| 4 Estudiante | 10 | 0 | 2 | 8 |
| 5 Consultor/mentor | 27 | 7 | 7 | 13 |
| 6 Con capital | 19 | 3 | 6 | 10 |
| 7 Escéptico | 7 | 0 | 1 | 6 |
| 8 Otros | 11 | 0 | 3 | 8 |

**Objeción principal** (por estado)

| Código | Total | Nunca paga | Abandona | Pagaría |
|---|---|---|---|---|
| PRECIO | 82 (16 %) | 30 | 3 | 49 |
| NO_ENTIENDO | 53 (11 %) | 7 | 29 | 17 |
| LIMITES_FRUSTRAN | 75 (15 %) | 1 | 32 | 42 |
| DESCONFIANZA_IA | 82 (16 %) | 41 | 18 | 23 |
| NO_LO_NECESITO | 45 (9 %) | 29 | 12 | 4 |
| PREFIERO_GRATIS | 72 (14 %) | 48 | 2 | 22 |
| PRIVACIDAD_IDEA | 66 (13 %) | 31 | 0 | 35 |
| OTRO | 25 (5 %) | 4 | 9 | 12 |
| **Total** | 500 | 191 | 105 | 204 |

**Objeción principal por segmento (personas)**

| Seg. | PRECIO | NO_ENTIENDO | LIMITES_FRUSTRAN | DESCONFIANZA_IA | NO_LO_NECESITO | PREFIERO_GRATIS | PRIVACIDAD_IDEA | OTRO |
|---|---|---|---|---|---|---|---|---|
| 1 Primerizo | 18 | 17 | 17 | 24 | 14 | 16 | 14 | 5 |
| 2 Autónomo | 12 | 10 | 13 | 13 | 5 | 9 | 7 | 6 |
| 3 Dueño pyme | 19 | 7 | 12 | 11 | 6 | 11 | 6 | 3 |
| 4 Estudiante | 14 | 3 | 11 | 13 | 12 | 17 | 2 | 3 |
| 5 Consultor/mentor | 9 | 3 | 9 | 3 | 1 | 4 | 8 | 3 |
| 6 Con capital | 4 | 5 | 8 | 1 | 3 | 2 | 12 | 0 |
| 7 Escéptico | 4 | 4 | 2 | 16 | 3 | 7 | 11 | 3 |
| 8 Otros | 2 | 4 | 3 | 1 | 1 | 6 | 6 | 2 |

**Qué segmento acepta cada alternativa a precio de referencia** (% de compradores dentro del segmento, oferta única)

| Seg. | A | B | C | D | E |
|---|---|---|---|---|---|
| 1 Primerizo | 2 % | 3 % | 7 % | 1 % | 0 % |
| 2 Autónomo | 11 % | 20 % | 20 % | 7 % | 0 % |
| 3 Dueño pyme | 27 % | 36 % | 13 % | 20 % | 4 % |
| 4 Estudiante | 0 % | 0 % | 0 % | 0 % | 0 % |
| 5 Consultor/mentor | 12 % | 10 % | 20 % | 62 % | 8 % |
| 6 Con capital | 23 % | 49 % | 29 % | 34 % | 9 % |
| 7 Escéptico | 2 % | 0 % | 4 % | 2 % | 0 % |
| 8 Otros | 12 % | 12 % | 12 % | 8 % | 8 % |

## 4. Veinte citas representativas

Escritas por mí a partir de la fila de cada id; no son palabras de personas reales.

**Negativas (9)**

1. **P008** (escéptico, Latinoamérica, 49 años, no paga): "Ya he visto a la IA inventarse datos con mucha seguridad. Un estudio de viabilidad con cifras inventadas es peor que no tener estudio."
2. **P006** (escéptico, Latinoamérica, 35, no paga): "Lo pruebo mientras sea gratis. El día que me pidan dinero me voy, se llame Pro o se llame Negocio."
3. **P073** (capital, España, 65, abandona): "Estaba rehaciendo las sugerencias por una decisión que cambié y me dice que se acabó la ayuda. Justo cuando la necesitaba. Me cortan y me voy."
4. **P164** (autónomo, Latinoamérica, 24, abandona): "Yo habría pagado la suscripción para no pensar más. Pero antes de pagar me topé con el límite de lo gratis, me enfadé y no volví."
5. **P021** (estudiante, 22, no paga): "Para mis ideas de apps uso un chat de IA gratis. Si esto no me da algo claramente mejor sin pagar, no veo para qué."
6. **P019** (capital, Latinoamérica, 56, abandona): "Un plan tan largo me parece mucho trabajo. Al final hago lo de siempre y llamo a mi asesor."
7. **P065** (jubilado, Latinoamérica, 66, abandona): "Se me pasan las semanas. Vuelvo y el plan ya está desfasado, así que ni lo abro."
8. **P001** (estudiante, Latinoamérica, 26, no paga): "Solo miraba por curiosidad. No pienso montar nada ahora. Y 29 € de golpe, ni de broma."
9. **P070** (escéptico, EE. UU., 50, pagaría 5 €): "Para lo que lo usaría me parece caro. Con la mitad de precio no lo dudaría."

**Muestran que no entienden el cobro (5)**

10. **P107** (primerizo, Latinoamérica, 18, abandona): "¿Ventanas de cinco horas? ¿Quiere decir que solo puedo usarlo cinco horas al día? Y no sé qué es gratis y qué gasta ayuda de IA. Mejor no toco nada."
11. **P108** (primerizo, 20, abandona): "Creí que los 29 € eran cada mes. Además me perdí entre fases y tareas y lo dejé a la segunda semana."
12. **P087** (autónomo, España, 46, abandona): "¿Los créditos caducan como las millas del avión? No sé qué botón gasta y cuál no, así que no pulso ninguno."
13. **P301** (primerizo, 38, pagaría 11 €/mes): "Pagaría algo, pero que alguien me explique en dos frases qué pago y cuándo. Yo pensaba que la ayuda mensual que no gasto se guarda para el mes siguiente, como una hucha."
14. **P203** (dueño de pyme, España, 47, pagaría 40 €/mes): "Pagaría Pro, pero ¿los proyectos cuentan aparte de lo que gasta la IA? ¿El presupuesto de arranque se gasta solo al empezar o durante todo el plan? No lo tengo claro."

**Positivas o con condiciones (6)**

15. **P009** (consultora, España, 37, pagaría 23 €/mes, seguiría): "Lo usaría con mis clientes, pero el coste tiene que poder repercutirlo. Si lo meto en mi factura, pago sin pensarlo."
16. **P130** (consultora, España, 44, pagaría 60 €/mes, seguiría): "Con varios clientes a la vez, un límite semanal me haría quedar mal en plena reunión. Pago la suscripción más alta si sé que no me corta."
17. **P023** (dueño de pyme, 49, pagaría 65 € por proyecto, seguiría): "Pago una vez por mi proyecto, pido factura a nombre de la empresa para desgravar y me olvido. Eso lo entiendo."
18. **P098** (peluquería, Latinoamérica, 40, pagaría 20 € por proyecto): "Pago por proyecto, pero quiero saber antes qué pasa cuando llegue al límite."
19. **P150** (clínica de fisioterapia, 37, pagaría 80 € por proyecto): "Pagaría más si pudiera borrar mi proyecto y mis datos cuando quiera. Me sorprendió que la IA solo proponga y yo decida todo."
20. **P138** (capital, España, 49, pagaría 14 €/mes, no seguiría): "Los límites me dan igual… hasta que me cortan, y entonces me enfado. Elijo ventanas porque ya conozco el sistema, pero sé que me va a irritar." *(Se contradice: es el caso que quería mostrar.)*

## 5. Lo que dice cada alternativa (según lo simulado)

Referencia para leer los números: de las 500, 109 (22 %) comprarían *alguna* alternativa al precio de referencia y 80 (16 %) pondrían, por su preferida, al menos ese precio. En cambio 204 (41 %) dicen que pagarían "algo". La diferencia entre decir y pagar el precio de referencia es el hallazgo más sólido del ejercicio.

| | A. Gratis + asignación | B. Por proyecto | C. Créditos | D. Suscripción | E. Ventanas |
|---|---|---|---|---|---|
| Preferida | 229 (46 %) | 76 (15 %) | 50 (10 %) | 90 (18 %) | 55 (11 %) |
| Rechazada con más fuerza | 24 (5 %) | 114 (23 %) | 100 (20 %) | 107 (21 %) | 155 (31 %) |
| Compran al precio ref. (oferta única) | 48 (10 %) | 70 (14 %) | 57 (11 %) | 61 (12 %) | 11 (2 %) |
| Compran a mitad / doble | 103 / 15 | 114 / 36 | 80 / 19 | 89 / 30 | 36 / 3 |
| Ingreso 12 meses por 100 ofrecidas (suposición de permanencia) | 682 € | 543 € | 226 € | 1.315 € | 216 € |

**A. Gratis con asignación mensual**
- *Fuerte:* es la más elegida y la menos rechazada. Gana en 6 de 8 segmentos (todos salvo consultores y personas con capital). Entre quienes la prefieren, 51 % no pagaría nunca y 20 % abandonaría: es una puerta de entrada, no un modelo de ingresos.
- *Débil:* "lo que no usas se pierde" enfada a quien paga (aparece como `LIMITES_FRUSTRAN`) y la asignación que no se acumula se confunde con una hucha (P301, P455). Los usuarios gratis son quienes cuestan IA sin devolver dinero. Pesa más en segmentos grandes y poco rentables (primerizos y estudiantes son el 40 % de las personas y casi no compran nada).
- *La rechazan:* sobre todo consultores (7 de 40) y personas con capital (5 de 35), que la ven corta para su uso.

**B. Precio por proyecto (29 €)**
- *Fuerte:* la mejor conversión entre quienes tienen un negocio serio: compran a 29 € el 36 % de los dueños de pyme, el 49 % de las personas con capital y el 20 % de los autónomos. Es lo que mejor entienden los que odian las suscripciones. Con precio doble (58 €) cae a la mitad de compradores, pero el ingreso inicial apenas baja (418 € vs 406 € por 100 personas), lo que apunta a probar un precio mayor.
- *Débil:* "pagar antes de ver la IA funcionar" y "29 € de golpe". Es lo que más rechazan los estudiantes (40 de 75) y los consultores (17 de 40), porque con muchos proyectos o clientes se les hace caro. Es la preferida con más abandono (28 %): muchos la eligen, la prueban y no llegan a pagar. Un pago único no crea hábito: solo 9 de 44 volverían a comprar con seguridad.
- *La rechazan:* estudiantes (53 %), consultores (43 %), primerizos (16 %).

**C. Créditos prepago (15 €)**
- *Fuerte:* los escépticos la ven como la más honesta (14 de 50 la prefieren, segundo lugar en ese segmento) y atrae a quien odia las suscripciones.
- *Débil:* "no quiero un taxímetro": ver el coste de cada clic agobia a bastante gente; algunos creen que los créditos caducan. Tiene el ingreso a 12 meses más bajo de las cinco (226 €) y solo 2 de 21 seguirían con seguridad.
- *La rechazan:* dueños de pyme (29 de 75, 39 %) y autónomos (21 de 75, 28 %).

**D. Suscripción por niveles (Pro 19 €, Negocio 49 €)**
- *Fuerte:* el mayor ingreso a 12 meses en todas las pruebas que hice, porque el plan es largo y encaja con quien lo usa de forma continua. Los consultores la prefieren en 34 de 40 casos (a 19 € la compra el 62 %; el nivel Negocio a 49 € lo pagarían 14 de ellos) y también compra una parte clara de las personas con capital (34 %) y de los dueños de pyme (20 %).
- *Débil:* el ingreso depende de cuánto aguante el que paga. Si el pagador medio se queda menos de unos 2,3 meses, B le gana (supuesto: en la base salen 5,7 meses de media). Sin los consultores, D baja de 1.315 a 768 €. La rechazan 55 de 125 primerizos (44 %): "otra suscripción más". Los que la eligen citan más `PRECIO` (22 %) y `LIMITES_FRUSTRAN` (21 %).
- *La rechazan:* primerizos, estudiantes y escépticos.

**E. Ventanas de uso tipo chat (20 €)**
- *Fuerte:* es familiar para quien usa chats de IA, y la eligen 55 personas (sobre todo primerizos y estudiantes de tecnología alta, que ya conocen ese sistema).
- *Débil:* es la más rechazada (155, 31 %): la que más rechazan autónomos, personas con capital, escépticos y "Otros", y entre el 24 % y el 48 % de cada segmento la pone en último lugar. "Parece hecho para charlar, no para planificar un año", y las esperas caen justo en el arranque intenso. Provoca la confusión más rara: entender la ventana como "solo cinco horas al día". Compite con el chat de IA que muchos ya pagan (suposición: no tengo datos de cuántos). Solo 11 (2 %) la comprarían a 20 €.
- *La rechazan:* los autónomos (37 %), personas con capital (37 %), "Otros" (48 %) y los escépticos (36 %).
- *Ojo:* si subo la tolerancia a las esperas en el modelo, E pasa a ser la preferida de 92 personas y ya no es la más rechazada. Ver sección 7.

**Una pregunta incómoda sobre las ganadoras.** A sale muy bien parada porque es gratis; D sale bien parada porque los consultores, por cómo los he construido, valoran mucho tener proyectos de sobra. Ninguna de las dos "gana" por demostrar valor: A gana porque preferir lo gratis es casi automático, y D por un solo segmento (8 % de las personas) que aporta 547 de sus 1.315 € de ingreso a 12 meses.

## 6. Qué haría yo como dueño

> **Actualización tras los anexos 1 y 2 (final del documento):** con tu estructura de coste (arranque intenso y goteo, sin consumo en segundo plano) prefiero cobrar el arranque por proyecto y el goteo solo los meses que se usa, en vez de 29 € sin tope. Ver el anexo 2 para los números. El resto de esta sección queda como primera versión.

**Recomendación: combinar tres cosas y no cinco.** La simulación apoya una mezcla de A, B y D, no una alternativa sola:

1. **Gratis (A, recortada).** El informe y el esqueleto no cuestan nada, así que son el anzuelo. Doy un presupuesto de arranque limitado y una asignación mensual pequeña, siempre con un contador visible ("te quedan X, se renueva el día Y"). Esto responde a `LIMITES_FRUSTRAN` (15 % de las objeciones) y a `NO_ENTIENDO`. El coste: con 59 de cada 100 personas que nunca pagan o abandonan, el presupuesto gratis tiene que ser pequeño. Cuenta rápida (suposición, el dato de 1 $ por negocio no está verificado): si el gratis cuesta 0,30 $ por persona y un proyecto de pago deja unos 28 € netos, con convertir 1 de cada 100 ya se cubre.
2. **Proyecto desbloqueado, 29 € de pago único (B).** Para dueños de pyme, personas con capital y autónomos, que son quienes más lo compran y menos quieren suscripciones. Con un tope de IA incluido por proyecto: sin tope, si el coste real fuera muy superior a 1 $, se perdería dinero justo con los que más lo usan (ver anexo al final).
3. **Suscripción solo para quien usa con varios clientes (D, nivel Negocio, ~49 €/mes), más un Pro de 19 €/mes** si los datos reales muestran uso continuo. Los consultores son pocos (8 %) pero con mucho peso en el ingreso.

**Lo que no haría:** vender E (ventanas): la peor compra y la más rechazada en el caso base. Y no pondría C (créditos) como oferta principal: solo como recarga posterior si alguien agota su ayuda y no quiere pasar a otro plan. Menos opciones también reduce los casos de `NO_ENTIENDO`, que ya son 11 % con una oferta cada vez.

**Dos cosas de diseño que sugiere la simulación** (no probadas): dejar que una parte pequeña de la ayuda mensual se arrastre al mes siguiente, para que "pago por lo que no uso" duela menos; y enseñar el coste de cada paso antes de pulsar, que fue de lo que más gustó (aparece como sorpresa positiva).

**Precio de salida que probaría.** B a 29 €, con un segundo grupo a 39 € (el ingreso por 100 personas casi no cambia entre 29 y 58 €, pero con menos compradores). Pro a 19 €/mes y Negocio a 49 €/mes. No bajaría de los precios de referencia: a la mitad, B y D ganan clientes pero pierden ingreso inicial (B 331 € frente a 406 €; D 169 € frente a 232 € por 100 personas ofrecidas), y A casi no cambia (124 € frente a 115 €). Todo esto sale de mis propias curvas de disposición a pagar (suposición), así que es lo primero que hay que contrastar con gente real.

## 7. Cautelas

**Lo que parece robusto** (se mantiene en 15 ejecuciones: la principal, otras 6 semillas y 8 variantes en las que cambié un supuesto cada vez: disposición media a pagar ×0,6 y ×1,5, amor al gratis, competencia con el chat de IA, valor del pago único, tolerancia a las esperas y proporción de no compradores. Con semillas distintas solo varía el azar de quién cae en cada segmento; con las variantes, los supuestos):

- **Decir no es pagar.** El 41 % dice un importe y solo el 22 % compraría alguna alternativa al precio de referencia (casi la mitad menos). Si multiplico la disposición a pagar por 0,6 o por 1,5, la compra de cada alternativa a precio de referencia queda entre el 3 % y el 19 %: siempre muy por debajo del 41 %.
- **E (ventanas) es la que menos compradores tiene a precio de referencia** en las 15 ejecuciones (2 % a 6 % de las 500; las otras cuatro, 8 % a 19 %, salvo en la variante con disposición ×0,6 donde bajan al 3 %–9 %).
- **La alternativa gratis es la más elegida** en las 15 ejecuciones (168 a 241 de 500), aunque con poco peso de ingreso.
- **D tiene el mayor ingreso a 12 meses** en las 15 ejecuciones, mientras el pagador medio aguante más de unos 2,3 meses.
- **Duplicar el precio quita entre el 49 % y el 73 % de los compradores** en las cinco alternativas (caso base). La forma de la curva sale de cómo repartí la disposición a pagar, así que el tamaño exacto es frágil.
- **Pagan los segmentos con presupuesto** (dueños de pyme, capital, consultores, autónomos); primerizos y estudiantes casi no. *Ojo:* esto es en parte circular, porque yo di más presupuesto a unos que a otros.

**Lo que es frágil** (depende de cómo me imaginé a un segmento o de un supuesto):

- **Que E sea la más rechazada.** Si bajo a menos de la mitad el enfado con las esperas, E pasa de 55 a 92 preferencias y de 155 a 85 rechazos (deja de ser la más rechazada; pasa a serlo B con 130). Que E venda poco sí se mantiene. La conclusión sobre E depende de cómo de molestas sean las esperas para la gente real.
- **Que D gane en ingresos.** Depende de la permanencia que suponga (los 12 / 6 / 2 meses para sí / depende / no son míos) y de un solo segmento: los consultores aportan 547 de 1.315.
- **La retención a 3 meses** (17 % sí, 32 % depende, 51 % no) es una entrada mía, no un resultado.
- **El comportamiento de "los escépticos" y los estudiantes**: los hice así (66 % nunca paga). No he descubierto nada sobre ellos.
- **El ingreso de B frente a D** cambia mucho con cuántos meses equivale un pago único: con 1,6 meses B queda en 391 €, con 3,2 en 666 € (base 2,4 → 543 €).
- **El peso de "ya pago un chat de IA"** (afecta a E y a cuánto vale cualquier herramienta nueva).

**Sesgos de esta simulación**

- Las personas "leen" todas las opciones con atención y las comparan; las reales ven una sola página y deciden en segundos.
- No hay competencia (chats de IA, hojas de cálculo, gestores humanos), ni boca a boca, ni marketing. Y no se simula el factor decisivo: si los documentos de IA son buenos de verdad.
- Preferencia declarada ≠ conducta real: aunque he sido escéptico a propósito, el 41 % de "pagaría algo" sigue siendo optimista.
- Las notas salen de plantillas: parecen variadas pero hay menos de 500 voces distintas. Los estados "nunca paga / abandona / pagaría" son excluyentes y fijados por cupo de segmento.
- Todo está en euros y con tres precios por alternativa; no he simulado paquetes, descuentos, prueba gratis de pago ni precios locales para Latinoamérica.
- Una persona no puede querer dos cosas a la vez ni cambiar de idea con el tiempo.

**5 preguntas para personas reales** (entrevista o página de precios de prueba con botones de "comprar" que no cobran):

1. **Página de precios falsa con tres ofertas** (gratis, 29 € por proyecto, 19 €/mes) **y variantes de precio por grupo** (B a 19 / 29 / 39 €; Pro a 12 / 19 / 29 €). Medir clics en "comprar" por segmento. Responde a: ¿cuánta gente hace clic en pagar y a qué precio cae?
2. **Prueba de comprensión:** enseñar la tabla de precios 30 segundos y pedir "explícame con tus palabras qué pagas hoy y qué pasa si se acaba la ayuda de IA". Responde a: ¿creen que 29 € es mensual, que la asignación se acumula, que los créditos caducan, que la ventana de 5 horas es un tope diario?
3. **Uso real:** "Cuéntame tu último proyecto o negocio: ¿en qué semanas trabajaste en el plan y cuántas veces habrías pulsado el botón de IA?" Responde a: ¿el uso es un pico al principio y luego un goteo, o se abandona? Es lo que decide si D aguanta o B/A ganan.
4. **Alternativas actuales y ancla de precio:** "¿Qué usas hoy para esto (chat de IA, hoja de cálculo, gestor, mentor) y cuánto pagas por ello al mes?" Responde a: ¿competir con un chat de IA hace imposible cobrar 20 €, y qué precio parece razonable?
5. **Calidad y confianza con muestra real:** enseñar un borrador generado (por ejemplo un estudio de viabilidad) y preguntar "¿pagarías por cinco más?, ¿qué le falta?, ¿pondrías aquí tu idea real y qué te tendría que prometer?" Responde a: ¿el valor y la confianza justifican pagar, o la objeción `DESCONFIANZA_IA` y `PRIVACIDAD_IDEA` (30 % de las objeciones en la simulación) es el verdadero freno?


## Anexo 1: ¿se pierde dinero con el pago único de 29 €?

Misma población de 500 personas. Se añade a cada una un coste de IA (suposición mía; ver `generar.py`, bloque final): un proyecto cuesta de media del orden de **1 $** (el dato del dueño, sin verificar), pero varía por persona según cuánto lo use, el tamaño del equipo y si rehace sugerencias a menudo; el 10 % rehace tanto que gasta el triple; los consultores y otros multiproyecto llevan de 2 a 8 proyectos al año. **K** es cuántas veces más caro sale en la realidad que ese 1 $ (K=1 es el dato del dueño; K=10 sería 10 $ por proyecto de media). 1 € = 1 $. Se ignoran comisiones de cobro, soporte e impuestos.

Cómo se cobra el coste en cada alternativa (todos los topes son suposiciones): **B sin tope** (29 € y 'IA generosa'): el comprador gasta lo que necesite durante todo el año aunque pague una sola vez. **B con ventanas/tope**: los 29 € incluyen como máximo 4 $ de IA por proyecto y año; quien se queda corto se enfada (lo traduzco en menor disposición a pagar para los impacientes y de uso intenso). **A, D, E**: tope mensual por persona de pago (2 $, 2 $ y 1,5 $). **C**: un paquete de 15 € da 5 $ de IA. Los usuarios gratis consumen su asignación gratuita (A 0,30 $ de arranque + 0,05 $/mes; B nada, porque informe y esqueleto no usan IA; C 0,30 $ de regalo; D 0,15 $ + 0,03 $/mes; E 0,10 $/mes).

**Coste de IA por proyecto, base K=1** (500 personas): mediana 1.27 $, media 1.76 $, percentil 90 = 3.67 $, máximo 14.6 $. Proyectos por persona y año: mediana 1, máximo 8.

**Quienes comprarían B a 29 €:** 70 personas (1 4, 2 15, 3 27, 5 4, 6 17, 8 3 por segmento). Su coste de IA por proyecto base: mediana 1.52 $, percentil 90 = 4.40 $.

## B (29 € pago único): ingresos, coste y margen en 12 meses por 100 personas ofrecidas

| K (veces el 1 $) | Coste IA medio por proyecto | Ingresos | Coste IA de compradores | Margen B sin tope | Compradores con pérdida | Margen B con tope 4 $ (ventanas) | Compradores B con ventanas |
|---|---|---|---|---|---|---|---|
| 1 | 1.8 $ | 543 € | 41 € | **502 €** | 0 de 70 | **477 €** | 65 (vs 70) |
| 3 | 5.3 $ | 543 € | 123 € | **420 €** | 0 de 70 | **381 €** | 55 (vs 70) |
| 5 | 8.8 $ | 543 € | 205 € | **338 €** | 3 de 70 | **356 €** | 52 (vs 70) |
| 10 | 17.6 $ | 543 € | 409 € | **134 €** | 15 de 70 | **354 €** | 52 (vs 70) |
| 25 | 43.9 $ | 543 € | 1023 € | **-480 €** | 46 de 70 | **354 €** | 52 (vs 70) |
| 50 | 87.8 $ | 543 € | 2046 € | **-1503 €** | 66 de 70 | **354 €** | 52 (vs 70) |

**Punto de equilibrio de B sin tope:** el margen total llega a cero cuando el proyecto medio cuesta unas **13 veces** el 1 $ del dueño (unos 23 $ por proyecto).
Los primeros compradores individuales que dan pérdida aparecen con K=5 (ver tabla). 


Quién pierde primero: por segmento, margen por comprador de B sin tope (€, 12 meses), K=1 / K=10 / K=25

| Seg. | Compradores | K=1 | K=10 | K=25 |
|---|---|---|---|---|
| 1 | 4 | 30 | 15 | -10 |
| 2 | 15 | 34 | 10 | -31 |
| 3 | 27 | 40 | 8 | -45 |
| 5 | 4 | 37 | 22 | -5 |
| 6 | 17 | 33 | 9 | -31 |
| 8 | 3 | 30 | 1 | -47 |

## Todas las alternativas: margen en 12 meses por 100 personas ofrecidas (a precio de referencia, oferta única)

Margen = ingresos − IA de quienes pagan − IA gratuita de quienes no pagan. Los números de ingresos son los mismos que en el informe principal; lo nuevo es el coste.

| Alternativa | Ingresos | K=1 margen | K=5 margen | K=10 margen | K=25 margen |
|---|---|---|---|---|---|
| A gratis + upgrade 12 €/mes | 682 € | 626 € | 592 € | 571 € | 545 € |
| B 29 € sin tope | 543 € | 502 € | 338 € | 134 € | -480 € |
| B 29 € con tope 4 $ (ventanas) | 509 € | 477 € | 356 € | 354 € | 354 € |
| C créditos 15 € | 226 € | 169 € | 127 € | 121 € | 120 € |
| D Pro 19 €/mes | 1315 € | 1267 € | 1218 € | 1191 € | 1166 € |
| E ventanas 20 €/mes | 216 € | 195 € | 189 € | 186 € | 184 € |

Coste solo de los usuarios que no pagan (K no lo cambia): A 38 €, B 0 €, C 30 €, D 20 €, E 16 € por 100 personas.


**Cómo leerlo.**

- La pregunta era si con el pago único de 29 € se puede perder dinero. Sí: pasa si el coste real de IA por proyecto es de unas 13 veces el dato base (unos 23 $ por proyecto de media). Algunos compradores concretos ya dan pérdida a partir de unas 5 veces. Con el dato de 1 $ del dueño, el margen es muy alto (unos 500 € por 100 personas ofrecidas).
- Lo que no sabemos es el coste real. Eso se mide con 20 o 30 proyectos de prueba reales, no con esta simulación.
- Poner tope (o ventanas) a lo incluido en los 29 € cuesta poco si el coste es bajo (477 frente a 502 € con el dato base, porque pierdes algunos compradores impacientes) y protege mucho si es alto (354 frente a 134 € con K=10). Es un seguro barato.
- Los topes de A, D y E salen siempre protegidos porque así los definí. Su coste en enfado no se ha modelado aparte, salvo el de E, que ya estaba en la simulación original; la comparación con B con tope no es del todo justa.
- Un margen alto aquí no garantiza un buen negocio: los compradores y los ingresos salen de las mismas suposiciones del informe principal.


## Anexo 2: otras formas de cobrar, pensadas para tu estructura de coste de IA

**Cómo es tu coste (lo que tomo del enunciado):** cada acción de IA la inicia la persona con un botón; no hay consumo en segundo plano; el informe y el esqueleto no cuestan IA; el coste de un proyecto viene en dos tramos, un **arranque intenso** (análisis, estructura, tareas de todos los departamentos) y un **goteo** largo (ejecutar un paso, responder, rehacer sugerencias cuando cambia una decisión). Además, el coste crece con el **tamaño del proyecto** (departamentos, tareas), no con el tiempo que pasa. En la simulación: 40 % del coste en el arranque y 60 % repartido en el año (suposición mía).

Eso penaliza lo que cobra por **tiempo** o por **ventanas de espera** (E, y la suscripción plana D cuando alguien deja de usar el producto pero sigue pagando) y favorece lo que cobra por **proyecto** y cubre el arranque.

**Cuatro formas nuevas** (precios de referencia = suposiciones; también a mitad y doble):

- **F. Arranque de pago + goteo incluido:** 19 € por proyecto, una vez. Cubre el arranque entero (análisis, estructura y tareas de todos los departamentos) y un goteo mensual pequeño con tope para ejecutar pasos y rehacer sugerencias (0,15 $/mes de IA en la simulación).
- **G. 29 € con tope de IA + recarga:** como B, pero la IA incluida llega hasta 5 $ por proyecto; quien se pasa puede comprar recargas (en la simulación la mitad de quien se pasa recarga, a 2,5 veces el coste).
- **H. Mes activo:** sin suscripción. Se cobran 6 € solo los meses en que la persona pulsa algún botón de IA (con aviso antes de cobrar) y como máximo 39 € por proyecto y año. Un mes sin tocar la IA cuesta 0 €.
- **L. Por departamento:** el primer departamento es gratis; cada departamento extra cuesta 8 € por desbloquear sus tareas y pasos de IA. Un proyecto típico tiene 3 departamentos (equipo solo), 4 (pequeño), 6 (mediano) u 8 (grande).

Las formas A–E son las de antes. Los usuarios que ya eran 'nunca paga' o 'abandona' siguen igual: estas formas no los convierten en la simulación (ver cautelas).

## ¿Cuál interesa más a los usuarios? (cada persona elige entre las 9 formas)

| Forma | Preferida | Rechazada con más fuerza |
|---|---|---|
| A gratis + asignación | 161 (32 %) | 4 (1 %) |
| B 29 € por proyecto | 35 (7 %) | 31 (6 %) |
| C créditos | 37 (7 %) | 40 (8 %) |
| D suscripción | 64 (13 %) | 61 (12 %) |
| E ventanas | 41 (8 %) | 66 (13 %) |
| F arranque 19 € + goteo incluido | 73 (15 %) | 4 (1 %) |
| G 29 € con tope 5 $ + recarga | 37 (7 %) | 23 (5 %) |
| H mes activo 6 € | 48 (10 %) | 3 (1 %) |
| L 8 € por departamento extra | 4 (1 %) | 268 (54 %) |

Preferida por segmento (personas):

| Seg. | A | B | C | D | E | F | G | H | L |
|---|---|---|---|---|---|---|---|---|---|
| 1 Primerizo | 55 | 8 | 13 | 5 | 9 | 15 | 4 | 14 | 2 |
| 2 Autónomo | 19 | 5 | 2 | 2 | 8 | 19 | 11 | 9 | 0 |
| 3 Dueño pyme | 18 | 9 | 3 | 11 | 2 | 17 | 10 | 4 | 1 |
| 4 Estudiante | 34 | 0 | 9 | 1 | 13 | 4 | 2 | 11 | 1 |
| 5 Consultor | 1 | 2 | 3 | 29 | 2 | 2 | 0 | 1 | 0 |
| 6 Con capital | 8 | 6 | 0 | 6 | 1 | 6 | 4 | 4 | 0 |
| 7 Escéptico | 18 | 3 | 6 | 5 | 4 | 6 | 5 | 3 | 0 |
| 8 Otros | 8 | 2 | 1 | 5 | 2 | 4 | 1 | 2 | 0 |

## ¿Quién pagaría de verdad? Compradores a precio de referencia (oferta única), de las 500

| Forma | mitad | **referencia** | doble | Ingreso 12 m por 100 | Compradores con segmento principal |
|---|---|---|---|---|---|
| F arranque 19 € + goteo incluido | 153 (31 %) | **105 (21 %)** | 54 (11 %) | 528 € | seg. 3 (34), seg. 2 (24), seg. 6 (17) |
| G 29 € con tope 5 $ + recarga | 123 (25 %) | **74 (15 %)** | 38 (8 %) | 579 € | seg. 3 (24), seg. 2 (17), seg. 6 (17) |
| H mes activo 6 € | 170 (34 %) | **138 (28 %)** | 92 (18 %) | 585 € | seg. 3 (36), seg. 2 (32), seg. 1 (28) |
| L 8 € por departamento extra | 23 (5 %) | **9 (2 %)** | 4 (1 %) | 58 € | seg. 3 (3), seg. 2 (2), seg. 6 (1) |

Para comparar, las de antes a precio de referencia: A 48, B 70, C 57, D 61, E 11 compradores.

Compradores a precio de referencia por segmento, en % del segmento:

| Seg. | B (29 €) | F | G | H | L |
|---|---|---|---|---|---|
| 1 Primerizo | 3 % | 13 % | 3 % | 22 % | 1 % |
| 2 Autónomo | 20 % | 32 % | 23 % | 43 % | 3 % |
| 3 Dueño pyme | 36 % | 45 % | 32 % | 48 % | 4 % |
| 4 Estudiante | 0 % | 0 % | 0 % | 3 % | 0 % |
| 5 Consultor | 10 % | 20 % | 18 % | 22 % | 2 % |
| 6 Con capital | 49 % | 49 % | 49 % | 54 % | 3 % |
| 7 Escéptico | 0 % | 2 % | 2 % | 12 % | 2 % |
| 8 Otros | 12 % | 20 % | 16 % | 24 % | 0 % |

## ¿Y a ti qué te deja? Margen en 12 meses por 100 personas ofrecidas (ingresos − IA de pago − IA gratuita)

K = veces más caro que el coste base de IA (la simulación parte de una media de unos 1,8 $ por proyecto, con K=1; K=10 son unos 18 $).

| Forma | Ingreso | K=1 | K=5 | K=10 | K=25 | Compradores con pérdida a K=10 |
|---|---|---|---|---|---|---|
| A gratis + asignación (antes) | 682 € | 626 € | 592 € | 571 € | 545 € | 0 de 48 |
| B 29 € por proyecto (antes) | 543 € | 502 € | 338 € | 134 € | -480 € | 15 de 70 |
| C créditos (antes) | 226 € | 169 € | 127 € | 121 € | 120 € | 0 de 57 |
| D suscripción (antes) | 1315 € | 1267 € | 1218 € | 1191 € | 1166 € | 0 de 61 |
| E ventanas (antes) | 216 € | 195 € | 189 € | 186 € | 184 € | 0 de 11 |
| B con tope 4 $ (antes) | 509 € | 477 € | 356 € | 354 € | 354 € | 0 de 52 |
| F arranque 19 € + goteo incluido | 528 € | 476 € | 360 € | 241 € | -116 € | 12 de 105 |
| G 29 € con tope 5 $ + recarga | 579 € | 539 € | 575 € | 716 € | 1178 € | 0 de 74 |
| H mes activo 6 € | 585 € | 553 € | 493 € | 459 € | 412 € | 0 de 138 |
| L 8 € por departamento extra | 58 € | 37 € | 4 € | -22 € | -99 € | 3 de 9 |
| G si nadie compra recarga | 577 € | 537 € | 487 € | 479 € | 477 € | 0 de 74 |
| F + H: arranque 19 € y, si necesita más goteo, 6 € los meses activos | 560 € | 507 € | 499 € | 375 € | -24 € | 7 de 105 |

(Las formas D, A y E llevan tope mensual de IA por cómo las definí; su enfado por límites no se vuelve a modelar aquí salvo en E.)

**Hasta qué coste real aguanta cada una sin perder dinero en total** (K de equilibrio sobre la media base de 1,8 $): B sin tope 13 veces; F 20 veces; G más de 400 veces; H más de 400 veces; L 6 veces.


**Cómo leerlo.**

- **Interés de los usuarios:** por volumen gana la gratis (32 %), como siempre. Entre las de pago, las que más gente prefiere son F (arranque de pago con goteo incluido, 15 %), D (suscripción, 13 %, casi todo consultores) y H (mes activo, 10 %). L (pagar por departamento) la rechaza el 54 %: sale peor de todas.
- **Quién pagaría de verdad al precio de referencia:** H 28 %, F 21 %, G 15 %, B 14 %, D 12 %. Es decir, las que cobran por proyecto o solo cuando se usa convencen a más gente que pagar 29 € de golpe sin saber cuánto vas a usar.
- **Por segmento:** los primerizos (25 % de la gente) casi solo compran H (22 %) o F (13 %). Los dueños de pyme y las personas con capital compran de todo (45-54 % en F y H). Los consultores siguen yendo a D. Estudiantes y escépticos casi no pagan nada.
- **Margen para ti:** con tu coste base, F, H y G dejan 480-550 € por 100 personas ofrecidas. Con costes 10 veces mayores, F baja a 241 €, G y H aguantan por el tope. El combo F + H deja 507 € ahora y 375 € con coste ×10.
- **Lo que protege cada una:** F y H protegen porque separan el arranque (que cobras entero al principio) del goteo (que cobras solo cuando se gasta). G protege con el tope. Ninguna protege del arranque si resulta carísimo, así que conviene acotarlo en el diseño (por ejemplo, número máximo de departamentos y tareas que genera la IA al arrancar).
- **Cautelas:** las preferencias de F, G, H y L salen de reglas mías, no de datos. Que H guste tanto depende de suponer que "pagar solo si uso" atrae a quien odia las suscripciones y no se asusta con el cobro. Que G gane margen cuanto más caro sea el coste es un efecto de suponer que la mitad de quien se pasa compra recargas al 2,5 de coste; sin recargas queda en 477-537 €. Y estas formas no recuperan a quien ya era "nunca paga" o "abandona".
