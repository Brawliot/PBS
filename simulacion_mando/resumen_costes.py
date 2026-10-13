"""¿Se pierde dinero con el pago único de 29 €? Costes de IA por persona (SUPUESTOS) sobre las mismas 500 personas.
Base K=1: un proyecto cuesta de media del orden de 1 $ de IA (dato del dueño, SIN VERIFICAR). K multiplica ese consumo.
1 € = 1 $ (suposición). No incluye comisiones de cobro, soporte ni impuestos."""
import csv, math, statistics as st, collections
from perfiles import PRECIOS
P = {r["id"]: r for r in csv.DictReader(open("personas_500.csv", encoding="utf-8"))}
E = {r["id"]: r for r in csv.DictReader(open("extra_sensibilidad_precio.csv", encoding="utf-8"))}
C = {r["id"]: r for r in csv.DictReader(open("extra_costes.csv", encoding="utf-8"))}
ids = sorted(P)
MESES = {"sí": 12, "depende": 6, "no": 2}; REPET = {"sí": 1.0, "depende": .4, "no": 0}
CAP_BV = 4.0      # tope de IA incluido en B con ventanas, por proyecto y año (suposición)
CAP_MES = {"A": 2.0, "D": 2.0, "E": 1.5}   # tope de IA por mes en planes de pago mensuales (suposición)
PACK_IA = 5.0     # IA que da un paquete de 15 € de créditos (suposición)
def d(i):
    p, e, c = P[i], E[i], C[i]
    return dict(id=i, seg=p["segmento"][0], sigue=p["sigue_pagando_a_3_meses"], estado=e["estado"],
                wB=int(e["wtp_B"]), npj=int(c["n_proyectos_al_ano"]), cp=float(c["coste_ia_por_proyecto_usd_base"]),
                pen=float(c["penalizacion_ventanas_base"]), buy={a: int(e[f"compra_{a}_ref"]) for a in "ABCDE"})
pop = [d(i) for i in ids]

def mensual(x, K, cap):   # coste de IA de los m primeros meses de una suscripción
    T = K * x["cp"] * min(x["npj"], 3)
    m = MESES[x["sigue"]]
    first = min(.4 * T + .6 * T / 12, cap); rest = min(.6 * T / 12, cap)
    return first + rest * (m - 1)
def libre(x, a):          # IA gratuita que usa cualquiera que se registre (tope fijado por el dueño)
    meses = 1 if x["estado"] == "pagaria" else 2
    return {"A": .30 + .05 * meses, "B": 0.0, "C": .30, "D": .15 + .03 * meses, "E": .10 * meses}[a]
def eval_alt(a, K, bv=False):
    ing = ia = libre_c = 0.0; comp = 0; perd = 0; costs = []
    for x in pop:
        libre_c += libre(x, a)
        if a == "B" and bv:
            pen = x["pen"] * min(1, K * x["cp"] / CAP_BV)
            buys = x["wB"] * math.exp(-.45 * pen) >= PRECIOS["B"][1] and x["wB"] > 0
        else:
            buys = x["buy"][a]
        if not buys: continue
        comp += 1
        if a in "BC":
            n = 1 + REPET[x["sigue"]]; price = PRECIOS[a][1]
            per = min(K * x["cp"], CAP_BV) if (a == "B" and bv) else (K * x["cp"] if a == "B" else min(K * x["cp"], PACK_IA))
            rev = price * n; cost = per * n
        else:
            m = MESES[x["sigue"]]; rev = PRECIOS[a][1] * m; cost = mensual(x, K, CAP_MES[a])
        ing += rev; ia += cost; costs.append(cost / rev)
        if cost > rev: perd += 1
    return dict(ing=ing / 5, ia=ia / 5, libre=libre_c / 5, margen=(ing - ia - libre_c) / 5, comp=comp, perd=perd)

