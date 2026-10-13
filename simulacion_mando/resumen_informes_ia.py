"""Corrección: generar el informe SÍ gasta IA. Coste por informe R desconocido => se prueba una gama. SUPUESTOS míos."""
import io, contextlib, collections, statistics as st
with contextlib.redirect_stdout(io.StringIO()):
    import resumen_plan as pl          # población, ideas por mes, compradores del plan de 20 €
    import resumen_nuevas as nv        # F + H y otras formas
rc = pl.rc; pop = pl.pop
RS = (0.10, 0.30, 0.60, 1.00)
CAPS = (1, 2, 3, 5, 10, None)
def meses_gratis(x): return 1 if x["estado"] == "pagaria" else 2     # meses que usa lo gratis antes de pagar o irse (como en anexos anteriores)
def reports_free(x, c): return (x["ideas"] if c is None else min(x["ideas"], c)) * meses_gratis(x)
def cap_n(c): return "ilimitados" if c is None else str(c)

out = []; w = out.append
w("# Anexo 4: corrección, generar el informe SÍ gasta IA\n")
w("En los anexos 1, 2 y 3 supuse que el informe y el esqueleto no costaban IA (lo decía el enunciado inicial). Era un error de partida si el informe sí la gasta. Lo que cambia: (1) **todo usuario que se registra cuesta dinero** desde su primer informe, también el que nunca paga; (2) el límite de informes gratis y de pago **es un control de coste**, no un capricho; (3) 'informes ilimitados' deja de ser gratis.\n")
w("**No sé cuánto cuesta un informe.** Pruebo cuatro valores (suposiciones mías): 0,10 $, 0,30 $, 0,60 $ y 1,00 $ por informe. Si todo un negocio cuesta del orden de 1 $ (dato del dueño, sin verificar), un informe a 0,60-1,00 $ sería casi todo el coste y es poco probable; lo más natural es una fracción. Supongo que el coste del informe se suma al del planificador (si ya estaba dentro de tu 1 $, el cálculo es más pesimista que la realidad). Sin el coste del esqueleto, que no sé si usa IA.\n")
w("Cada persona genera cada mes tantos informes como ideas quiere analizar (mediana 2, ver anexo 3), hasta el tope. Usa lo gratis 2 meses si nunca paga o abandona y 1 mes si luego paga (como antes). Sin contar cuentas falsas ni varias cuentas de la misma persona.\n")

w("## 1. Cuánto cuesta lo gratis (por 100 registros, 12 meses)\n")
w("| Tope de informes gratis al mes | Informes medios por persona | R = 0,10 $ | R = 0,30 $ | R = 0,60 $ | R = 1,00 $ |"); w("|---|---|---|---|---|---|")
free = {}
for c in CAPS:
    rep = sum(reports_free(x, c) for x in pop) / 500
    free[c] = rep
    w(f"| {cap_n(c)} | {rep:.1f} | " + " | ".join(f"{R*rep*100:.0f} €" for R in RS) + " |")
w("\nEl tope de 3 informes al mes que propones ayuda, pero no tanto como parece: pasar de ilimitados a 3 al mes quita solo un %.0f %% de los informes, porque la mayoría de la gente quiere analizar 1 a 3 ideas. Otras formas de limitar lo gratis:\n" % (100 * (1 - free[3] / free[None])))
def life(x, c): return min(x["ideas"] * meses_gratis(x), c)
def first_then_one(x):
    m = meses_gratis(x); return min(x["ideas"], 3) + (m - 1) * min(x["ideas"], 1)
w("| Regla de lo gratis | Informes medios por persona | R = 0,10 $ | R = 0,30 $ | R = 0,60 $ | R = 1,00 $ |"); w("|---|---|---|---|---|---|")
for name, f in (("3 al mes (tu propuesta)", lambda x: reports_free(x, 3)), ("2 al mes", lambda x: reports_free(x, 2)), ("1 al mes", lambda x: reports_free(x, 1)),
                ("3 el primer mes y 1 al mes después", first_then_one), ("3 en total, de por vida", lambda x: life(x, 3))):
    rep = sum(f(x) for x in pop) / 500
    w(f"| {name} | {rep:.1f} | " + " | ".join(f"{R*rep*100:.0f} €" for R in RS) + " |")
