import { describe, expect, it } from "vitest";
import { createRetainedSave } from "./retained-save";

describe("retaining an unsaved take", () => {
  it("retries the exact same audio after a disk failure without duplicating it", async () => {
    const save = createRetainedSave<Uint8Array>();
    let creates = 0;
    const create = async () => {
      creates += 1;
      return new Uint8Array([1, 2, 3]);
    };
    await expect(save.run(create, async () => { throw Error("disk full"); })).rejects.toThrow("disk full");
    expect(save.hasPending).toBe(true);
    const result = await save.run(create, async (data) => Array.from(data));
    expect(result).toEqual([1, 2, 3]);
    expect(creates).toBe(1);
    expect(save.hasPending).toBe(false);
  });
});
