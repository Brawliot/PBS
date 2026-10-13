# Borrador del catálogo de plantillas (para aprobar)

Borrador de trabajo, NO está en el código ni en ningún commit. Los textos de las plantillas están en inglés porque son los que verá la persona. Cuando los apruebes (o los corrijas), se pasan tal cual a Haiku.

Reglas que he seguido:
- Ningún texto legal (contratos, términos, privacidad): no están decididos.
- Ninguna promesa de resultado ni cifra inventada.
- Un único hueco automático: `{{location}}` (se sustituye por la ubicación del informe si existe, y por `[your city]` si no). Los demás huecos van entre corchetes y los rellena la persona.
- La IA solo elige 3 identificadores de esta lista. Nunca escribe el contenido.

Cada plantilla lleva: identificador, título, `Purpose` (la línea en inglés que ve la persona antes de abrirla; la línea en español es solo para ti) y el texto del bloque de código, que se copia tal cual.

---

## 1. `supplier-quote` · Supplier quote request
Para qué sirve: pedir precios a dos o tres proveedores con las mismas preguntas, para poder compararlos.
Purpose (texto en inglés para la interfaz): Ask two or three suppliers the same questions so you can compare their quotes.

```
Subject: Quote request for [product or service]

Hello [supplier name],

I am setting up [your business, in one line] in {{location}} and I am comparing suppliers for [product or service].

Could you send me a quote with:
- Price per unit and for [quantity] units
- Delivery cost and delivery time to {{location}}
- Minimum order size
- Payment terms
- Warranty or returns policy

I plan to decide by [date]. If it is easier, we can talk by phone on [days and times].

Thank you,
[Your name]
[Phone or email]
```

## 2. `customer-interviews` · Customer interview script
Para qué sirve: hablar con 5 posibles clientes antes de gastar dinero, preguntando por su problema y no por tu idea.
Purpose (texto en inglés para la interfaz): Talk to 5 possible customers about their problem, not your idea, before you spend money.

```
Goal: understand how [type of customer] solves [problem] today. Do not pitch your idea.

Before you start: ask for 15 minutes, say you are not selling anything, and ask permission to take notes.

1. Tell me about the last time you [situation related to the problem].
2. What did you do? What did it cost you, in time or money?
3. What is the most annoying part?
4. What have you tried to fix it? What worked or did not?
5. How do you decide what to use or buy for this?
6. If a solution existed, what would it need to do for you to switch?
7. Who else should I talk to?

After each interview, write down:
- The exact words they used for the problem
- What they do today and what it costs them
- One thing that surprised you

Aim for 5 interviews. If three or more describe the same problem, you have a signal worth following.
```

## 3. `licence-enquiry` · Licence and permit enquiry
Para qué sirve: preguntar a la administración local qué permisos hacen falta, antes de invertir. No es asesoramiento legal.
Purpose (texto en inglés para la interfaz): Ask your local authority which permits you need before you invest. Not legal advice.

```
Subject: Enquiry about permits for [type of activity]

Hello,

I am planning to start [your business, in one line] in {{location}}. I would like to know which licences, registrations or permits I need before I begin, and what they involve.

My activity would be:
- What I will do: [short description]
- Where: [premises, street, online or mobile]
- Who I will serve: [type of customer]
- Planned start date: [date]

Could you tell me:
1. Which licences or registrations apply?
2. What each one costs and how long it takes?
3. Which documents I must provide?
4. Whether any inspection is needed, and when?

Thank you for your help.
[Your name]
[Phone or email]
```

## 4. `one-page-summary` · One-page business summary
Para qué sirve: poder explicar el negocio en una página a un socio, un banco o un colaborador.
Purpose (texto en inglés para la interfaz): Explain your business on one page to a partner, a bank or a collaborator.

```
Business name: [name]
Date: [date]

1. What we do (one sentence):
2. Who it is for:
3. The problem they have:
4. How we solve it:
5. How we make money (price and what is included):
6. How customers will find us (first 2 or 3 channels):
7. What we need to start (money, people, permits):
8. What can go wrong (top 3 risks) and what we will do about each:
9. What we do in the next 30 days:
10. How we will know it is working (one number and a date):
```

