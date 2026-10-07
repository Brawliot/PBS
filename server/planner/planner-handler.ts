/**
 * Manejador Jev para análisis de negocios en planner
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

const JEV_QUESTIONS: Record<string, JevQuestion> = {
  sector: {
    type: "choice",
    instructions: "¿Cuál es el sector del negocio?",
    criteria: {
      "Tecnología/SaaS":
        "Software, apps, plataformas digitales o productos tecnológicos",
      "Hostelería/Restauración":
        "Restaurantes, bares, cafeterías, hoteles o catering",
      "Retail/Comercio":
        "Tiendas físicas u online que venden productos al consumidor",
      Manufactura: "Fabricación o producción industrial de bienes",
      "Servicios Profesionales":
        "Servicios especializados como abogados, arquitectos o gestorías",
      "Finanzas/Banca/Seguros":
        "Servicios financieros, banca, inversión o seguros",
      "Salud/Medicina":
        "Clínicas, servicios sanitarios, farmacia o bienestar médico",
      "Educación/Formación": "Academias, cursos, colegios o formación",
      "Logística/Transporte":
        "Transporte de mercancías o personas, almacenaje o reparto",
      "Construcción/Inmobiliaria":
        "Obras, reformas, promoción o compraventa y alquiler de inmuebles",
      "Marketing/Publicidad/Agencias":
        "Agencias de marketing, publicidad, comunicación o diseño",
      "Medios/Contenido/Entretenimiento":
        "Medios de comunicación, creación de contenido, ocio o eventos",
      "Agricultura/Ganadería":
        "Cultivo, ganadería o producción agroalimentaria primaria",
      "Energía/Utilidades":
        "Generación o suministro de energía, agua u otros suministros",
      "Consultoría/Asesoría":
        "Asesoramiento estratégico, de negocio o técnico a otras empresas",
      Otros: "No encaja en ninguna de las categorías anteriores",
    },
  },
  alcance_geografico: {
    type: "choice",
    instructions: "¿Cuál es el alcance geográfico del negocio?",
    criteria: {
      "Hyper-local": "Un barrio o zona muy concreta dentro de una ciudad",
      Local: "Una ciudad o municipio",
      Regional: "Una provincia o comunidad autónoma",
      Nacional: "Todo un país",
      Internacional: "Varios países",
      Global: "Todo el mundo",
      Online:
        "Negocio puramente digital sin ámbito geográfico físico",
    },
  },
  timeline: {
    type: "choice",
    instructions: "¿Cuál es el plazo esperado para poner en marcha el negocio?",
    criteria: {
      "Ultrarrápido (0-3m)": "Menos de 3 meses",
      "Rápido (3-6m)": "Entre 3 y 6 meses",
      "Normal (6-12m)": "Entre 6 y 12 meses",
      "Largo (12-18m)": "Entre 12 y 18 meses",
      "Muy largo (18+m)": "Más de 18 meses",
      "No especificado": "La descripción no menciona ningún plazo",
    },
  },
};

export async function analyzeWithJev(userInput: string): Promise<JevResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error("TYPESAFE_API_KEY no está configurado");
  }

  const request: JevRequest = {
    state: userInput,
    model: "jev-latest",
    questions: JEV_QUESTIONS,
  };

  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jev API error: ${response.status} - ${error}`);
  }

  return (await response.json()) as JevResponse;
}

export type { JevResponse, JevAnswer };
