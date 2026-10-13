"""Formas de cobro nuevas (F, G, H, L) pensadas para la estructura del coste de IA. Todo son SUPUESTOS."""
import csv, io, contextlib, collections, statistics as st
with contextlib.redirect_stdout(io.StringIO()):
    import resumen_costes as rc          # reutiliza población, costes y margen de las 5 alternativas originales
from perfiles import PRECIOS, NOMBRES
pop = rc.pop; byid = {x["id"]: x for x in pop}
N = {r["id"]: r for r in csv.DictReader(open("extra_nuevas_formas.csv", encoding="utf-8"))}
DEPS = {r["id"]: int(r["departamentos_tipicos"]) for r in N.values()}
for i, x in byid.items(): x["deps"] = DEPS[i]; x["n"] = N[i]
NOM = {"A": "A gratis + asignación", "B": "B 29 € por proyecto", "C": "C créditos", "D": "D suscripción", "E": "E ventanas",
       "F": "F arranque 19 € + goteo incluido", "G": "G 29 € con tope 5 $ + recarga", "H": "H mes activo 6 €", "L": "L 8 € por departamento extra"}
PN = {"F": (9.5, 19, 38), "G": (14.5, 29, 58), "H": (3, 6, 12), "L": (4, 8, 16)}
ACT = {"sí": 7, "depende": 4, "no": 2}
CAPD = .15
def buys(x, a, i=1):
    return int(x["n"][f"compra_{a}_{['mitad','ref','doble'][i]}"])
def ev(a, K, uptake=.5):
    ing = ia = lib = 0.0; comp = 0; perd = 0
    for x in pop:
        if not buys(x, "F" if a == "FH" else a): 
            if a == "L": lib += min(.3, .4 * K * x["cp"] / x["deps"])
            continue
        comp += 1
        n = 1 + rc.REPET[x["sigue"]]; c1 = K * x["cp"]
        if a == "F":
            rev = 19 * n; cost = (.4 * c1 + 12 * min(.05 * c1, CAPD)) * n
        elif a == "G":
            ex = max(0, c1 - 5.0)
            rev = (29 + 2.5 * uptake * ex) * n; cost = (min(c1, 5.0) + uptake * ex) * n     # una parte de quien se pasa (uptake) compra recarga a 2,5x el coste (suposición)
        elif a == "H":
            am = ACT[x["sigue"]]; rev = min(6 * am, 39)
            m1 = .4 * c1 + .6 * c1 / 11; mx = .6 * c1 / 11
            cost = min(m1, 2.0) + min(mx, 2.0) * (am - 1)          # tope de 2 $ de IA por mes activo (suposición)
        elif a == "FH":
            ex_m = max(0, ACT[x["sigue"]] - 1) if .05 * c1 > CAPD else 0       # meses que necesitan más goteo que el incluido
            acepta = uptake
            rev = 19 * n + acepta * min(6 * ex_m, 39); cost = (.4 * c1 + 12 * min(.05 * c1, CAPD)) * n + acepta * ex_m * (.05 * c1 - CAPD if ex_m else 0)
        else:
            rev = 8 * (x["deps"] - 1) * n; cost = c1 * n
        ing += rev; ia += cost
        if cost > rev: perd += 1
    return dict(ing=ing / 5, ia=ia / 5, lib=lib / 5, margen=(ing - ia - lib) / 5, comp=comp, perd=perd)

