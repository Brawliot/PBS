# Anexo: ¿se pierde dinero con el pago único de 29 €?

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

