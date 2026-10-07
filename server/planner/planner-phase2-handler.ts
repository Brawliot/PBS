/**
 * Planner Phase 2: Análisis profundo con ChatGPT
 */

interface JevAnalysis {
  sector: string;
  alcance_geografico: string;
  timeline: string;
}

interface Phase2Response {
  subsector: {
    value: string;
    confidence: number;
    follow_up_question: string;
  };
  localizacion: {
    value: string;
    confidence: number;
    follow_up_question: string;
  };
  flexibilidad_timeline: {
    value: string;
    confidence: number;
    follow_up_question: string;
  };
  constraints: {
    dinero: string;
    excluyentes: string[];
    otros: string[];
    confidence: number;
    follow_up_question: string;
  };
}

const PHASE2_SYSTEM_PROMPT = `Eres un experto en análisis de startups y modelos de negocio.
Tu tarea es profundizar en el análisis inicial realizado por Jev.
Proporciona análisis estructurado con confianza (0-100%) para cada apartado.
Sé específico y realista. Si no hay suficiente información, indica baja confianza (20-40%).
IMPORTANTE: Responde ÚNICAMENTE con JSON válido, sin código markdown (sin \`\`\`json), sin explicaciones, solo el objeto JSON puro.`;

function buildPhase2Prompt(input: string, jevAnalysis: JevAnalysis): string {
  return `DESCRIPCIÓN DEL NEGOCIO:
${input}

ANÁLISIS INICIAL (Jev):
- Sector: ${jevAnalysis.sector}
- Alcance: ${jevAnalysis.alcance_geografico}
- Timeline: ${jevAnalysis.timeline}

Analiza y proporciona en JSON:
{
  "subsector": {
    "value": "subsector específico (ej: SaaS de gestión de inventario para retail de moda)",
    "confidence": número 0-100,
    "follow_up_question": "pregunta para el usuario para clarificar este aspecto"
  },
  "localizacion": {
    "value": "ubicación específica con expansión (ej: CDMX, expandible a Tier 1)",
    "confidence": número 0-100,
    "follow_up_question": "¿Tienes una zona específica pensada o es a nivel ciudad/país?"
  },
  "flexibilidad_timeline": {
    "value": "Alta/Media/Baja + explicación breve",
    "confidence": número 0-100,
    "follow_up_question": "pregunta sobre si el timeline es flexible o crítico"
  },
  "constraints": {
    "dinero": "estimación presupuesto necesario (ej: $50k-150k USD)",
    "excluyentes": ["qué NO se debe hacer", "otra exclusión"],
    "otros": ["otro constraint", "restricción técnica"],
    "confidence": número 0-100,
    "follow_up_question": "¿Cuántos sois en el equipo, cuánto capital tenéis disponible y cuánto tiempo podéis dedicar?"
  }
}`;
}

export async function analyzeWithChatGPT(
  input: string,
  jevAnalysis: JevAnalysis
): Promise<Phase2Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no está configurado");
  }

  const prompt = buildPhase2Prompt(input, jevAnalysis);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: PHASE2_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ChatGPT API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message.content;

  if (!content) {
    throw new Error("No content in ChatGPT response");
  }

  try {
    // Intenta parsear directamente
    const parsed = JSON.parse(content) as Phase2Response;
    return parsed;
  } catch (e) {
    // Si falla, intenta extraer JSON de markdown
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]) as Phase2Response;
        return parsed;
      } catch (e2) {
        console.error("Failed to parse JSON from markdown:", jsonMatch[1]);
        throw new Error("Invalid JSON response from ChatGPT");
      }
    }

    console.error("Failed to parse ChatGPT response:", content);
    throw new Error("Invalid JSON response from ChatGPT");
  }
}

export type { Phase2Response, JevAnalysis };