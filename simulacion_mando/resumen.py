"""Calcula el resumen cuantitativo SOLO a partir de los CSV generados (comprobando sumas)."""
import csv, statistics as st, collections
from perfiles import PRECIOS, NOMBRES, UNIDAD, NEGOCIO
A5 = "ABCDE"
rows = list(csv.DictReader(open("personas_500.csv", encoding="utf-8")))
ex = {r["id"]: r for r in csv.DictReader(open("extra_sensibilidad_precio.csv", encoding="utf-8"))}
assert len(rows) == 500 and len(ex) == 500
for r in rows:
    r["seg"] = r["segmento"][0]; r["pago"] = int(r["pago_mensual_o_por_proyecto"]); r["e"] = ex[r["id"]]
    r["estado"] = r["e"]["estado"]
SEGS = sorted({r["segmento"][0] for r in rows}); NSEG = {s: [r for r in rows if r["seg"] == s] for s in SEGS}
SEGN = {"1": "Primerizo", "2": "Autónomo", "3": "Dueño pyme", "4": "Estudiante", "5": "Consultor/mentor", "6": "Con capital", "7": "Escéptico", "8": "Otros"}
pc = lambda x, n: f"{100*x/n:.0f} %"
def mode(v): return collections.Counter(v).most_common(1)[0][0]
out = []
w = out.append