out = []; w = out.append
w("# Anexo 2: otras formas de cobrar, pensadas para tu estructura de coste de IA\n")
w("**Cómo es tu coste (lo que tomo del enunciado):** cada acción de IA la inicia la persona con un botón; no hay consumo en segundo plano; el informe y el esqueleto no cuestan IA; el coste de un proyecto viene en dos tramos, un **arranque intenso** (análisis, estructura, tareas de todos los departamentos) y un **goteo** largo (ejecutar un paso, responder, rehacer sugerencias cuando cambia una decisión). Además, el coste crece con el **tamaño del proyecto** (departamentos, tareas), no con el tiempo que pasa. En la simulación: 40 % del coste en el arranque y 60 % repartido en el año (suposición mía).\n")
w("Eso penaliza lo que cobra por **tiempo** o por **ventanas de espera** (E, y la suscripción plana D cuando alguien deja de usar el producto pero sigue pagando) y favorece lo que cobra por **proyecto** y cubre el arranque.\n")
w("**Cuatro formas nuevas** (precios de referencia = suposiciones; también a mitad y doble):\n")
w("- **F. Arranque de pago + goteo incluido:** 19 € por proyecto, una vez. Cubre el arranque entero (análisis, estructura y tareas de todos los departamentos) y un goteo mensual pequeño con tope para ejecutar pasos y rehacer sugerencias (0,15 $/mes de IA en la simulación).")
w("- **G. 29 € con tope de IA + recarga:** como B, pero la IA incluida llega hasta 5 $ por proyecto; quien se pasa puede comprar recargas (en la simulación la mitad de quien se pasa recarga, a 2,5 veces el coste).")
w("- **H. Mes activo:** sin suscripción. Se cobran 6 € solo los meses en que la persona pulsa algún botón de IA (con aviso antes de cobrar) y como máximo 39 € por proyecto y año. Un mes sin tocar la IA cuesta 0 €.")
w("- **L. Por departamento:** el primer departamento es gratis; cada departamento extra cuesta 8 € por desbloquear sus tareas y pasos de IA. Un proyecto típico tiene 3 departamentos (equipo solo), 4 (pequeño), 6 (mediano) u 8 (grande).\n")
w("Las formas A–E son las de antes. Los usuarios que ya eran 'nunca paga' o 'abandona' siguen igual: estas formas no los convierten en la simulación (ver cautelas).\n")

# ---- preferencia entre 9
alts9 = list("ABCDEFGHL")
pref = collections.Counter(x["n"]["preferida_entre_9"] for x in pop); rej = collections.Counter(x["n"]["rechazada_entre_9"] for x in pop)
w("## ¿Cuál interesa más a los usuarios? (cada persona elige entre las 9 formas)\n")
w("| Forma | Preferida | Rechazada con más fuerza |"); w("|---|---|---|")
for a in alts9: w(f"| {NOM[a]} | {pref[a]} ({100*pref[a]/500:.0f} %) | {rej[a]} ({100*rej[a]/500:.0f} %) |")
assert sum(pref.values()) == 500 and sum(rej.values()) == 500
w("\nPreferida por segmento (personas):\n")
w("| Seg. | " + " | ".join(alts9) + " |"); w("|---|" + "---|" * 9)
segs = sorted({x["seg"] for x in pop}); SN = {"1": "Primerizo", "2": "Autónomo", "3": "Dueño pyme", "4": "Estudiante", "5": "Consultor", "6": "Con capital", "7": "Escéptico", "8": "Otros"}
for s in segs:
    c = collections.Counter(x["n"]["preferida_entre_9"] for x in pop if x["seg"] == s)
    w(f"| {s} {SN[s]} | " + " | ".join(str(c[a]) for a in alts9) + " |")

# ---- quién compra de verdad
w("\n## ¿Quién pagaría de verdad? Compradores a precio de referencia (oferta única), de las 500\n")
w("| Forma | mitad | **referencia** | doble | Ingreso 12 m por 100 | Compradores con segmento principal |"); w("|---|---|---|---|---|---|")
for a in "FGHL":
    c = [sum(buys(x, a, i) for x in pop) for i in range(3)]
    e = ev(a, 1); seg = collections.Counter(x["seg"] for x in pop if buys(x, a)).most_common(3)
    w(f"| {NOM[a]} | {c[0]} ({100*c[0]/500:.0f} %) | **{c[1]} ({100*c[1]/500:.0f} %)** | {c[2]} ({100*c[2]/500:.0f} %) | {e['ing']:.0f} € | " + ", ".join(f"seg. {s} ({n})" for s, n in seg) + " |")
