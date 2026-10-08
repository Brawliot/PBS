/**
 * A malformed request target must not stop the server. The requests go over a raw socket, because the
 * targets below cannot be sent through the http client (it refuses some of them itself).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { connect, type AddressInfo } from "node:net";
import { server } from "../server.js";
import { CONTENT_SECURITY_POLICY } from "../security.js";

let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Sends one raw request line and reads the answer until the server closes the connection */
function rawRequest(line: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    // No socket.end(): a half-closed request makes the server drop its answer
    const socket = connect(port, "127.0.0.1", () => socket.write(`${line}\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
    const chunks: Buffer[] = [];
    socket.setTimeout(5_000, () => socket.destroy(new Error("no answer within 5 s")));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    // A large request may be cut while it is still being written: the answer already received is the result
    socket.on("error", (error) => (chunks.length > 0 ? undefined : reject(error)));
    socket.on("close", () => {
      const text = Buffer.concat(chunks).toString("latin1");
      resolve({ status: Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1] ?? 0), text });
    });
  });
}

const MALFORMED = [
  ["GET //[ HTTP/1.1", "//["],
  ["GET // HTTP/1.1", "//"],
  ["GET http://[ HTTP/1.1", "http://["],
  ["GET /% HTTP/1.1", "/%"],
  [`GET /${"a".repeat(100_000)} HTTP/1.1`, "a 100 KB target"],
];

describe("a malformed request target", () => {
  for (const [line, label] of MALFORMED) {
    test(`${label} is answered with 400 and the server keeps answering`, async () => {
      const bad = await rawRequest(line);
      // Targets over the parser's header limit are refused by Node itself (431), before any route runs
      assert.ok(bad.status === 400 || (label === "a 100 KB target" && bad.status === 431), `${label}: ${bad.status}`);

      const next = await rawRequest("GET / HTTP/1.1");
      assert.equal(next.status, 200, "the next request is answered");
    });
  }

  test("the 400 carries the security headers and no content", async () => {
    const bad = await rawRequest("GET //[ HTTP/1.1");
    assert.equal(bad.status, 400);
    const headers = new Map(
      bad.text
        .split("\r\n\r\n")[0]
        .split("\r\n")
        .slice(1)
        .map((line) => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]),
    );
    assert.equal(headers.get("content-security-policy"), CONTENT_SECURITY_POLICY);
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("content-length"), "0");
    assert.equal(bad.text.split("\r\n\r\n")[1], "");
  });
});