# ---------- 1. tabla de segmentos
w("## 1. Tabla de segmentos\n")
w("| Seg. | Personas | País más frecuente | Edad (mediana) | Tecnología | Sens. precio | Presupuesto USD (mediana) | Exp. (mediana) | Equipo | Horas | Nunca paga | Abandona | Pagaría algo |")
w("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
tot = 0
for s in SEGS:
    g = NSEG[s]; n = len(g); tot += n
    nc = sum(r["estado"] == "no_comprador" for r in g); ab = sum(r["estado"] == "abandona" for r in g); pg = n - nc - ab
    w(f"| {s} {SEGN[s]} | {n} ({pc(n,500)}) | {mode([r['país'] for r in g])} | {int(st.median(int(r['edad']) for r in g))} | {mode([r['tecnología'] for r in g])} | "
      f"{mode([r['sensibilidad_precio'] for r in g])} | {int(st.median(int(r['presupuesto']) for r in g)):,} | {int(st.median(int(r['experiencia']) for r in g))} | "
      f"{mode([r['equipo'] for r in g])} | {mode([r['horas'] for r in g])} | {nc} ({pc(nc,n)}) | {ab} ({pc(ab,n)}) | {pg} ({pc(pg,n)}) |")
assert tot == 500
w("\nSegmento 8 (25 personas, subtipos inventados): " + ", ".join(f"{k} {v}" for k, v in collections.Counter(r["segmento"][2:] for r in NSEG["8"]).items()) + ".\n")

# ---------- 3. resumen cuantitativo
w("## 3. Resumen cuantitativo (calculado desde las 500 filas)\n")
nc = sum(r["estado"] == "no_comprador" for r in rows); ab = sum(r["estado"] == "abandona" for r in rows); pg = 500 - nc - ab
w(f"**Estados.** Nunca pagarían: {nc} ({pc(nc,500)}). Prueban y abandonan sin pagar: {ab} ({pc(ab,500)}). Pagarían algo por su preferida: {pg} ({pc(pg,500)}). Suma: {nc+ab+pg} = 500.\n")
assert nc + ab + pg == 500 and pg == sum(1 for r in rows if r["pago"] > 0)

def matrix(field, title):
    w(f"**{title}**\n")
    w("| Seg. | " + " | ".join(A5) + " | Total |"); w("|---|" + "---|" * 6)
    cols = {a: 0 for a in A5}
    for s in SEGS:
        c = collections.Counter(r[field] for r in NSEG[s]); n = len(NSEG[s]); assert sum(c.values()) == n
        w(f"| {s} {SEGN[s]} | " + " | ".join(str(c[a]) for a in A5) + f" | {n} |")
        for a in A5: cols[a] += c[a]
    assert sum(cols.values()) == 500
    w("| **Total** | " + " | ".join(f"**{cols[a]}** ({pc(cols[a],500)})" for a in A5) + " | 500 |\n")
matrix("alternativa_preferida", "Alternativa preferida (personas)")
matrix("alternativa_rechazada", "Alternativa rechazada con más fuerza (personas)")

w("**Disposición a pagar por la alternativa preferida** (importe que dicen aceptar; unidades distintas, no se suman entre filas)\n")
w("| Preferida | Personas | Con pago > 0 | Pago medio entre quienes pagan | Mediana | Unidad |"); w("|---|---|---|---|---|---|")
for a in A5:
    g = [r for r in rows if r["alternativa_preferida"] == a]; p = [r["pago"] for r in g if r["pago"] > 0]
    w(f"| {a} {NOMBRES[a]} | {len(g)} | {len(p)} ({pc(len(p),len(g))}) | {st.mean(p):.1f} | {st.median(p):.0f} | {UNIDAD[a]} |")
allp = [r["pago"] for r in rows if r["pago"] > 0]
w(f"\nSobre las 500 personas (incluye ceros), el pago medio por la preferida mezcla unidades y no tiene sentido; entre quienes pagan algo, mediana {st.median(allp):.0f}.\n")

w("**Sensibilidad al precio: ¿cuántas de las 500 comprarían cada alternativa si fuera la única oferta?** (mitad / referencia / doble)\n")
w("| Alternativa (unidad) | Precios | Compran: mitad | referencia | doble | WTP medio (500, con ceros) | WTP medio (solo WTP>0) | Ingreso inicial por 100 personas ofrecidas (mitad / ref / doble) |")
w("|---|---|---|---|---|---|---|---|")
dem = {}
for a in A5:
    pr = PRECIOS[a]; c = [sum(int(r["e"][f"compra_{a}_{n}"]) for r in rows) for n in ("mitad", "ref", "doble")]; dem[a] = c
    wt = [int(r["e"][f"wtp_{a}"]) for r in rows]; pos = [x for x in wt if x > 0]
    ing = [pr[i] * c[i] / 5 for i in range(3)]
    w(f"| {a} {NOMBRES[a]} ({UNIDAD[a]}) | {pr[0]} / {pr[1]} / {pr[2]} | {c[0]} ({pc(c[0],500)}) | {c[1]} ({pc(c[1],500)}) | {c[2]} ({pc(c[2],500)}) | "
      f"{sum(wt)/500:.1f} | {st.mean(pos):.1f} | {ing[0]:.0f} / {ing[1]:.0f} / {ing[2]:.0f} € |")
neg = sum(int(r["e"]["compra_D_negocio_49"]) for r in rows)
neg5 = sum(int(r["e"]["compra_D_negocio_49"]) for r in NSEG["5"])
w(f"\nNivel Negocio de D a 49 €/mes: {neg} personas lo pagarían (de ellas {neg5} de los 40 consultores).\n")
w("Lectura: el \"ingreso inicial\" de B y C es un solo cobro; el de A, D y E es un mes. No son comparables sin tener en cuenta cuánto dura el pago (ver siguiente tabla).\n")

SI = {"sí": 12, "depende": 6, "no": 2}; RE = {"sí": 1.0, "depende": .4, "no": 0}
SI2 = {"sí": 9, "depende": 3, "no": 1}
w("**Ingreso en 12 meses por 100 personas ofrecidas, a precio de referencia** (suposición: quien responde 'sí' a 3 meses paga 12 meses de suscripción o compra otro proyecto/paquete; 'depende' paga 6 meses o 0,4 compras extra; 'no' paga 2 meses o ninguna extra. Escenario pesimista: 9 / 3 / 1 meses)\n")
w("| Alternativa | Compradores a precio ref. | Ingreso 12 m (base) | Ingreso 12 m (pesimista) |"); w("|---|---|---|---|")
for a in A5:
    b = [r for r in rows if int(r["e"][f"compra_{a}_ref"])]
    if a in "BC":
        base = sum(PRECIOS[a][1] * (1 + RE[r["sigue_pagando_a_3_meses"]]) for r in b) / 5
        pes = sum(PRECIOS[a][1] * (1 + RE[r["sigue_pagando_a_3_meses"]] * .5) for r in b) / 5
    else:
        base = sum(PRECIOS[a][1] * SI[r["sigue_pagando_a_3_meses"]] for r in b) / 5
        pes = sum(PRECIOS[a][1] * SI2[r["sigue_pagando_a_3_meses"]] for r in b) / 5
    w(f"| {a} {NOMBRES[a]} | {len(b)} | {base:.0f} € | {pes:.0f} € |")
w("\nEsto ignora el coste de la IA de quienes no pagan (ver sección 6) y supone que cada persona ve una sola oferta.\n")

sg = collections.Counter(r["sigue_pagando_a_3_meses"] for r in rows)
w("**Seguirían pagando a los tres meses**\n")
w(f"- Entre quienes pagarían algo ({pg}): sí {sg['sí']} ({pc(sg['sí'],pg)}), depende {sg['depende']} ({pc(sg['depende'],pg)}), no {sg['no']} ({pc(sg['no'],pg)}). Suma {sg['sí']+sg['depende']+sg['no']} = {pg}.")
w(f"- Sobre las 500: sí {pc(sg['sí'],500)}, depende {pc(sg['depende'],500)}.")
assert sg['sí'] + sg['depende'] + sg['no'] == pg
w("\n| Segmento | Pagan | sí | depende | no |"); w("|---|---|---|---|---|")
for s in SEGS:
    g = [r for r in NSEG[s] if r["pago"] > 0]; c = collections.Counter(r["sigue_pagando_a_3_meses"] for r in g)
    w(f"| {s} {SEGN[s]} | {len(g)} | {c['sí']} | {c['depende']} | {c['no']} |")
w("")

OBJ = ["PRECIO", "NO_ENTIENDO", "LIMITES_FRUSTRAN", "DESCONFIANZA_IA", "NO_LO_NECESITO", "PREFIERO_GRATIS", "PRIVACIDAD_IDEA", "OTRO"]
oc = collections.Counter(r["objecion_codigo"] for r in rows); assert sum(oc.values()) == 500
w("**Objeción principal** (por estado)\n")
w("| Código | Total | Nunca paga | Abandona | Pagaría |"); w("|---|---|---|---|---|")
for o in OBJ:
    by = collections.Counter(r["estado"] for r in rows if r["objecion_codigo"] == o)
    w(f"| {o} | {oc[o]} ({pc(oc[o],500)}) | {by['no_comprador']} | {by['abandona']} | {by['pagaria']} |")
w(f"| **Total** | 500 | {nc} | {ab} | {pg} |\n")
w("**Objeción principal por segmento (personas)**\n")
w("| Seg. | " + " | ".join(OBJ) + " |"); w("|---|" + "---|" * len(OBJ))
for s in SEGS:
    c = collections.Counter(r["objecion_codigo"] for r in NSEG[s]); w(f"| {s} {SEGN[s]} | " + " | ".join(str(c[o]) for o in OBJ) + " |")

w("\n**Qué segmento acepta cada alternativa a precio de referencia** (% de compradores dentro del segmento, oferta única)\n")
w("| Seg. | " + " | ".join(A5) + " |"); w("|---|" + "---|" * 5)
for s in SEGS:
    n = len(NSEG[s]); w(f"| {s} {SEGN[s]} | " + " | ".join(pc(sum(int(r['e'][f'compra_{a}_ref']) for r in NSEG[s]), n) for a in A5) + " |")
open("resumen_automatico.md", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("\n".join(out))
