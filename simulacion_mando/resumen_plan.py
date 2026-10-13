"""Tu propuesta: gratis 3 informes/mes; 20 €/mes = 5 informes + comparador + planificador; luego otro plan. SUPUESTOS míos."""
import csv, io, contextlib, math, collections, statistics as st
with contextlib.redirect_stdout(io.StringIO()):
    import resumen_costes as rc
pop = rc.pop; byid = {x["id"]: x for x in pop}
Q = {r["id"]: r for r in csv.DictReader(open("extra_plan_informes.csv", encoding="utf-8"))}
SEG = {"1": "Primerizo", "2": "Autónomo", "3": "Dueño pyme", "4": "Estudiante", "5": "Consultor/mentor", "6": "Con capital", "7": "Escéptico", "8": "Otros"}
for i, x in byid.items():
    q = Q[i]; x.update(ideas=int(q["ideas_por_mes"]), pac=float(q["paciencia"]), m=float(q["m_euros_mes"]), dbase=float(q["d_base_D"]), ruido=float(q["ruido"]))
PRICES = (10, 20, 40)

WC, WPUSH, WANGER = .35, .25, .5
def wtp(x, fc=3, pc=5, comp=True):
    if x["estado"] != "pagaria" or x["m"] <= 0 or x["dbase"] < -1.6: return 0.0
    d = x["dbase"]
    if comp and x["ideas"] >= 2: d += WC                    # el comparador sirve a quien tiene 2 o más ideas
    if x["ideas"] > fc: d += WPUSH - WANGER * (1 - x["pac"])        # topa con el límite gratis: empuja a pagar, pero a los impacientes les enfada
    if pc is not None and x["ideas"] > pc: d -= .4 * min(1, (x["ideas"] - pc) / pc)   # el tope de informes de pago molesta a quien genera muchos
    return x["m"] * math.exp(.45 * d) * x["ruido"]
def buyers(fc=3, pc=5, comp=True, price=20):
    return [x for x in pop if wtp(x, fc, pc, comp) >= price]
def margen(bs, K):
    ing = sum(20 * rc.MESES[x["sigue"]] for x in bs); ia = sum(rc.mensual(x, K, 2.0) for x in bs)
    return ing / 5, ia / 5, (ing - ia) / 5

out = []; w = out.append
w("# Anexo 3: tu propuesta de planes (gratis 3 informes/mes; 20 € con 5 informes + comparador + planificador)\n")
w("**Cómo la he entendido (corrígeme si no):** *Gratis:* generar el informe, 3 por cuenta y mes, sin IA. *Plan de 20 €/mes:* 5 informes al mes, comparador de informes (para elegir el mejor negocio o el más claro) y uso del planificador con IA. *Luego otro plan:* un nivel superior (lo trato como 'Negocio' a 49 €/mes). Supuestos míos: el informe y su comparación no cuestan IA (se hacen con reglas); el planificador sí, con un tope de 2 $ de IA por mes y persona; en el nivel de 20 € caben hasta 3 proyectos; el pago de 20 € es mensual.\n")
w("Añado a cada persona cuántas ideas distintas querría pasar por el informe cada mes (suposición mía por segmento: estudiantes 3, consultores 6, profesores 10, primerizos 2, autónomos y dueños 1-2). Si ese número es mayor que el tope gratis, topa con el límite y se siente empujada a pagar; los impacientes, además, se enfadan.\n")
ideas = [x["ideas"] for x in pop]
w(f"**Ideas por mes que querría analizar** (500 personas): mediana {int(st.median(ideas))}, percentil 90 = {sorted(ideas)[449]}. Topan con el límite gratis de 3: {sum(i>3 for i in ideas)} ({100*sum(i>3 for i in ideas)/500:.0f} %). Pasarían de 5 (tope de pago): {sum(i>5 for i in ideas)} ({100*sum(i>5 for i in ideas)/500:.0f} %).\n")
w("| Seg. | Ideas/mes (mediana) | Topan con 3 gratis | Pasan de 5 |"); w("|---|---|---|---|")
for s in sorted(SEG):
    g = [x for x in pop if x["seg"] == s]; n = len(g)
    w(f"| {s} {SEG[s]} | {int(st.median(x['ideas'] for x in g))} | {sum(x['ideas']>3 for x in g)} ({100*sum(x['ideas']>3 for x in g)/n:.0f} %) | {sum(x['ideas']>5 for x in g)} ({100*sum(x['ideas']>5 for x in g)/n:.0f} %) |")