## 5. `startup-costs` · Startup cost sheet
Para qué sirve: apuntar cada gasto inicial, con presupuesto y precio real, para ver si el dinero alcanza.
Purpose (texto en inglés para la interfaz): Track every starting cost, estimated and real, to see if your money is enough.

```
Item | Category | Estimated cost | Quote or real cost | Paid? | Notes
-----|----------|----------------|--------------------|-------|------
[ ]  | Equipment |               |                    |       |
[ ]  | Permits and fees |        |                    |       |
[ ]  | Stock or materials |      |                    |       |
[ ]  | Marketing |               |                    |       |
[ ]  | Insurance |               |                    |       |
[ ]  | Other |                   |                    |       |

Total estimated:
Total real so far:
Money available:
Difference (available minus estimated):

Rule of thumb for yourself: add a line "Unexpected" and write what you are comfortable setting aside for it.
```

## 6. `first-four-weeks` · First four weeks checklist
Para qué sirve: convertir el informe en acciones concretas para el primer mes.
Purpose (texto en inglés para la interfaz): Turn the report into concrete actions for your first month.

```
Week 1 – Find out
[ ] Write down the three questions you most need answered.
[ ] Talk to two possible customers.
[ ] Ask which permits apply in {{location}}.

Week 2 – Check the numbers
[ ] Get two quotes for your biggest cost.
[ ] Fill in the startup cost sheet.
[ ] Decide your first price.

Week 3 – Test
[ ] Offer your product or service to five people and note their reaction.
[ ] Write down what they asked for that you did not offer.

Week 4 – Decide
[ ] List what worked and what did not.
[ ] Decide: continue, change something, or stop.
[ ] Choose the next three actions and a date for each.
```

## 7. `competitor-visit` · Competitor visit notes
Para qué sirve: mirar de cerca a 3 competidores y comparar con las mismas preguntas.
Purpose (texto en inglés para la interfaz): Look closely at three competitors and compare them with the same questions.

```
For each competitor (aim for three) in {{location}}:

Name and where you found it:
What they offer:
Their prices (write down exactly what you saw):
How busy it looked, and when:
What customers seem to like (reviews, queues, comments):
What customers complain about:
How they get customers (signs, social media, partners):
One thing they do better than you plan to:
One thing you could do differently:

After three visits: what is common to all of them, and what nobody offers?
Only note what you can see in public. Do not rely on rumours.
```

## 8. `price-test` · Price test with real customers
Para qué sirve: probar un precio con 5–10 personas antes de fijarlo.
Purpose (texto en inglés para la interfaz): Try a price with 5 to 10 people before you set it.

```
Goal: learn whether people accept your price, not whether they say they like the idea.

1. Choose a price you would be happy with. Write it down: [price].
2. Describe what the customer gets in two sentences.
3. Ask 5 to 10 possible customers: "This costs [price]. Would you buy it today?"
4. If they hesitate, ask: "What would make it an easy yes?"
5. If they say no, ask: "At what price would it feel too cheap to trust?" and "At what price would it be too expensive?"
6. Write every answer in this table:

Person | Said yes / maybe / no | Reason | Price they suggested

Read the table: if most say maybe or no for the same reason, change the offer or the price and test again with new people.
Note: people say yes more often than they pay. A real purchase or deposit is a stronger signal than a yes.
```

---

# Cómo elige la IA (opción C)

- La llamada de las razones recibe esta lista de identificadores (con su línea de "para qué sirve") y devuelve exactamente 3, distintos y de la lista.
- Si devuelve otra cosa (un identificador inventado, repetidos, más o menos de 3), esa parte se descarta y el informe se ve sin plantillas. Las razones, el plazo y el desglose no se pierden por eso.
- Si no hay IA disponible o falla, no se muestra el botón (no se inventa una selección).
