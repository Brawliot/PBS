import { afterEach, mock } from "node:test";

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

export type FetchHandler = (request: CapturedRequest) => Response | Promise<Response>;

// Each test file runs in its own process; these defaults keep every file deterministic
const TEST_ENV = { TYPESAFE_API_KEY: "test-key", JEV_MODEL: "test-model" } as const;
// Any call that is not mocked fails loudly instead of reaching the network
const blockedFetch: typeof fetch = async () => {
  throw new Error("Unexpected fetch in a test: wrap the call in mockFetch()");
};
globalThis.fetch = blockedFetch;

function applyEnv(values: Partial<Record<keyof typeof TEST_ENV, string | undefined>>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
applyEnv(TEST_ENV);

/** Sets (or, with undefined, removes) the Jev settings for the current test */
export function setJevEnv(values: Partial<Record<keyof typeof TEST_ENV, string | undefined>>) {
  applyEnv(values);
}

/** Replaces globalThis.fetch. Returns the list of requests the code under test sent. */
export function mockFetch(handler: FetchHandler): CapturedRequest[] {
  const calls: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request: CapturedRequest = {
      url,
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: JSON.parse(String(init?.body ?? "null")),
    };
    calls.push(request);
    return handler(request);
  }) as typeof fetch;
  return calls;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Silences console.error for a test that is expected to log; the returned mock lets it check the calls */
export function silenceConsoleError() {
  return mock.method(console, "error", () => {});
}

afterEach(() => {
  globalThis.fetch = blockedFetch;
  applyEnv(TEST_ENV);
  mock.restoreAll();
});
