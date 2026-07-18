import { describe, expect, test } from "bun:test";
import { createSerialQueue } from "../src/core/queue";

describe("createSerialQueue", () => {
  test("runs tasks one at a time, in submission order", async () => {
    const queue = createSerialQueue();
    const order: number[] = [];
    const make = (n: number, ms: number) =>
      queue.run(
        () =>
          new Promise<number>((resolve) => {
            setTimeout(() => {
              order.push(n);
              resolve(n);
            }, ms);
          }),
      );
    // Submit a slow task first, then a fast one — the fast task must wait
    // its turn rather than racing ahead.
    const p1 = make(1, 30);
    const p2 = make(2, 1);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual([1, 2]);
  });

  test("a rejected task does not block later tasks", async () => {
    const queue = createSerialQueue();
    await expect(
      queue.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The queue must still accept and run subsequent work.
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });

  test("propagates the result of each task", async () => {
    const queue = createSerialQueue();
    const result = await queue.run(async () => ({ ok: true, value: 7 }));
    expect(result).toEqual({ ok: true, value: 7 });
  });
});
