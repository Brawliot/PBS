# Perfiles de segmento: TODOS los valores son SUPOSICIONES del simulador, no datos de mercado.
# Cada perfil fija cómo se reparten rasgos y qué proporción de personas nunca paga (nb) o abandona (ab).

PAISES = [("España", .40), ("Latinoamérica", .27), ("EE. UU.", .10), ("resto de Europa", .15), ("otros", .08)]
EQUIPOS = ["solo", "pequeño", "mediano", "grande"]
HORAS = ["<10", "10-20", "20-40", "completa"]

# age=(media, sd, min, max) tech/psens=(baja, media, alta) budget=(mediana USD, sigma, min, max, prob_cero)
# exp=(media, sd) team/hours = pesos sobre EQUIPOS / HORAS
# serious/multi/sub/trust/priv = medias de rasgos ocultos 0..1; m = mediana de disposición mensual en € (suposición)
# nb, ab = proporción de personas que NUNCA pagan / que prueban y abandonan sin pagar
P = {}

def add(key, **kw):
    P[key] = kw

add("1 Primerizo", n=125, age=(31, 8, 18, 55), tech=(.15, .50, .35), psens=(.05, .30, .65),
    budget=(1500, 1.0, 100, 25000, .20), exp=(2.5, 2.5), team=(.80, .17, .03, 0), hours=(.45, .30, .15, .10),
    serious=.40, multi=.12, sub=.60, trust=.50, priv=.30, m=7, nb=.34, ab=.25,
    ideas=["Tienda online de velas artesanales", "Canal de repostería con curso de pago", "App para organizar turnos de canguros",
           "Estudio de diseño de interiores", "Cafetería de especialidad en su barrio", "Catering vegano de fin de semana",
           "Academia online de guitarra", "Marca de ropa de segunda mano", "Huerto urbano con cajas semanales",
           "Estudio boutique de yoga", "Reparación de bicicletas a domicilio", "Podcast con patrocinadores",
           "Agencia de viajes de nicho", "Negocio de impresión 3D", "Paseo de perros en su ciudad", "Escuela de idiomas para adultos"])
add("2 Autónomo", n=75, age=(37, 9, 24, 60), tech=(.15, .50, .35), psens=(.10, .45, .45),
    budget=(2500, 1.0, 0, 30000, .10), exp=(7, 4), team=(.80, .20, 0, 0), hours=(.15, .30, .30, .25),
    serious=.60, multi=.22, sub=.50, trust=.50, priv=.30, m=12, nb=.28, ab=.20,
    ideas=["Formalizar su trabajo de diseño gráfico", "Crecer su estudio de fotografía de bodas", "Pasar de freelance de programación a mini agencia",
           "Convertir clases particulares en academia", "Marca de coaching propia", "Pasar de traducciones sueltas a empresa de localización",
           "Taller de carpintería a medida", "Consultoría de marketing para pymes", "Limpieza para pisos turísticos",
           "Gestión de redes sociales para restaurantes", "Ilustración y merchandising", "Electricista que quiere montar cuadrilla"])
add("3 Dueño pyme", n=75, age=(47, 9, 30, 68), tech=(.30, .50, .20), psens=(.25, .50, .25),
    budget=(20000, 1.0, 3000, 250000, 0), exp=(11, 5), team=(.10, .55, .30, .05), hours=(.25, .40, .25, .10),
    serious=.70, multi=.25, sub=.35, trust=.50, priv=.35, m=17, nb=.30, ab=.18,
    ideas=["Segunda línea de producto en su panadería", "Venta online para su ferretería", "Segundo local de su peluquería",
           "Catering dentro de su restaurante", "Taller de reparaciones junto a su tienda", "Servicio de instalación en su empresa de climatización",
           "Gama ecológica en su bodega", "Segunda clínica de fisioterapia", "Coworking en el local que le sobra", "Cursos en su academia de baile"])
add("4 Estudiante", n=75, age=(22, 3.5, 17, 32), tech=(.05, .35, .60), psens=(.02, .18, .80),
    budget=(250, .8, 0, 3000, .60), exp=(.5, .8), team=(.95, .05, 0, 0), hours=(.80, .15, .05, 0),
    serious=.10, multi=.45, sub=.60, trust=.55, priv=.20, m=3, nb=.66, ab=.20,
    ideas=["Idea para el trabajo final de máster", "Curiosidad tras ver un vídeo de emprendedores", "Varias ideas sueltas de apps",
           "Proyecto de la asignatura de emprendimiento", "Por si algún día monta algo", "Tienda que aún no sabe si hará",
           "Explorar ideas para el verano", "Idea de negocio para presentar en un concurso"])
add("5 Consultor/mentor", n=40, age=(46, 9, 30, 65), tech=(.10, .45, .45), psens=(.30, .50, .20),
    budget=(15000, 1.0, 1000, 200000, 0), exp=(14, 3.5), team=(.60, .35, .05, 0), hours=(.10, .25, .35, .30),
    serious=.80, multi=.90, sub=.15, trust=.55, priv=.45, m=30, nb=.15, ab=.17,
    ideas=["Asesora a pequeñas empresas en su plan de arranque", "Mentor en una incubadora local", "Gestoría que atiende a emprendedores",
           "Consultor de franquicias", "Mentora de mujeres emprendedoras en una asociación", "Asesor de agroturismo",
           "Consultora de subvenciones", "Formador de un programa municipal de emprendimiento"])
