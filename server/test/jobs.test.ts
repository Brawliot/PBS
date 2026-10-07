import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { JobStore, type JobState } from "../jobs.js";
import { HttpError } from "../request.js";

const TTL = 1000;

/** A run whose outcome the test decides */
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run, without waiting on a timer */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeStore(maxJobs = 10) {
  let time = 0;
  const store = new JobStore({ ttlMs: TTL, maxJobs, now: () => time });
  return { store, advance: (ms: number) => (time += ms) };
}

afterEach(() => mock.restoreAll());

describe("JobStore.start", () => {
  test("returns a different id each time and the state starts as pending", async () => {
    const { store } = makeStore();
    const a = store.start(() => new Promise(() => {}));
    const b = store.start(() => new Promise(() => {}));
    assert.notEqual(a, b);
    assert.equal(store.get(a)?.status, "pending");
    assert.equal(store.get(b)?.status, "pending");
  });

  test("stores the exact result once run resolves", async () => {
    const { store } = makeStore();
    const result = { jev: { model: "m" }, questionTotal: 3 };
    const id = store.start(async () => result);
    await flush();
    assert.deepEqual(store.get(id), { status: "done", result, finishedAt: 0 });
  });

  test("returns undefined for an id it does not know", () => {
    const { store } = makeStore();
    assert.equal(store.get("00000000-0000-4000-8000-000000000000"), undefined);
  });

  test("stores the message of an Error rejection, without an unhandled rejection", async () => {
    const { store } = makeStore();
    const consoleError = mock.method(console, "error", () => {});
    const unhandled = mock.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const id = store.start(async () => {
        throw new Error("x");
      });
      await flush();
      await flush();
      assert.deepEqual(store.get(id), { status: "error", message: "x", finishedAt: 0 });
      assert.equal(unhandled.mock.callCount(), 0);
      assert.equal(consoleError.mock.callCount(), 1);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  test("uses 'Internal server error' when the rejection is not an Error", async () => {
    const { store } = makeStore();
    mock.method(console, "error", () => {});
    const id = store.start(() => Promise.reject("boom"));
    await flush();
    assert.deepEqual(store.get(id), {
      status: "error",
      message: "Internal server error",
      finishedAt: 0,
    });
  });

  test("turns a synchronous throw from run into an error state", async () => {
    const { store } = makeStore();
    mock.method(console, "error", () => {});
    const id = store.start((() => {
      throw new Error("sync");
    }) as () => Promise<unknown>);
    await flush();
    assert.deepEqual(store.get(id), { status: "error", message: "sync", finishedAt: 0 });
  });

  test("calls run exactly once per job", async () => {
    const { store } = makeStore();
    const run = mock.fn(async () => "ok");
    store.start(run);
    await flush();
    assert.equal(run.mock.callCount(), 1);
  });
});

describe("JobStore.sweep", () => {
  test("keeps a finished job at ttl - 1 and removes it at ttl + 1", async () => {
    const { store, advance } = makeStore();
    const id = store.start(async () => "ok"); // finished at t = 0
    await flush();

    advance(TTL - 1);
    store.sweep();
    assert.equal(store.size, 1);
    assert.equal(store.get(id)?.status, "done");

    advance(2); // now at ttl + 1
    store.sweep();
    assert.equal(store.size, 0);
    assert.equal(store.get(id), undefined);
  });

  test("never expires a pending job, however long it waits", async () => {
    const { store, advance } = makeStore();
    const id = store.start(() => new Promise(() => {}));
    advance(TTL * 1000);
    store.sweep();
    assert.equal(store.get(id)?.status, "pending");
    assert.equal(store.size, 1);
  });

  test("get does not return a finished job after its TTL, even before a sweep", async () => {
    const { store, advance } = makeStore();
    const id = store.start(async () => "ok");
    await flush();
    advance(TTL + 1);
    assert.equal(store.get(id), undefined);
  });
});

describe("JobStore maxJobs", () => {
  test("refuses a new job with 503 when the store is full, without calling run", async () => {
    const { store } = makeStore(2);
    store.start(() => new Promise(() => {}));
    store.start(() => new Promise(() => {}));

    const run = mock.fn(async () => "never");
    assert.throws(
      () => store.start(run),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 503);
        assert.equal(error.message, "Server busy, try again shortly");
        return true;
      },
    );
    assert.equal(run.mock.callCount(), 0);
    assert.equal(store.size, 2);
  });

  test("accepts a new job again once a finished one has expired", async () => {
    const { store, advance } = makeStore(1);
    store.start(async () => "ok");
    await flush();
    assert.throws(() => store.start(async () => "no"), HttpError);

    advance(TTL + 1);
    const id = store.start(async () => "yes");
    await flush();
    assert.equal(store.get(id)?.status, "done");
  });
});

describe("JobStore states", () => {
  test("a job moves from pending to done", async () => {
    const { store } = makeStore();
    const job = deferred<string>();
    const id = store.start(() => job.promise);
    assert.equal(store.get(id)?.status, "pending");
    job.resolve("result");
    await flush();
    const state: JobState | undefined = store.get(id);
    assert.equal(state?.status, "done");
  });
});
