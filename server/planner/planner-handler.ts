/**
 * Jev handler for the planner's business analysis
 */

interface JevQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: Record<string, string>;
}

interface JevRequest {
  state: string;
  model: string;
  questions: Record<string, JevQuestion>;
}

interface JevAnswer {
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
}

interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/** Payload sent by the index page (see submitIdea in script.js) */
export interface PlannerInput {
  idea: string;
  budget: number;
  experience: number;
  team: number;
  hours: number;
}

const JEV_TIMEOUT_MS = 30_000;

// Same labels as the sliders in index.html
const TEAM_LABELS = ["Solo", "Small (2-3)", "Medium (4-10)", "Large (10+)"];
const HOURS_LABELS = ["Under 10 h", "10-20 h", "30+ h", "Full time"];

const JEV_QUESTIONS: Record<string, JevQuestion> = {
  sector: {
    type: "choice",
    instructions: "What is the business sector?",
    criteria: {
      "Technology/SaaS":
        "Software, apps, digital platforms or technology products",
      "Hospitality/Food service":
        "Restaurants, bars, cafes, hotels or catering",
      "Retail/Commerce":
        "Physical or online stores selling products to consumers",
      Manufacturing: "Industrial manufacturing or production of goods",
      "Professional Services":
        "Specialized services such as lawyers, architects or accounting firms",
      "Finance/Banking/Insurance":
        "Financial services, banking, investment or insurance",
      "Health/Medicine":
        "Clinics, healthcare services, pharmacy or medical wellness",
      "Education/Training": "Academies, courses, schools or training",
      "Logistics/Transport":
        "Transport of goods or people, warehousing or delivery",
      "Construction/Real Estate":
        "Building work, renovations, development, or buying, selling and renting property",
      "Marketing/Advertising/Agencies":
        "Marketing, advertising, communication or design agencies",
      "Media/Content/Entertainment":
        "Media outlets, content creation, leisure or events",
      "Agriculture/Livestock":
        "Crop growing, livestock or primary agri-food production",
      "Energy/Utilities":
        "Generation or supply of energy, water or other utilities",
      "Consulting/Advisory":
        "Strategic, business or technical advice to other companies",
      Other: "Does not fit any of the categories above",
    },
  },
  geographic_scope: {
    type: "choice",
    instructions: "What is the geographic scope of the business?",
    criteria: {
      "Hyper-local": "A very specific neighborhood or area within a city",
      Local: "A city or municipality",
      Regional: "A province or autonomous community",
      National: "A whole country",
      International: "Several countries",
      Global: "The whole world",
      Online: "Purely digital business with no physical geographic scope",
    },
  },
  timeline: {
    type: "choice",
    instructions: "What is the expected time to launch the business?",
    criteria: {
      "Ultra-fast (0-3m)": "Less than 3 months",
      "Fast (3-6m)": "Between 3 and 6 months",
      "Normal (6-12m)": "Between 6 and 12 months",
      "Long (12-18m)": "Between 12 and 18 months",
      "Very long (18+m)": "More than 18 months",
      "Not specified": "The description does not mention any timeline",
    },
  },
};

/** Turns the form payload into the text state Jev analyzes */
export function buildState(input: PlannerInput): string {
  return JSON.stringify({
    idea: input.idea,
    budget_usd: input.budget,
    experience_years: input.experience,
    team_size: TEAM_LABELS[input.team] ?? String(input.team),
    weekly_hours: HOURS_LABELS[input.hours] ?? String(input.hours),
  });
}

export async function analyzeWithJev(input: PlannerInput): Promise<JevResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const model = process.env.JEV_MODEL;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");
  if (!model) throw new Error("JEV_MODEL is not set");

  const request: JevRequest = {
    state: buildState(input),
    model,
    questions: JEV_QUESTIONS,
  };

  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Detail stays in the server log; callers only get a generic message
    console.error(`Jev API error ${response.status}: ${await response.text()}`);
    throw new Error("The analysis service failed");
  }

  return (await response.json()) as JevResponse;
}

export type { JevResponse, JevAnswer };
