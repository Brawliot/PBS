import express from "express";

const app = express();

const MAX_ANSWERS = 10;
const MAX_TEXT = 1000;
const MAX_IDEA = 2000;
const MAX_BODY = 100_000;

interface PlannerRequest {
  idea: string;
  answers: Array<{ questionId: string; answer: string }>;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readBody(request: express.Request): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY) {
        reject(new HttpError(413, "Request too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function parsePlannerRequest(body: string): PlannerRequest {
  const json = JSON.parse(body);
  const idea = String(json.idea || "").trim();

  if (idea.length > MAX_IDEA) {
    throw new HttpError(400, "Idea is too long");
  }

  const answers = Array.isArray(json.answers) ? json.answers : [];

  if (answers.length > MAX_ANSWERS) {
    throw new HttpError(400, "Too many answers");
  }

  for (const answer of answers) {
    if (typeof answer.answer !== "string" || answer.answer.length > MAX_TEXT) {
      throw new HttpError(400, "Answer text too long");
    }
  }

  return { idea, answers };
}

app.post("/api/planner", async (req, res) => {
  try {
    const body = await readBody(req);
    const plannerReq = parsePlannerRequest(body);
    res.json({ success: true, idea: plannerReq.idea });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
