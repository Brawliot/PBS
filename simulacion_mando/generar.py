"""Simulación de 500 clientes potenciales de MANDO. Semilla fija => reproducible.
Todo son SUPUESTOS del simulador (ver perfiles.py); nada de esto es dato de mercado."""
import csv, json, math, os, random, sys, collections
from perfiles import *
from textos import *

SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 20261012
# Palancas para probar la fragilidad de los supuestos (valor por defecto = simulación principal)
ENV = lambda k, d: float(os.environ.get(k, d))
NB_SCALE, CHAT_F, B_UNIT, M_SCALE, FREE_W, E_PEN = (ENV("NB_SCALE", 1), ENV("CHAT_F", .75), ENV("B_UNIT", 2.4),
                                                      ENV("M_SCALE", 1), ENV("FREE_W", 1.15), ENV("E_PEN", 1))
UNIDAD_FACTOR["B"] = B_UNIT
QUIET = os.environ.get("QUIET") == "1"
rng = random.Random(SEED)
ALTS = "ABCDE"

def clamp(x, lo=0.0, hi=1.0): return max(lo, min(hi, x))
def wchoice(items, weights): return rng.choices(items, weights=weights, k=1)[0]
def gumbel(s=.5): return -s * math.log(-math.log(rng.random() + 1e-12))
def sig2(v):
    if v <= 0: return 0
    d = max(0, int(math.floor(math.log10(v))) - 1)
    return int(round(v / 10**d) * 10**d)
def wi(w, shift_up=0):  # índice 0..2 de pesos
    return wchoice([0, 1, 2], w)

def make_persona(key, prof):
    p = {"segkey": key, "seg": key[0]}
    ps = prof
    p["pais"] = wchoice([c for c, _ in PAISES], [w for _, w in PAISES])
    mu, sd, lo, hi = ps["age"]; p["edad"] = int(clamp(round(rng.gauss(mu, sd)), lo, hi))
    t = wi(ps["tech"]) + 1                       # 1 baja, 2 media, 3 alta
    if p["edad"] > 55 and t > 1 and rng.random() < .4: t -= 1
    p["tec"] = t
    s = wi(ps["psens"])                          # 0 baja, 1 media, 2 alta
    if p["pais"] == "Latinoamérica" and s < 2 and rng.random() < .4: s += 1
    p["ps"] = s
    med, sg, blo, bhi, z = ps["budget"]
    p["pres"] = 0 if rng.random() < z else sig2(clamp(med * math.exp(sg * rng.gauss(0, 1)), blo, bhi))
    emu, esd = ps["exp"]; p["exp"] = int(clamp(round(rng.gauss(emu, esd)), 0, 20))
    p["equipo"] = wchoice(EQUIPOS, [w + 1e-9 for w in ps["team"]])
    p["horas"] = wchoice(HORAS, [w + 1e-9 for w in ps["hours"]])
    hi_ = HORAS.index(p["horas"])
    p["idea"] = rng.choice(ps["ideas"])
    # rasgos ocultos
    p["serious"] = clamp(rng.gauss(ps["serious"], .15) + .08 * (hi_ - 1.5) / 1.5)
    p["multi"] = clamp(rng.gauss(ps["multi"], .15))
    p["sub"] = clamp(rng.gauss(ps["sub"], .2))
    p["trust"] = clamp(rng.gauss(ps["trust"], .2 if key[0] != "7" else .1))
    p["priv"] = clamp(rng.gauss(ps["priv"], .18))
    p["patience"] = clamp(rng.gauss(.5, .25))
    p["free"] = clamp(.2 + .25 * s + rng.gauss(0, .15) + (.15 if key[0] == "4" else 0))
    p["chat"] = 1 if rng.random() < {1: .15, 2: .5, 3: .8}[t] else 0
    p["heavy"] = clamp(.15 + .45 * p["serious"] + .12 * hi_ + .2 * p["multi"] + rng.gauss(0, .1))
    p["meter"] = clamp(.3 + .15 * (3 - t) + .2 * s / 2 + rng.gauss(0, .2))
    lowtech, hightech, psn = (3 - t) / 2, (t - 1) / 2, s / 2
    budn = clamp(math.log10(p["pres"] + 1) / 5.5)
    u = {}
    u["A"] = .4 + FREE_W * p["free"] + .9 * (1 - p["heavy"]) - .9 * p["multi"] - .5 * lowtech
    u["B"] = .5 + .9 * p["serious"] * (1 - p["multi"]) + .9 * p["sub"] - 1.1 * psn + .6 * budn - .9 * p["multi"] - .5 * (1 - p["trust"])
    u["C"] = .3 + 1.0 * p["sub"] + .5 * (1 - p["heavy"]) + .5 * hightech - 1.1 * p["meter"] - .6 * lowtech - .6 * psn + .2 * p["free"]
    u["D"] = .2 + .8 * p["heavy"] + 1.2 * p["multi"] + .4 * hightech - 1.3 * p["sub"] - .9 * psn + .5 * p["free"]
    u["E"] = .3 + 1.1 * p["chat"] + .4 * hightech - E_PEN * (.8 * (1 - p["patience"]) + .5 * p["heavy"]) - .6 * lowtech - .6 * psn + .4 * p["free"]
    p["u"] = u
    return p