w("\nPara comparar, las de antes a precio de referencia: A 48, B 70, C 57, D 61, E 11 compradores.\n")
w("Compradores a precio de referencia por segmento, en % del segmento:\n")
w("| Seg. | B (29 €) | F | G | H | L |"); w("|---|---|---|---|---|---|")
for s in segs:
    g = [x for x in pop if x["seg"] == s]
    w(f"| {s} {SN[s]} | " + " | ".join(f"{100*sum(buys(x,a) if a!='B' else x['buy']['B'] for x in g)/len(g):.0f} %" for a in "BFGHL") + " |")

# ---- margen
w("\n## ¿Y a ti qué te deja? Margen en 12 meses por 100 personas ofrecidas (ingresos − IA de pago − IA gratuita)\n")
w("K = veces más caro que el coste base de IA (la simulación parte de una media de unos 1,8 $ por proyecto, con K=1; K=10 son unos 18 $).\n")
w("| Forma | Ingreso | K=1 | K=5 | K=10 | K=25 | Compradores con pérdida a K=10 |"); w("|---|---|---|---|---|---|---|")
rows = []
for a in "ABCDE":
    rr = {K: rc.eval_alt(a, K) for K in (1, 5, 10, 25)}
    rows.append((NOM[a] + " (antes)", rr[1]["ing"], [rr[K]["margen"] for K in (1, 5, 10, 25)], rr[10]["perd"], rr[10]["comp"]))
rr = {K: rc.eval_alt("B", K, bv=True) for K in (1, 5, 10, 25)}
rows.append(("B con tope 4 $ (antes)", rr[1]["ing"], [rr[K]["margen"] for K in (1, 5, 10, 25)], rr[10]["perd"], rr[10]["comp"]))
for a in "FGHL":
    rr = {K: ev(a, K) for K in (1, 5, 10, 25)}
    rows.append((NOM[a], rr[1]["ing"], [rr[K]["margen"] for K in (1, 5, 10, 25)], rr[10]["perd"], rr[10]["comp"]))
rr = {K: ev("G", K, uptake=0) for K in (1, 5, 10, 25)}
rows.append(("G si nadie compra recarga", rr[1]["ing"], [rr[K]["margen"] for K in (1, 5, 10, 25)], rr[10]["perd"], rr[10]["comp"]))
NOM["FH"] = "F + H: arranque 19 € y, si necesita más goteo, 6 € los meses activos"
rr = {K: ev("FH", K) for K in (1, 5, 10, 25)}
rows.append((NOM["FH"], rr[1]["ing"], [rr[K]["margen"] for K in (1, 5, 10, 25)], rr[10]["perd"], rr[10]["comp"]))
for n, ing, ms, p, c in rows:
    w(f"| {n} | {ing:.0f} € | " + " | ".join(f"{m:.0f} €" for m in ms) + f" | {p} de {c} |")
w("\n(Las formas D, A y E llevan tope mensual de IA por cómo las definí; su enfado por límites no se vuelve a modelar aquí salvo en E.)\n")

# ---- puntos de equilibrio
def breakeven(a):
    lo, hi = 1, 400
    for _ in range(60):
        mid = (lo + hi) / 2
        if ev(a, mid)["margen"] > 0: lo = mid
        else: hi = mid
    return lo
w("**Hasta qué coste real aguanta cada una sin perder dinero en total** (K de equilibrio sobre la media base de 1,8 $): B sin tope " + f"{rc and 13:.0f}" + " veces; " + "; ".join(f"{NOM[a].split()[0]} {'más de 400' if breakeven(a) > 390 else f'{breakeven(a):.0f}'} veces" for a in "FGHL") + ".\n")
open("resumen_nuevas.md", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("\n".join(out))
