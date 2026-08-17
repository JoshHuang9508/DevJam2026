import { describe, expect, it, vi } from "vitest";
import { createLimiter } from "../src/lib/limit-concurrency.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

describe("createLimiter", () => {
  it("holds tasks past the cap until a slot frees, in the order they arrived", async () => {
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const limit = createLimiter(2);

    const runs = gates.map((gate, index) => limit(async () => {
      started.push(index);
      await gate.promise;
    }));

    // The limiter admits synchronously up to the cap, so exactly two tasks are running here.
    expect(started).toEqual([0, 1]);

    gates[0]?.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    gates[1]?.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));

    gates[2]?.resolve();
    gates[3]?.resolve();
    await expect(Promise.all(runs)).resolves.toHaveLength(4);
  });

  it("releases the slot when a task rejects, so one failure cannot wedge the queue", async () => {
    const limit = createLimiter(1);

    await expect(limit(async () => { throw new Error("layer offline"); })).rejects.toThrow("layer offline");

    await expect(limit(async () => "second task still runs")).resolves.toBe("second task still runs");
  });

  it("returns each task's own value", async () => {
    const limit = createLimiter(2);
    await expect(Promise.all([limit(async () => 1), limit(async () => 2), limit(async () => 3)])).resolves.toEqual([1, 2, 3]);
  });
});