out = []; w = out.append
w("# Anexo: ¿se pierde dinero con el pago único de 29 €?\n")
w("Misma población de 500 personas. Se añade a cada una un coste de IA (suposición mía; ver `generar.py`, bloque final): un proyecto cuesta de media del orden de **1 $** (el dato del dueño, sin verificar), pero varía por persona según cuánto lo use, el tamaño del equipo y si rehace sugerencias a menudo; el 10 % rehace tanto que gasta el triple; los consultores y otros multiproyecto llevan de 2 a 8 proyectos al año. **K** es cuántas veces más caro sale en la realidad que ese 1 $ (K=1 es el dato del dueño; K=10 sería 10 $ por proyecto de media). 1 € = 1 $. Se ignoran comisiones de cobro, soporte e impuestos.\n")
w("Cómo se cobra el coste en cada alternativa (todos los topes son suposiciones): **B sin tope** (29 € y 'IA generosa'): el comprador gasta lo que necesite durante todo el año aunque pague una sola vez. **B con ventanas/tope**: los 29 € incluyen como máximo 4 $ de IA por proyecto y año; quien se queda corto se enfada (lo traduzco en menor disposición a pagar para los impacientes y de uso intenso). **A, D, E**: tope mensual por persona de pago (2 $, 2 $ y 1,5 $). **C**: un paquete de 15 € da 5 $ de IA. Los usuarios gratis consumen su asignación gratuita (A 0,30 $ de arranque + 0,05 $/mes; B nada, porque informe y esqueleto no usan IA; C 0,30 $ de regalo; D 0,15 $ + 0,03 $/mes; E 0,10 $/mes).\n")
ps = sorted(x["cp"] for x in pop)
w(f"**Coste de IA por proyecto, base K=1** (500 personas): mediana {st.median(ps):.2f} $, media {st.mean(ps):.2f} $, percentil 90 = {ps[449]:.2f} $, máximo {ps[-1]:.1f} $. Proyectos por persona y año: mediana {int(st.median(x['npj'] for x in pop))}, máximo {max(x['npj'] for x in pop)}.\n")
b = [x for x in pop if x["buy"]["B"]]
w(f"**Quienes comprarían B a 29 €:** {len(b)} personas ({', '.join(f'{s} {c}' for s, c in sorted(collections.Counter(x['seg'] for x in b).items()))} por segmento). Su coste de IA por proyecto base: mediana {st.median(x['cp'] for x in b):.2f} $, percentil 90 = {sorted(x['cp'] for x in b)[int(.9*len(b))]:.2f} $.\n")

Ks = [1, 3, 5, 10, 25, 50]
w("## B (29 € pago único): ingresos, coste y margen en 12 meses por 100 personas ofrecidas\n")
w("| K (veces el 1 $) | Coste IA medio por proyecto | Ingresos | Coste IA de compradores | Margen B sin tope | Compradores con pérdida | Margen B con tope 4 $ (ventanas) | Compradores B con ventanas |"); w("|---|---|---|---|---|---|---|---|")
res = {}
for K in Ks:
    r = eval_alt("B", K); v = eval_alt("B", K, bv=True); res[K] = (r, v)
    w(f"| {K} | {K*st.mean(x['cp'] for x in pop):.1f} $ | {r['ing']:.0f} € | {r['ia']:.0f} € | **{r['margen']:.0f} €** | {r['perd']} de {r['comp']} | **{v['margen']:.0f} €** | {v['comp']} (vs {r['comp']}) |")
lo, hi = 1, 400
for _ in range(60):
    mid = (lo + hi) / 2
    if eval_alt("B", mid)["margen"] > 0: lo = mid
    else: hi = mid
w(f"\n**Punto de equilibrio de B sin tope:** el margen total llega a cero cuando el proyecto medio cuesta unas **{lo:.0f} veces** el 1 $ del dueño (unos {lo*st.mean(x['cp'] for x in pop):.0f} $ por proyecto).")
# primer comprador con pérdida
for K in Ks:
    if res[K][0]["perd"]: w(f"Los primeros compradores individuales que dan pérdida aparecen con K={K} (ver tabla). ") ; break
w("")
w("\nQuién pierde primero: por segmento, margen por comprador de B sin tope (€, 12 meses), K=1 / K=10 / K=25\n")
w("| Seg. | Compradores | K=1 | K=10 | K=25 |"); w("|---|---|---|---|---|")
for s in "12345678":
    g = [x for x in b if x["seg"] == s]
    if not g: continue
    cells = []
    for K in (1, 10, 25):
        tot = sum(PRECIOS["B"][1] * (1 + REPET[x["sigue"]]) - K * x["cp"] * (1 + REPET[x["sigue"]]) for x in g)
        cells.append(f"{tot/len(g):.0f}")
    w(f"| {s} | {len(g)} | " + " | ".join(cells) + " |")

w("\n## Todas las alternativas: margen en 12 meses por 100 personas ofrecidas (a precio de referencia, oferta única)\n")
w("Margen = ingresos − IA de quienes pagan − IA gratuita de quienes no pagan. Los números de ingresos son los mismos que en el informe principal; lo nuevo es el coste.\n")
w("| Alternativa | Ingresos | K=1 margen | K=5 margen | K=10 margen | K=25 margen |"); w("|---|---|---|---|---|---|")
names = {"A": "A gratis + upgrade 12 €/mes", "B": "B 29 € sin tope", "BV": "B 29 € con tope 4 $ (ventanas)", "C": "C créditos 15 €", "D": "D Pro 19 €/mes", "E": "E ventanas 20 €/mes"}
for a in ("A", "B", "BV", "C", "D", "E"):
    rows = [eval_alt(a[0], K, bv=(a == "BV")) for K in (1, 5, 10, 25)]
    w(f"| {names[a]} | {rows[0]['ing']:.0f} € | " + " | ".join(f"{r['margen']:.0f} €" for r in rows) + " |")
w("\nCoste solo de los usuarios que no pagan (K no lo cambia): " + ", ".join(f"{a} {eval_alt(a,1)['libre']:.0f} €" for a in "ABCDE") + " por 100 personas.\n")
open("resumen_costes.md", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("\n".join(out))
