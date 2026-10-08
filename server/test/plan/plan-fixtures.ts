const origin = { kind: "rule" } as const;

/** A step that is not started and has no events (its status is where its events end, so this is always valid) */
export function step(id: string, taskId: string, departmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    taskId,
    departmentId,
    text: `Secret text of ${id}`,
    executor: "ai",
    evidence: { kind: "none" },
    effortHours: 2,
    waitDays: 0,
    status: "not_started",
    events: [],
    origin,
    confidence: 100,
    ...overrides,
  };
}

/** A copy of a value with every object frozen, so that any write to it throws */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