# ------------------------------------------------------------------ población
pop = []
for key, prof in P.items():
    for _ in range(prof["n"]):
        pop.append(make_persona(key, prof))
assert len(pop) == 500
rng.shuffle(pop)
for i, p in enumerate(pop, 1): p["id"] = f"P{i:03d}"

# preferida / rechazada
for p in pop:
    noisy = {a: p["u"][a] + gumbel() for a in ALTS}
    p["pref"] = max(noisy, key=noisy.get)
    rest = {a: -(p["u"][a] + gumbel()) for a in ALTS if a != p["pref"]}
    p["rej"] = max(rest, key=rest.get)

# estados: no comprador (nunca paga) y abandono (prueba y deja sin pagar), por segmento con cupo exacto
bykey = collections.defaultdict(list)
for p in pop: bykey[p["segkey"]].append(p)
for key, grp in bykey.items():
    prof = P[key]; n = len(grp)
    k_nb = round(min(.9, prof["nb"] * NB_SCALE) * n); k_ab = round(prof["ab"] * n)
    for p in grp:
        psn = p["ps"] / 2
        p["nb_score"] = 1.2 * psn + 1.0 * (1 - p["serious"]) + .8 * (1 - p["trust"]) + .6 * p["priv"] + .5 * p["free"] - .5 * p["heavy"] + rng.gauss(0, .5)
    grp.sort(key=lambda q: -q["nb_score"])
    for p in grp: p["estado"] = "PG"
    for p in grp[:k_nb]: p["estado"] = "NC"
    rest = grp[k_nb:]
    for p in rest:
        p["ab_score"] = .8 * (3 - p["tec"]) / 2 + .6 * (1 - HORAS.index(p["horas"]) / 3) + .5 * (1 - p["serious"]) + .4 * p["meter"] + rng.gauss(0, .4)
    rest.sort(key=lambda q: -q["ab_score"])
    for p in rest[:k_ab]: p["estado"] = "AB"

# objeción
def pick_obj(p):
    s, t = p["ps"] / 2, (3 - p["tec"]) / 2
    if p["estado"] == "NC":
        w = {"PREFIERO_GRATIS": .3 + p["free"], "NO_LO_NECESITO": .3 + .6 * (1 - p["serious"]), "DESCONFIANZA_IA": .2 + .9 * (1 - p["trust"]),
             "PRIVACIDAD_IDEA": .1 + .9 * p["priv"], "PRECIO": .15 + .7 * s, "OTRO": .1, "NO_ENTIENDO": .05 + .4 * t, "LIMITES_FRUSTRAN": .05}
    elif p["estado"] == "AB":
        w = {"NO_ENTIENDO": .25 + .6 * t, "LIMITES_FRUSTRAN": .25 + .5 * p["heavy"] + (.2 if p["pref"] in "AE" else 0), "NO_LO_NECESITO": .25,
             "OTRO": .2, "DESCONFIANZA_IA": .1 + .6 * (1 - p["trust"]), "PRECIO": .05, "PREFIERO_GRATIS": .05, "PRIVACIDAD_IDEA": .03}
    else:
        w = {"PRECIO": .3 + .8 * s, "LIMITES_FRUSTRAN": .2 + .5 * p["heavy"] + (.3 if p["pref"] in "AE" else 0), "NO_ENTIENDO": .1 + .4 * t,
             "DESCONFIANZA_IA": .1 + .4 * (1 - p["trust"]), "PRIVACIDAD_IDEA": .05 + .5 * p["priv"], "PREFIERO_GRATIS": .1 + .3 * p["free"],
             "NO_LO_NECESITO": .05, "OTRO": .1 + (.3 if p["pref"] == "C" else 0)}
    if p["seg"] == "7":
        w["DESCONFIANZA_IA"] *= 2; w["PRIVACIDAD_IDEA"] *= 2
    return wchoice(list(w), list(w.values()))
