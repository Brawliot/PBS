/**
 * Business profile classification using 15 key dimensions
 */

import {
  buildState,
  callJev,
  type JevQuestion,
  type JevResponse,
  type PlannerInput,
} from "./planner-handler.js";
import type { PlannerAnswer, Phase2Response } from "./planner-phase2-handler.js";

export type DimensionKey =
  | "customer_segment"
  | "revenue_model"
  | "offering_type"
  | "acquisition_channel"
  | "competition"
  | "differentiator"
  | "validation_stage"
  | "founder_profile"
  | "deadline_rigidity"
  | "capital_intensity"
  | "team_requirement"
  | "time_to_revenue"
  | "regulatory_load"
  | "third_party_dependency"
  | "money_handling";

export interface Profile {
  values: Record<DimensionKey, string>;
  unknown: DimensionKey[];
  known: number;
  total: number;
}

interface Dimension {
  key: DimensionKey;
  question: string;
  options: Record<string, string>;
}

const DIMENSIONS: Dimension[] = [
  {
    key: "customer_segment",
    question: "Who is the customer?",
    options: {
      "Consumers": "Individual consumers or households",
      "Small businesses (1-50)": "Small businesses with 1 to 50 employees",
      "Medium businesses (51-250)": "Medium businesses with 51 to 250 employees",
      "Large businesses (250+)": "Large businesses with more than 250 employees",
      "Public sector": "Government or public agencies",
      "Nonprofits": "Nonprofit or charitable organizations",
      "Two-sided marketplace": "Both buyers and sellers or service providers",
      "Mixed segments": "Multiple customer types",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "revenue_model",
    question: "How does the business make money?",
    options: {
      "Subscription": "Recurring monthly or annual fees",
      "One-time sale": "Single purchase or license",
      "Transaction commission": "Commission on transactions between parties",
      "Usage-based": "Fees based on usage or consumption",
      "Advertising": "Revenue from ads shown to users",
      "Freemium": "Free tier with premium paid features",
      "Services by hours or projects": "Hourly rates or project-based fees",
      "Licensing": "Licensing of IP or patents",
      "Hybrid": "Multiple revenue streams combined",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "offering_type",
    question: "What does it offer?",
    options: {
      "Physical product": "Tangible goods or merchandise",
      "Software": "Application, SaaS, or digital software",
      "People-delivered service": "Service delivered by people",
      "Platform or marketplace": "Platform connecting buyers and sellers",
      "Content or media": "Digital or physical content",
      "Hardware plus software": "Combination of device and software",
      "Physical venue": "Location-based business (retail, restaurant)",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "acquisition_channel",
    question: "How will it get customers?",
    options: {
      "Online self-service": "Customers find and purchase online independently",
      "Direct sales": "Sales team sells directly to customers",
      "Partners or channel": "Through resellers or partner networks",
      "Foot traffic or location": "Physical location attracts customers",
      "Community or word of mouth": "Referrals and community growth",
      "Paid advertising": "Paid ads online or offline",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "competition",
    question: "What is the competition like?",
    options: {
      "Niche with no clear competitors": "Unique market with minimal competition",
      "Few competitors": "Small number of established competitors",
      "Crowded market": "Many competitors in the space",
      "Dominated by large players": "Large companies dominate the market",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "differentiator",
    question: "What sets it apart?",
    options: {
      "Technology or IP": "Proprietary technology or intellectual property",
      "Price": "Significantly lower or premium pricing",
      "Quality or experience": "Superior product or customer experience",
      "Specialized niche": "Focus on underserved niche market",
      "Convenience or speed": "Faster or more convenient than alternatives",
      "Brand": "Strong brand recognition or trust",
      "Network effect": "Value grows with more users or participants",
      "None identified": "No clear differentiator identified",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "validation_stage",
    question: "How validated is it?",
    options: {
      "Idea only": "Concept without external validation",
      "Problem validated": "Confirmed that the problem exists",
      "Prototype": "Working prototype or MVP developed",
      "Solution validated with users": "Users confirmed the solution works",
      "MVP with customers": "Minimum viable product with early customers",
      "Generating revenue": "Currently making money from customers",
      "Growing": "Revenue and user base are growing",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "founder_profile",
    question: "What can the user do themselves?",
    options: {
      "Technical": "Technical skills (engineering, coding, design)",
      "Commercial": "Sales and business development skills",
      "Sector expert": "Deep expertise in the industry",
      "Management": "Leadership and team management experience",
      "Several areas": "Skills in multiple areas",
      "No relevant background": "Minimal relevant background or skills",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "deadline_rigidity",
    question: "How firm is the deadline?",
    options: {
      "Fixed date": "Hard deadline that cannot change",
      "Target date": "Preferred date but some flexibility",
      "Flexible": "Flexible timeline with no specific deadline",
      "No deadline": "No deadline mentioned or required",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "capital_intensity",
    question: "How much capital does the business need?",
    options: {
      "Low (digital, near-zero marginal cost)": "Minimal capital requirements",
      "Medium": "Moderate capital investment needed",
      "High (inventory, equipment, premises or R&D)": "Significant capital for assets or R&D",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "team_requirement",
    question: "What team does it need?",
    options: {
      "Feasible solo": "Can be done by one person",
      "Small team (2-3)": "Needs a small team of 2-3 people",
      "Large team": "Requires larger team of 4+ people",
      "Specialized profiles required": "Needs people with specific expertise",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "time_to_revenue",
    question: "How long until the first revenue?",
    options: {
      "Immediate": "Can generate revenue within weeks",
      "0-3 months": "Revenue expected within 0-3 months",
      "3-12 months": "Revenue expected within 3-12 months",
      "More than 12 months": "Revenue will take more than 12 months",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "regulatory_load",
    question: "How regulated is the business?",
    options: {
      "None": "No regulatory requirements",
      "Light": "Minimal regulatory requirements",
      "Moderate (licenses, data protection)": "Licenses or data protection compliance needed",
      "Heavy (health, finance, food)": "Strict regulations in health, finance, or food",
      "Critical or multi-jurisdiction": "Very strict or cross-border regulations",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "third_party_dependency",
    question: "How much does it depend on third parties?",
    options: {
      "Autonomous": "Fully independent operation",
      "Few key partners": "Depends on a few key partners",
      "Many partners": "Requires many partner relationships",
      "Depends on a platform": "Relies on a third-party platform",
      "Critical dependency": "Critically dependent on a single provider",
      "Not specified": "The description and answers do not say",
    },
  },
  {
    key: "money_handling",
    question: "Does it handle other people's money?",
    options: {
      "No third-party money": "Does not handle customer funds",
      "Collects through a payment provider": "Uses payment provider (Stripe, PayPal)",
      "Holds or intermediates funds": "Holds or manages customer funds",
      "Not specified": "The description and answers do not say",
    },
  },
];

function buildDimensionState(
  input: PlannerInput,
  jev: JevResponse,
  phase2: Phase2Response | undefined,
  answers: PlannerAnswer[],
): string {
  const choice = (key: string) => jev.answers[key]?.choice ?? "unknown";
  const given = answers.length
    ? answers.map((a) => `- [${a.topic}] ${a.question} -> ${a.answer}`).join("\n")
    : "(none)";
  // The final request has no phase 2 analysis: the idea and the answers carry the context
  const details = phase2
    ? `\n- Subsector/Details: ${phase2.subsector.value}\n- Location: ${phase2.location.value}`
    : "";

  return `Business idea and form data: ${buildState(input)}

Key context:
- Sector: ${choice("sector")}
- Geographic scope: ${choice("geographic_scope")}
- Timeline: ${choice("timeline")}${details}

User answers:
${given}
`;
}

export async function analyzeProfile(
  input: PlannerInput,
  jev: JevResponse,
  phase2: Phase2Response | undefined,
  answers: PlannerAnswer[] = [],
): Promise<Profile> {
  const questions: Record<string, JevQuestion> = {};
  for (const dimension of DIMENSIONS) {
    questions[dimension.key] = {
      type: "choice",
      instructions: `${dimension.question} Choose an option only if the description or the user's answers support it; otherwise choose "Not specified".`,
      criteria: dimension.options,
    };
  }

  const response = await callJev(buildDimensionState(input, jev, phase2, answers), questions);

  const values = {} as Record<DimensionKey, string>;
  const unknown: DimensionKey[] = [];
  for (const { key, options } of DIMENSIONS) {
    // An option Jev invents is not one we offered: treat it as not specified
    const answer = response.answers[key]?.choice;
    const choice = answer !== undefined && Object.hasOwn(options, answer) ? answer : "Not specified";
    values[key] = choice;
    if (choice === "Not specified") unknown.push(key);
  }

  return {
    values,
    unknown,
    known: DIMENSIONS.length - unknown.length,
    total: DIMENSIONS.length,
  };
}
