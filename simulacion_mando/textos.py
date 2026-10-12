# Frases para las notas. Se combinan según el estado de la persona; no son citas reales.

R = {
 ("NC", "PREFIERO_GRATIS"): ["usa un chat de IA gratis para esto y no ve por qué pagar otra cosa", "solo se queda si todo lo útil es gratis; lo de pago lo ignora",
    "dice que ya hay cosas gratis de sobra y no piensa pagar", "lo probaría mientras sea gratis; el día que cobren se va", "el informe le parece bien, pero ni un euro por la IA"],
 ("NC", "NO_LO_NECESITO"): ["lo lleva con un cuaderno y una hoja de cálculo y le funciona", "su negocio es simple; un plan con departamentos le parece excesivo",
    "lo ve para empresas grandes, no para lo suyo", "solo curiosea; no tiene intención real de montar nada ahora", "su gestor ya le dice lo que necesita"],
 ("NC", "DESCONFIANZA_IA"): ["no se fía de que la IA escriba un estudio de viabilidad sin errores", "ha visto a la IA inventar datos y no quiere un plan apoyado en eso",
    "cree que la IA le dará un plan genérico igual que a todos", "no paga por borradores que luego tiene que revisar enteros"],
 ("NC", "PRIVACIDAD_IDEA"): ["no sube su idea a un servicio sin saber quién la ve", "teme que su idea sirva para entrenar la IA de otros",
    "pregunta primero dónde se guardan los datos y nadie se lo aclara", "su idea es lo único que tiene; no la sube a ningún sitio"],
 ("NC", "PRECIO"): ["con su presupuesto cada euro cuenta; no paga herramientas ahora", "12 € le parecen mucho en su país; lo compara con su factura de internet",
    "dice que esto debería costar cero hasta que facture", "primero quiere ver ingresos y luego ya pagará algo"],
 ("NC", "OTRO"): ["prefiere hablar con una persona, no con una pantalla", "cree que los planes a un año no sirven: todo cambia cada mes",
    "ya paga una gestoría y no quiere duplicar", "no tiene tiempo ni para abrir la herramienta"],
 ("NC", "NO_ENTIENDO"): ['no sabe si lo que le ofrecen es una prueba o un compromiso', 'le cuesta entender qué se paga por proyecto y qué por IA', "no entiende qué es el esqueleto ni los departamentos y cierra la pestaña", "no sabe qué es gratis y qué no, y prefiere no arriesgar",
    "dice que la página de precios parece un laberinto"],
 ("NC", "LIMITES_FRUSTRAN"): ["ha tenido malas experiencias con límites que se acaban sin avisar", "odia que le corten el servicio; prefiere no empezar"],
 ("AB", "NO_ENTIENDO"): ['se pierde entre tantas fases y departamentos y no sabe por dónde seguir', 'entra tres veces, no sabe qué botón toca y deja de entrar', 'no distingue lo que es gratis de lo que gasta ayuda de IA y prefiere no tocar', "lo prueba, se pierde entre fases y tareas y lo deja a la segunda semana", "no entiende la diferencia entre presupuesto de arranque y ayuda mensual y no sigue",
    "no sabe qué botón gasta y cuál no; para no gastar no toca nada"],
 ("AB", "LIMITES_FRUSTRAN"): ["se queda sin ayuda de IA a mitad de un paso y lo deja enfadado", "ve el contador bajar y se bloquea: usa menos para no gastarlo y acaba dejándolo",
    "le salta el límite justo cuando más lo necesita y no vuelve"],
 ("AB", "NO_LO_NECESITO"): ["tras el informe ya tiene lo que quería y no vuelve al plan", "el plan le parece mucho trabajo y acaba haciendo lo de siempre"],
 ("AB", "OTRO"): ["se le pasan las semanas, olvida la herramienta y al volver el plan está desfasado", "cambia de idea de negocio y deja el proyecto a medias",
    "la vida real se come el tiempo y el plan queda en el segundo mes"],
 ("AB", "DESCONFIANZA_IA"): ["los primeros documentos de IA le parecen genéricos y no vuelve", "revisa las sugerencias, encuentra errores y pierde la confianza"],
 ("AB", "PRECIO"): ['con el primer aviso de pago deja de entrar', "iba a pagar, pero al llegar al límite busca algo más barato y se va"],
 ("AB", "PREFIERO_GRATIS"): ["al toparse con el límite de lo gratis se pasa a otra herramienta gratuita"],
 ("AB", "PRIVACIDAD_IDEA"): ['lee la política de datos a mitad del plan y deja de subir cosas', 'pregunta quién ve su idea, no recibe respuesta clara y se va', "a medio plan se acuerda de dónde están sus datos y borra la cuenta"],
 ("PG", "PRECIO"): ["pagaría solo si es poco y claro; cuanto más cuesta, menos lo usará", "le parece caro para lo que usa; con la mitad no lo dudaría",
    "pagaría cuando entren ingresos; ahora lo justo", "lo compara con lo que ya paga por otras herramientas y le sale caro"],
 ("PG", "LIMITES_FRUSTRAN"): ["paga, pero quiere saber de antemano qué pasa al llegar al límite", "le irrita que la ayuda mensual no se acumule: paga por lo que no usa",
    "acepta pagar con tal de que nunca le corten a mitad de un paso"],
 ("PG", "NO_ENTIENDO"): ['pide que alguien le explique en dos frases qué paga y cuándo', 'no sabe si el presupuesto de arranque se gasta solo al empezar o durante todo el plan', "duda de cuánto va a gastar en total; pide un ejemplo con números", "no tiene claro si proyecto es un negocio o cada fase"],
 ("PG", "DESCONFIANZA_IA"): ["paga si los documentos son un buen borrador; si no, cancela", "quiere ver una muestra antes de pagar nada"],
 ("PG", "PRIVACIDAD_IDEA"): ['pide saber quién ve su idea antes de pagar', 'pagaría más si pudiera borrar su proyecto y sus datos cuando quiera', 'su decisión depende de una política de datos clara', "pagaría si garantizan por escrito que su idea no se reutiliza"],
 ("PG", "PREFIERO_GRATIS"): ['pagaría solo si el nivel gratis no le sirve; mientras sirva, no paga', 'si pudiera quedarse gratis para siempre, no pagaría', "paga algo solo si lo gratuito se queda corto; lo gratis es lo que más le atrae"],
 ("PG", "NO_LO_NECESITO"): ['paga más por orden mental que porque lo necesite', 'lo ve como un seguro: probablemente use poco', "paga más por tranquilidad que por necesidad"],
 ("PG", "OTRO"): ["quiere factura a nombre de la empresa para desgravar", "preferiría pagar en moneda local, no en euros", "necesita enseñar a sus clientes un informe con su marca",
    "le da ansiedad el contador: cada clic le hace dudar"],
}
CONFUSION = {
 "A": "cree que la asignación mensual se acumula como una hucha",
 "B": "piensa que los 29 € son mensuales y no un pago único",
 "C": "cree que los créditos caducan como las millas de avión",
 "D": "no sabe si Pro cuenta los proyectos aparte de las acciones de IA",
 "E": "entiende la ventana de 5 horas como que solo puede usarlo 5 horas al día",
}
PREF = {
 "A": ["elige A: gratis y sin compromiso", "A porque puede probar sin pagar", "A: no hay riesgo si no pone la tarjeta"],
 "B": ["B: pago una vez y me olvido", "elige B porque sabe lo que gasta", "B le parece honrado: pagas por lo que usas"],
 "C": ["C: paga solo cuando usa", "C porque no quiere suscripciones", "elige C: control sobre cada gasto"],
 "D": ["elige D: tener proyectos de sobra", "D: lo de siempre, como cualquier suscripción", "D porque al pagar mensual ya no se lo piensa"],
 "E": ["elige E: ya conoce ese sistema por los chats de IA", "E porque le suena familiar", "E: le gusta que escale con el uso"],
}
REJ = {
 "A": ["rechaza A: lo que no usas se pierde", "A: no se fía de que lo gratis dure"],
 "B": ["rechaza B: pagar antes de ver la IA funcionar", "B: 29 € de golpe le pesan"],
 "C": ["rechaza C: no quiere un taxímetro", "C: ver el coste de cada clic le agobia"],
 "D": ["rechaza D: otra suscripción más", "D: se olvida de cancelar y le cobran de más"],
 "E": ["rechaza E: esperar horas para seguir con su plan es absurdo", "E: parece hecho para charlar, no para planificar un año"],
}
CONTRA = {
 "sub": "Dice que odia las suscripciones, pero elige D 'por si acaso'.",
 "gratis": "Dice que solo quiere gratis y aun así elige de pago.",
 "precio": "Se queja del precio pero pone dinero sobre la mesa.",
 "limit": "Dice que los límites le dan igual, pero cada límite le irrita.",
}
MARCHA = {
 "limite": ["quedarse sin ayuda de IA a mitad de una tarea sin aviso", "esperar días a que se renueve la ayuda cuando necesita avanzar", "que el límite se agote justo al rehacer sugerencias"],
 "cobro": ["un cobro que no esperaba o una renovación automática sin aviso", "que cada paso cueste algo sin saberlo antes", "subidas de precio sin avisar"],
 "calidad": ["documentos de IA genéricos que no sirven de borrador real", "errores en las sugerencias que le hacen perder confianza", "que el plan quede desfasado al cambiar una decisión"],
 "privacidad": ["enterarse de que su idea se usa para entrenar o la ven otros", "no poder borrar su proyecto y sus datos", "falta de claridad sobre dónde se guardan los datos"],
 "esfuerzo": ["tener que rellenar demasiado antes de ver algo útil", "que el plan sea demasiado largo y se sienta abrumado", "no entender qué botón gasta"],
 "valor": ["pagar y no volver a usarlo en semanas", "que lo gratis sea lo único útil y el resto no compense", "que un chat de IA corriente le dé lo mismo"],
}
SORPRESA = {
 "informe": ["que el informe inicial sea gratis y útil", "que el esqueleto del plan le ahorre horas"],
 "control": ["que la IA solo proponga y él decida todo", "poder aceptar o rechazar cada sugerencia", "ver el coste de cada paso antes de pulsar"],
 "limites": ["que le avisen de cuánto le queda y cuándo se renueva", "que la ayuda mensual se renueve sin pagar"],
 "docs": ["que los documentos de IA sirvan como borrador real", "que al cambiar una decisión se rehagan las sugerencias sin empezar de cero"],
 "precio": ["que no haya suscripción", "que el precio de salida sea más bajo de lo que esperaba", "que pagar una vez le cubra todo el proyecto"],
 "equipo": ["poder usarlo con varios clientes sin pagar de más", "que el plan se organice por departamentos con su gente"],
}