w("\nOjo: en mi simulación cada persona usa lo gratis solo 1 o 2 meses, así que el tope 'de por vida' ahorra poco. En la realidad hay cuentas que se quedan años en gratis y ahí la diferencia crece.\n")

w("## 2. ¿Cuántos pagos hacen falta para cubrir lo gratis?\n")
bs = pl.buyers(); i1, a1, m1 = pl.margen(bs, 1)
marg_x_pagador = (i1 - a1) * 5 / len(bs)        # margen por comprador del plan de 20 € (12 meses, sin informes)
fh = nv.ev("FH", 1); marg_fh = fh["margen"] * 5 / fh["comp"]
w(f"Margen medio por comprador (sin contar los informes): plan de 20 €/mes {marg_x_pagador:.0f} €; F + H (arranque 19 € + meses activos) {marg_fh:.0f} €. Esto sale de mis supuestos de permanencia.\n")
w("Conversión mínima (%, de los registrados) para que lo gratis no cause pérdidas, con tope de 3 informes gratis:\n")
w("| | R = 0,10 $ | R = 0,30 $ | R = 0,60 $ | R = 1,00 $ |"); w("|---|---|---|---|---|")
for name, mp in (("Plan 20 €/mes", marg_x_pagador), ("F + H", marg_fh)):
    w(f"| {name} | " + " | ".join(f"{100 * R * free[3] / mp:.1f} %" for R in RS) + " |")
w("\nEn mis simulaciones pagaban el 13 % (plan de 20 €) y el 21 % (F); en la realidad serán muchos menos. Si el informe cuesta 1 $, necesitas que pague al menos 1 de cada 30 registrados; con 0,30 $, 1 de cada 100.\n")

w("## 3. Plan de 20 €/mes con informes de pago ilimitados frente a tope de 5, 10 o 20\n")
w("Los informes de pago cuestan R cada uno; supongo que cada comprador genera los de sus ideas cada mes que paga, y que un comparador cuesta como un informe, una vez al mes si tiene 2 o más ideas.\n")
w("| Tope de informes de pago | Margen K=1 sin informes | Coste informes (R=0,30) | **Margen R=0,30** | **Margen R=1,00** |"); w("|---|---|---|---|---|")
for pc in (5, 10, 20, None):
    b = pl.buyers(pc=pc)
    i, a, m = pl.margen(b, 1)
    def informes(R, bb=b, pcc=pc):
        paid = sum((x["ideas"] if pcc is None else min(x["ideas"], pcc)) * rc.MESES[x["sigue"]] + (rc.MESES[x["sigue"]] if x["ideas"] >= 2 else 0) for x in bb)
        libre = sum(reports_free(x, 3) for x in pop)
        return R * (paid + libre) / 5
    w(f"| {cap_n(pc)} | {m:.0f} € | {informes(.3):.0f} € | **{m - informes(.3):.0f} €** | **{m - informes(1.0):.0f} €** |")
w("\nPara comparar, F + H y B con tope (margen K=1 sin informes: 507 € y 477 €) pagan el mismo coste de lo gratis (tope de 3), pero casi nada del coste de informes de pago porque el informe va dentro del arranque:\n")
w("| | Margen sin informes | Coste lo gratis (tope 3) R=0,30 | **Margen R=0,30** | **Margen R=1,00** |"); w("|---|---|---|---|---|")
lib = lambda R: R * sum(reports_free(x, 3) for x in pop) / 5
for name, mm in (("F + H", nv.ev("FH", 1)["margen"]), ("B con tope 4 $", rc.eval_alt("B", 1, bv=True)["margen"])):
    w(f"| {name} | {mm:.0f} € | {lib(.3):.0f} € | **{mm - lib(.3):.0f} €** | **{mm - lib(1.0):.0f} €** |")
w("\n(Suscripción plana D, A y C quedan igual que en el anexo 1, restando el mismo coste de lo gratis.)\n")
open("resumen_informes_ia.md", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("\n".join(out))