for p in pop: p["obj"] = pick_obj(p)

# disposición a pagar (WTP) por alternativa
for p in pop:
    prof = P[p["segkey"]]
    p["w"] = {a: 0 for a in ALTS}
    if p["estado"] != "PG": continue
    m = prof["m"] * M_SCALE * math.exp(.55 * rng.gauss(0, 1)) * {0: 1.5, 1: 1.0, 2: .55}[p["ps"]]
    if p["pais"] == "Latinoamérica": m *= .8
    for a in ALTS:
        d = p["u"][a] - p["u"][p["pref"]]
        if a == p["rej"] or d < -1.6:
            continue
        unit = UNIDAD_FACTOR[a]
        if a == "D" and p["seg"] == "5": unit = 1.6   # nivel Negocio para quien lo usa con clientes
        if a == "E" and p["chat"]: unit *= CHAT_F         # ya paga un chat de IA (suposición)
        v = m * unit * math.exp(.45 * d) * math.exp(.25 * rng.gauss(0, 1))
        if a in "BC": v = max(5, 5 * round(v / 5))
        else: v = max(2, round(v))
        p["w"][a] = v
    if p["w"][p["pref"]] == 0:
        p["w"][p["pref"]] = 5 if p["pref"] in "BC" else 2
    p["pago"] = p["w"][p["pref"]]
for p in pop:
    if p["estado"] != "PG": p["pago"] = 0

# seguimiento a 3 meses
RET = {"1": (.12, .30, .58), "2": (.25, .30, .45), "3": (.30, .35, .35), "4": (.05, .20, .75),
       "5": (.45, .35, .20), "6": (.28, .34, .38), "7": (.10, .25, .65), "8": (.18, .30, .52)}
for p in pop:
    if p["pago"] <= 0: p["sigue"] = "n/a"; continue
    si, de, no = RET[p["seg"]]
    if p["pref"] in "BC" and p["multi"] < .6: no += .10; si = max(0, si - .10)
    else: no += .05; si = max(0, si - .05)
    p["sigue"] = wchoice(["sí", "depende", "no"], [si, de, no])

# nota, marcharse, sorpresa
def nota(p):
    key = (p["estado"], p["obj"])
    pool = RS.get((p["seg"],) + key) or R.get(key) or R[("PG", "OTRO")]
    ONLY = {"no se acumule": "AD", "ansiedad": "C"}
    ok = [t for t in pool if all(p["pref"] in v for k, v in ONLY.items() if k in t)]
    txt = rng.choice(ok or pool)
    extra = ""
    if p["obj"] == "NO_ENTIENDO" and rng.random() < .65:
        extra = "; " + CONFUSION[rng.choice([p["pref"], p["rej"]])]
    elif p["obj"] == "LIMITES_FRUSTRAN" and p["patience"] < .35 and rng.random() < .8:
        extra = "; se enfada con cualquier corte: 'me cortan y me voy'"
    tail = ""
    r = rng.random()
    if r < .35: tail = "; " + rng.choice(PREF[p["pref"]])
    elif r < .70: tail = "; " + rng.choice(REJ[p["rej"]])
    contra = ""
    if p["pref"] == "D" and p["sub"] > .75 and p["estado"] == "PG": contra = " " + CONTRA["sub"]
    elif p["free"] > .8 and p["estado"] == "PG" and p["pref"] != "A": contra = " " + CONTRA["gratis"]
    elif p["obj"] == "PRECIO" and p["estado"] == "PG" and p["pago"] >= {"A": 12, "B": 29, "C": 15, "D": 19, "E": 20}[p["pref"]] and rng.random() < .5: contra = " " + CONTRA["precio"]
    elif p["obj"] == "LIMITES_FRUSTRAN" and p["pref"] == "E" and p["estado"] == "PG" and rng.random() < .5: contra = " " + CONTRA["limit"]
    s = f"{p['idea']}: {txt}{extra}{tail}.{contra}"
    return s[0].upper() + s[1:]

