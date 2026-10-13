# Anexo 4: corrección, generar el informe SÍ gasta IA

En los anexos 1, 2 y 3 supuse que el informe y el esqueleto no costaban IA (lo decía el enunciado inicial). Era un error de partida si el informe sí la gasta. Lo que cambia: (1) **todo usuario que se registra cuesta dinero** desde su primer informe, también el que nunca paga; (2) el límite de informes gratis y de pago **es un control de coste**, no un capricho; (3) 'informes ilimitados' deja de ser gratis.

**No sé cuánto cuesta un informe.** Pruebo cuatro valores (suposiciones mías): 0,10 $, 0,30 $, 0,60 $ y 1,00 $ por informe. Si todo un negocio cuesta del orden de 1 $ (dato del dueño, sin verificar), un informe a 0,60-1,00 $ sería casi todo el coste y es poco probable; lo más natural es una fracción. Supongo que el coste del informe se suma al del planificador (si ya estaba dentro de tu 1 $, el cálculo es más pesimista que la realidad). Sin el coste del esqueleto, que no sé si usa IA.

Cada persona genera cada mes tantos informes como ideas quiere analizar (mediana 2, ver anexo 3), hasta el tope. Usa lo gratis 2 meses si nunca paga o abandona y 1 mes si luego paga (como antes). Sin contar cuentas falsas ni varias cuentas de la misma persona.

## 1. Cuánto cuesta lo gratis (por 100 registros, 12 meses)

| Tope de informes gratis al mes | Informes medios por persona | R = 0,10 $ | R = 0,30 $ | R = 0,60 $ | R = 1,00 $ |
|---|---|---|---|---|---|
| 1 | 1.6 | 16 € | 48 € | 96 € | 159 € |
| 2 | 2.8 | 28 € | 83 € | 165 € | 275 € |
| 3 | 3.4 | 34 € | 102 € | 204 € | 340 € |
| 5 | 4.0 | 40 € | 121 € | 241 € | 402 € |
| 10 | 4.5 | 45 € | 136 € | 272 € | 453 € |
| ilimitados | 4.7 | 47 € | 141 € | 282 € | 471 € |

El tope de 3 informes al mes que propones ayuda, pero no tanto como parece: pasar de ilimitados a 3 al mes quita solo un 28 % de los informes, porque la mayoría de la gente quiere analizar 1 a 3 ideas. Otras formas de limitar lo gratis:

| Regla de lo gratis | Informes medios por persona | R = 0,10 $ | R = 0,30 $ | R = 0,60 $ | R = 1,00 $ |
|---|---|---|---|---|---|
| 3 al mes (tu propuesta) | 3.4 | 34 € | 102 € | 204 € | 340 € |
| 2 al mes | 2.8 | 28 € | 83 € | 165 € | 275 € |
| 1 al mes | 1.6 | 16 € | 48 € | 96 € | 159 € |
| 3 el primer mes y 1 al mes después | 2.7 | 27 € | 82 € | 164 € | 273 € |
| 3 en total, de por vida | 2.5 | 25 € | 75 € | 150 € | 250 € |

Ojo: en mi simulación cada persona usa lo gratis solo 1 o 2 meses, así que el tope 'de por vida' ahorra poco. En la realidad hay cuentas que se quedan años en gratis y ahí la diferencia crece.

## 2. ¿Cuántos pagos hacen falta para cubrir lo gratis?

Margen medio por comprador (sin contar los informes): plan de 20 €/mes 114 €; F + H (arranque 19 € + meses activos) 24 €. Esto sale de mis supuestos de permanencia.

Conversión mínima (%, de los registrados) para que lo gratis no cause pérdidas, con tope de 3 informes gratis:

| | R = 0,10 $ | R = 0,30 $ | R = 0,60 $ | R = 1,00 $ |
|---|---|---|---|---|
| Plan 20 €/mes | 0.3 % | 0.9 % | 1.8 % | 3.0 % |
| F + H | 1.4 % | 4.2 % | 8.4 % | 14.1 % |

En mis simulaciones pagaban el 13 % (plan de 20 €) y el 21 % (F); en la realidad serán muchos menos. Si el informe cuesta 1 $, necesitas que pague al menos 1 de cada 30 registrados; con 0,30 $, 1 de cada 100.

## 3. Plan de 20 €/mes con informes de pago ilimitados frente a tope de 5, 10 o 20

Los informes de pago cuestan R cada uno; supongo que cada comprador genera los de sus ideas cada mes que paga, y que un comparador cuesta como un informe, una vez al mes si tiene 2 o más ideas.

| Tope de informes de pago | Margen K=1 sin informes | Coste informes (R=0,30) | **Margen R=0,30** | **Margen R=1,00** |
|---|---|---|---|---|
| 5 | 1438 € | 188 € | **1250 €** | **812 €** |
| 10 | 1486 € | 205 € | **1281 €** | **802 €** |
| 20 | 1486 € | 208 € | **1277 €** | **791 €** |
| ilimitados | 1486 € | 210 € | **1276 €** | **787 €** |

Para comparar, F + H y B con tope (margen K=1 sin informes: 507 € y 477 €) pagan el mismo coste de lo gratis (tope de 3), pero casi nada del coste de informes de pago porque el informe va dentro del arranque:

| | Margen sin informes | Coste lo gratis (tope 3) R=0,30 | **Margen R=0,30** | **Margen R=1,00** |
|---|---|---|---|---|
| F + H | 507 € | 102 € | **405 €** | **168 €** |
| B con tope 4 $ | 477 € | 102 € | **375 €** | **137 €** |

(Suscripción plana D, A y C quedan igual que en el anexo 1, restando el mismo coste de lo gratis.)

