/**
 * The catalog of starter templates the report offers. The text is fixed here and never written by the model: the
 * model only picks three ids from it (planner-explain-handler.ts). The bodies are copied as they were approved; the
 * only automatic placeholder is {{location}}, the rest are brackets the person fills in. Texts are in English.
 */

export interface ReportTemplate {
  /** The identifier the model picks: a short word, unique in the catalog */
  id: string;
  /** The heading of the template */
  title: string;
  /** The one line the person reads before opening it */
  purpose: string;
  /** The text to copy. The only automatic placeholder is {{location}} */
  body: string;
}

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  {
    id: "supplier-quote",
    title: "Supplier quote request",
    purpose: "Ask two or three suppliers the same questions so you can compare their quotes.",
    body: "Subject: Quote request for [product or service]\n\nHello [supplier name],\n\nI am setting up [your business, in one line] in {{location}} and I am comparing suppliers for [product or service].\n\nCould you send me a quote with:\n- Price per unit and for [quantity] units\n- Delivery cost and delivery time to {{location}}\n- Minimum order size\n- Payment terms\n- Warranty or returns policy\n\nI plan to decide by [date]. If it is easier, we can talk by phone on [days and times].\n\nThank you,\n[Your name]\n[Phone or email]",
  },
  {
    id: "customer-interviews",
    title: "Customer interview script",
    purpose: "Talk to 5 possible customers about their problem, not your idea, before you spend money.",
    body: "Goal: understand how [type of customer] solves [problem] today. Do not pitch your idea.\n\nBefore you start: ask for 15 minutes, say you are not selling anything, and ask permission to take notes.\n\n1. Tell me about the last time you [situation related to the problem].\n2. What did you do? What did it cost you, in time or money?\n3. What is the most annoying part?\n4. What have you tried to fix it? What worked or did not?\n5. How do you decide what to use or buy for this?\n6. If a solution existed, what would it need to do for you to switch?\n7. Who else should I talk to?\n\nAfter each interview, write down:\n- The exact words they used for the problem\n- What they do today and what it costs them\n- One thing that surprised you\n\nAim for 5 interviews. If three or more describe the same problem, you have a signal worth following.",
  },
  {
    id: "licence-enquiry",
    title: "Licence and permit enquiry",
    purpose: "Ask your local authority which permits you need before you invest. Not legal advice.",
    body: "Subject: Enquiry about permits for [type of activity]\n\nHello,\n\nI am planning to start [your business, in one line] in {{location}}. I would like to know which licences, registrations or permits I need before I begin, and what they involve.\n\nMy activity would be:\n- What I will do: [short description]\n- Where: [premises, street, online or mobile]\n- Who I will serve: [type of customer]\n- Planned start date: [date]\n\nCould you tell me:\n1. Which licences or registrations apply?\n2. What each one costs and how long it takes?\n3. Which documents I must provide?\n4. Whether any inspection is needed, and when?\n\nThank you for your help.\n[Your name]\n[Phone or email]",
  },
  {
    id: "one-page-summary",
    title: "One-page business summary",
    purpose: "Explain your business on one page to a partner, a bank or a collaborator.",
    body: "Business name: [name]\nDate: [date]\n\n1. What we do (one sentence):\n2. Who it is for:\n3. The problem they have:\n4. How we solve it:\n5. How we make money (price and what is included):\n6. How customers will find us (first 2 or 3 channels):\n7. What we need to start (money, people, permits):\n8. What can go wrong (top 3 risks) and what we will do about each:\n9. What we do in the next 30 days:\n10. How we will know it is working (one number and a date):",
  },
  {
    id: "startup-costs",
    title: "Startup cost sheet",
    purpose: "Track every starting cost, estimated and real, to see if your money is enough.",
    body: "Item | Category | Estimated cost | Quote or real cost | Paid? | Notes\n-----|----------|----------------|--------------------|-------|------\n[ ]  | Equipment |               |                    |       |\n[ ]  | Permits and fees |        |                    |       |\n[ ]  | Stock or materials |      |                    |       |\n[ ]  | Marketing |               |                    |       |\n[ ]  | Insurance |               |                    |       |\n[ ]  | Other |                   |                    |       |\n\nTotal estimated:\nTotal real so far:\nMoney available:\nDifference (available minus estimated):\n\nRule of thumb for yourself: add a line \"Unexpected\" and write what you are comfortable setting aside for it.",
  },
  {
    id: "first-four-weeks",
    title: "First four weeks checklist",
    purpose: "Turn the report into concrete actions for your first month.",
    body: "Week 1 – Find out\n[ ] Write down the three questions you most need answered.\n[ ] Talk to two possible customers.\n[ ] Ask which permits apply in {{location}}.\n\nWeek 2 – Check the numbers\n[ ] Get two quotes for your biggest cost.\n[ ] Fill in the startup cost sheet.\n[ ] Decide your first price.\n\nWeek 3 – Test\n[ ] Offer your product or service to five people and note their reaction.\n[ ] Write down what they asked for that you did not offer.\n\nWeek 4 – Decide\n[ ] List what worked and what did not.\n[ ] Decide: continue, change something, or stop.\n[ ] Choose the next three actions and a date for each.",
  },
  {
    id: "competitor-visit",
    title: "Competitor visit notes",
    purpose: "Look closely at three competitors and compare them with the same questions.",
    body: "For each competitor (aim for three) in {{location}}:\n\nName and where you found it:\nWhat they offer:\nTheir prices (write down exactly what you saw):\nHow busy it looked, and when:\nWhat customers seem to like (reviews, queues, comments):\nWhat customers complain about:\nHow they get customers (signs, social media, partners):\nOne thing they do better than you plan to:\nOne thing you could do differently:\n\nAfter three visits: what is common to all of them, and what nobody offers?\nOnly note what you can see in public. Do not rely on rumours.",
  },
  {
    id: "price-test",
    title: "Price test with real customers",
    purpose: "Try a price with 5 to 10 people before you set it.",
    body: "Goal: learn whether people accept your price, not whether they say they like the idea.\n\n1. Choose a price you would be happy with. Write it down: [price].\n2. Describe what the customer gets in two sentences.\n3. Ask 5 to 10 possible customers: \"This costs [price]. Would you buy it today?\"\n4. If they hesitate, ask: \"What would make it an easy yes?\"\n5. If they say no, ask: \"At what price would it feel too cheap to trust?\" and \"At what price would it be too expensive?\"\n6. Write every answer in this table:\n\nPerson | Said yes / maybe / no | Reason | Price they suggested\n\nRead the table: if most say maybe or no for the same reason, change the offer or the price and test again with new people.\nNote: people say yes more often than they pay. A real purchase or deposit is a stronger signal than a yes.",
  },
];