add("6 Con capital", n=35, age=(50, 9, 33, 70), tech=(.25, .50, .25), psens=(.50, .40, .10),
    budget=(150000, .8, 30000, 1000000, 0), exp=(4, 4), team=(.30, .50, .15, .05), hours=(.30, .40, .20, .10),
    serious=.80, multi=.25, sub=.35, trust=.50, priv=.55, m=22, nb=.25, ab=.20,
    ideas=["Invertir en un restaurante con un socio", "Clínica veterinaria", "Apartamentos turísticos reformados",
           "Gimnasio de barrio", "Startup de agrotecnología", "Cadena pequeña de cafeterías", "Colegio infantil bilingüe",
           "Planta pequeña de reciclaje de plásticos", "Hotel rural", "Marca de cosmética natural"])
add("7 Escéptico", n=50, age=(43, 11, 25, 68), tech=(.10, .40, .50), psens=(.15, .45, .40),
    budget=(3000, 1.6, 0, 300000, .10), exp=(8, 6), team=(.50, .30, .15, .05), hours=(.30, .30, .25, .15),
    serious=.40, multi=.25, sub=.60, trust=.12, priv=.80, m=6, nb=.66, ab=.20,
    ideas=["App de logística local", "Taller de cerámica", "Consultoría de energía", "Marca de bicis eléctricas",
           "Formación técnica para empresas", "Tienda de productos locales", "Software para clínicas", "Pequeña imprenta"])

# Segmento 8 "Otros": subtipos inventados por el simulador. 25 personas en total.
add("8 Otros: jubilado", n=6, age=(63, 4, 55, 74), tech=(.60, .35, .05), psens=(.15, .55, .30),
    budget=(8000, .9, 500, 60000, .05), exp=(10, 7), team=(.85, .15, 0, 0), hours=(.50, .35, .10, .05),
    serious=.35, multi=.10, sub=.65, trust=.40, priv=.45, m=6, nb=.40, ab=.30,
    ideas=["Tienda pequeña de miel y conservas", "Taller de restauración de muebles", "Clases de informática para mayores"])
add("8 Otros: desempleado", n=5, age=(40, 9, 25, 58), tech=(.25, .55, .20), psens=(0, .15, .85),
    budget=(300, .9, 0, 3000, .40), exp=(4, 4), team=(1, 0, 0, 0), hours=(.10, .20, .30, .40),
    serious=.55, multi=.10, sub=.65, trust=.50, priv=.25, m=4, nb=.40, ab=.25,
    ideas=["Autónomo en limpieza industrial", "Tienda de ropa en un marketplace", "Reparto de comida propio"])
add("8 Otros: ONG/cooperativa", n=4, age=(45, 8, 30, 62), tech=(.25, .55, .20), psens=(.10, .40, .50),
    budget=(12000, .9, 1000, 60000, 0), exp=(8, 5), team=(.10, .55, .30, .05), hours=(.20, .40, .30, .10),
    serious=.65, multi=.40, sub=.45, trust=.45, priv=.40, m=8, nb=.30, ab=.20,
    ideas=["Cooperativa de consumo", "Banco de alimentos con tienda solidaria", "Asociación de talleres para jóvenes"])
add("8 Otros: profesor", n=4, age=(44, 8, 30, 62), tech=(.10, .40, .50), psens=(.20, .50, .30),
    budget=(1000, .9, 0, 10000, .20), exp=(10, 5), team=(.90, .10, 0, 0), hours=(.40, .40, .15, .05),
    serious=.45, multi=.80, sub=.40, trust=.55, priv=.30, m=15, nb=.15, ab=.20,
    ideas=["Usarlo en un curso de emprendimiento con 30 alumnos", "Ejercicios de plan de negocio en FP", "Taller para un centro de empleo"])
add("8 Otros: inversor pequeño", n=3, age=(52, 8, 38, 66), tech=(.15, .50, .35), psens=(.55, .35, .10),
    budget=(100000, .7, 30000, 500000, 0), exp=(9, 5), team=(.50, .40, .10, 0), hours=(.40, .40, .15, .05),
    serious=.70, multi=.70, sub=.30, trust=.45, priv=.65, m=25, nb=.20, ab=.15,
    ideas=["Evaluar planes de cinco microproyectos antes de invertir", "Revisar planes de ideas que le presentan", "Filtrar ideas para una pequeña incubadora"])
add("8 Otros: serial", n=3, age=(35, 7, 24, 50), tech=(.05, .35, .60), psens=(.15, .50, .35),
    budget=(4000, 1.0, 0, 30000, .10), exp=(5, 4), team=(.70, .30, 0, 0), hours=(.20, .30, .30, .20),
    serious=.35, multi=.85, sub=.50, trust=.55, priv=.30, m=12, nb=.30, ab=.35,
    ideas=["Tres ideas a la vez: app, tienda y servicio", "Cambia de idea cada seis meses", "Prueba un negocio nuevo cada temporada"])

# Precios de referencia (€) en tres puntos: mitad, referencia, doble. Unidad: A, D, E por mes; B por proyecto; C por paquete.
PRECIOS = {
    "A": (6, 12, 24),
    "B": (14.5, 29, 58),
    "C": (7.5, 15, 30),
    "D": (9.5, 19, 38),
    "E": (10, 20, 40),
}
NEGOCIO = (24.5, 49, 98)
NOMBRES = {"A": "gratis con asignación mensual", "B": "pago por proyecto", "C": "créditos prepago",
           "D": "suscripción por niveles", "E": "ventanas de uso tipo chat"}
UNIDAD = {"A": "€/mes", "B": "€/proyecto", "C": "€/paquete", "D": "€/mes", "E": "€/mes"}
# Cuánto vale cada alternativa respecto a la disposición mensual m (suposición): B es un pago único => varios meses equivalentes
UNIDAD_FACTOR = {"A": .75, "B": 2.4, "C": 1.3, "D": 1.0, "E": .9}