def marcha(p):
    o, e = p["obj"], p["estado"]
    k = {"LIMITES_FRUSTRAN": "limite", "PRECIO": "cobro", "DESCONFIANZA_IA": "calidad", "PRIVACIDAD_IDEA": "privacidad",
         "NO_ENTIENDO": "esfuerzo", "NO_LO_NECESITO": "valor", "PREFIERO_GRATIS": "valor", "OTRO": rng.choice(["valor", "esfuerzo", "calidad"])}[o]
    if rng.random() < .25: k = rng.choice(list(MARCHA))
    return rng.choice(MARCHA[k])
def sorpresa(p):
    if p["seg"] == "5" and rng.random() < .5: k = "equipo"
    elif p["obj"] == "LIMITES_FRUSTRAN": k = "limites"
    elif p["obj"] == "PRECIO": k = "precio"
    elif p["obj"] in ("DESCONFIANZA_IA", "PRIVACIDAD_IDEA"): k = rng.choice(["control", "docs"])
    else: k = rng.choice(list(SORPRESA))
    return rng.choice(SORPRESA[k])
for p in pop:
    p["nota"] = nota(p); p["marcha"] = marcha(p); p["sorp"] = sorpresa(p)

# ------------------------------------------------------------------ salida
def compra(p, a, i):
    return int(p["w"][a] >= PRECIOS[a][i] and p["w"][a] > 0)
MESES = {"sí": 12, "depende": 6, "no": 2}      # suposición: meses que paga una suscripción según su respuesta a 3 meses
REPET = {"sí": 1.0, "depende": .4, "no": 0}      # suposición: compras extra (otro proyecto/paquete) en 12 meses
def ingreso12(p, a, i):
    if not compra(p, a, i): return 0
    pr = PRECIOS[a][i]
    return pr * ((1 + REPET[p["sigue"]]) if a in "BC" else MESES[p["sigue"]])
if QUIET:
    head = {"pref": dict(collections.Counter(p["pref"] for p in pop)), "rej": dict(collections.Counter(p["rej"] for p in pop)),
            "ref": {a: sum(compra(p, a, 1) for p in pop) for a in ALTS},
            "ingreso_ref_x100": {a: round(PRECIOS[a][1] * sum(compra(p, a, 1) for p in pop) / 5, 1) for a in ALTS},
            "ingreso12_ref_x100": {a: round(sum(ingreso12(p, a, 1) for p in pop) / 5) for a in ALTS},
            "pagan_algo": sum(1 for p in pop if p["pago"] > 0)}
    print(json.dumps(head)); sys.exit()
def seglabel(p): return p["segkey"]
pop.sort(key=lambda q: q["id"])
H = ["id", "segmento", "país", "edad", "tecnología", "sensibilidad_precio", "presupuesto", "experiencia", "equipo", "horas",
     "alternativa_preferida", "alternativa_rechazada", "pago_mensual_o_por_proyecto", "sigue_pagando_a_3_meses", "objecion_codigo", "nota_corta"]
TEC = {1: "baja", 2: "media", 3: "alta"}; PS = {0: "baja", 1: "media", 2: "alta"}
def row(p):
    return [p["id"], seglabel(p), p["pais"], p["edad"], TEC[p["tec"]], PS[p["ps"]], p["pres"], p["exp"], p["equipo"], p["horas"],
            p["pref"], p["rej"], p["pago"], p["sigue"], p["obj"], p["nota"]]
with open("personas_500.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(H); [w.writerow(row(p)) for p in pop]
for b in range(5):
    with open(f"personas_bloque_{b+1}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(H); [w.writerow(row(p)) for p in pop[b*100:(b+1)*100]]
HX = ["id", "segmento", "estado", "no_comprador", "abandona_sin_pagar"] + [f"wtp_{a}" for a in ALTS] + \
     [f"compra_{a}_{n}" for a in ALTS for n in ("mitad", "ref", "doble")] + ["compra_D_negocio_49", "que_le_haria_marcharse", "que_le_sorprenderia"]
with open("extra_sensibilidad_precio.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(HX)
    for p in pop:
        w.writerow([p["id"], seglabel(p), {"NC": "no_comprador", "AB": "abandona", "PG": "pagaria"}[p["estado"]], int(p["estado"] == "NC"), int(p["estado"] == "AB")]
                   + [p["w"][a] for a in ALTS] + [compra(p, a, i) for a in ALTS for i in range(3)]
                   + [int(p["w"]["D"] >= NEGOCIO[1] and p["w"]["D"] > 0), p["marcha"], p["sorp"]])