# Sustituciones por segmento (clave: (segmento, estado, objeción))
RS = {
 ("4", "NC", "NO_LO_NECESITO"): ["no tiene intención real de montar nada; solo mira por curiosidad", "lo abre para un trabajo de clase y luego no lo vuelve a tocar", "dice que ya lo explican en clase y no necesita herramienta"],
 ("4", "NC", "PRECIO"): ["como estudiante no paga herramientas; si no es gratis, no entra", "lo máximo que paga es una suscripción de música; esto no entra"],
 ("4", "AB", "NO_LO_NECESITO"): ["lo hace para el trabajo de clase y cuando entrega, lo abandona", "se le va el interés en cuanto aparece otra idea"],
 ("5", "PG", "PRECIO"): ["lo usaría con clientes, pero el coste tiene que poder repercutirlo o no sale a cuenta", "pagaría más por poder tener muchos clientes sin pagar por cada uno"],
 ("5", "PG", "LIMITES_FRUSTRAN"): ["necesita saber que no se queda sin IA a mitad de una reunión con un cliente", "con varios clientes a la vez, un límite semanal le haría quedar mal"],
 ("5", "PG", "OTRO"): ["necesita sacar informes con su marca y no con la de MANDO", "pide facturación mensual única para todos sus clientes"],
 ("6", "NC", "NO_LO_NECESITO"): ["para una inversión seria prefiere pagar a un asesor humano", "no cambia un abogado y un gestor por una herramienta"],
 ("3", "NC", "NO_LO_NECESITO"): ["su negocio ya funciona y lo lleva con su gestor; no ve qué le aporta", "ya sabe lo que tiene que hacer para abrir la segunda línea"],
 ("7", "NC", "NO_LO_NECESITO"): ["con una hoja de cálculo y su experiencia le basta", "no cree que una herramienta externa mejore su criterio"],
}