w("\n## ¿Cuánta gente pagaría el plan de 20 €?\n")
w("| Variante | a 10 € | **a 20 €** | a 40 € | Ingreso inicial a 20 € por 100 |"); w("|---|---|---|---|---|")
def line(name, **kw):
    c = [len(buyers(price=p, **kw)) for p in PRICES]
    w(f"| {name} | {c[0]} ({100*c[0]/500:.0f} %) | **{c[1]} ({100*c[1]/500:.0f} %)** | {c[2]} ({100*c[2]/500:.0f} %) | {20*c[1]/5:.0f} € |")
line("Tu propuesta: 3 gratis, 5 de pago, con comparador")
line("Sin comparador (solo más informes y planificador)", comp=False)
line("3 gratis, informes **ilimitados** de pago, con comparador", pc=None)
line("5 gratis, ilimitados de pago, con comparador", fc=5, pc=None)
line("2 gratis, ilimitados de pago, con comparador", fc=2, pc=None)
line("10 gratis, ilimitados de pago, con comparador", fc=10, pc=None)
w("\nPara comparar, la suscripción D de antes (19 €/mes, sin comparador ni tope de informes) la compraba el 12 % (61 personas).\n")
b = buyers()
w("**Quién compra tu propuesta a 20 €:** " + ", ".join(f"{SEG[s]} {n}" for s, n in sorted(collections.Counter(x['seg'] for x in b).items())) + ".\n")
w(f"**De los {len(b)} que pagarían:** {sum(x['ideas']>3 for x in b)} ya topaban con los 3 informes gratis y {sum(x['ideas']>5 for x in b)} pasan de 5 informes al mes (se les queda corto el plan de pago).\n")
w("**¿Cuánto importa cada pieza? Si cambio lo que pesa en mi modelo** (compradores a 20 € de 500):\n")
w("| Peso del comparador | Empuje del tope gratis | Enfado de impacientes | Compradores a 20 € |"); w("|---|---|---|---|")
import itertools
for wc, wp, wa in [(0, 0, 0), (.35, .25, .5), (.7, .25, .5), (.35, .5, .25), (.35, 0, 1.0), (.7, .5, .25), (0, .5, 0)]:
    WC, WPUSH, WANGER = wc, wp, wa
    w(f"| {wc} | {wp} | {wa} | {len(buyers())} ({100*len(buyers())/500:.0f} %) |")
WC, WPUSH, WANGER = .35, .25, .5
w("\nLo que se ve: el número de compradores se mueve poco (de 57 a 72 de 500) en todas las combinaciones. Es decir, en esta simulación lo que decide si pagan o no es el presupuesto y la disposición a pagar de cada persona, no los topes de informes ni el comparador. Esto puede ser verdad, o puede ser que mi modelo les da poco peso: solo se sabe preguntando.\n")

w("\n## Qué te deja (margen 12 meses por 100 personas ofrecidas; permanencia en meses como antes: sí 12, depende 6, no 2)\n")
w("| Variante | Compradores | Ingreso | IA planificador K=1 | **Margen K=1** | Margen K=10 |"); w("|---|---|---|---|---|---|")
for name, kw in [("Tu propuesta (5 informes de pago)", {}), ("Informes ilimitados de pago", {"pc": None}), ("Sin comparador", {"comp": False})]:
    bs = buyers(**kw); i1, a1, m1 = margen(bs, 1); _, _, m10 = margen(bs, 10)
    w(f"| {name} | {len(bs)} | {i1:.0f} € | {a1:.0f} € | **{m1:.0f} €** | {m10:.0f} € |")
w("\nPara comparar (anexos anteriores, K=1): D 1.267 €; F + H 507 €; B con tope 477 €.\n")

w("\n## El 'otro plan' (nivel superior)\n")
neg = [x for x in pop if x["estado"] == "pagaria" and x["ideas"] > 5 and wtp(x, pc=None) * (1.6 if x["seg"] == "5" else 1.3) >= 49]
w(f"A 49 €/mes con informes ilimitados lo pagarían {len(neg)} personas ({', '.join(f'{SEG[s]} {n}' for s, n in sorted(collections.Counter(x['seg'] for x in neg).items()))}). Es un número pequeño: sirve a consultores, profesores e inversores, y casi a nadie más.\n")
open("resumen_plan.md", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("\n".join(out))
