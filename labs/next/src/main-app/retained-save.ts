/** Keep the exact recording candidate until storage confirms success. */
export function createRetainedSave<T>() {
  let candidate: T | undefined;
  let busy = false;
  return {
    get hasPending() { return candidate !== undefined; },
    async run<R>(create: () => Promise<T>, write: (value: T) => Promise<R>): Promise<R> {
      if (busy) throw new Error("This take is already being saved.");
      busy = true;
      try {
        candidate ??= await create();
        const result = await write(candidate);
        candidate = undefined;
        return result;
      } finally { busy = false; }
    },
    discard() {
      if (busy) throw new Error("Wait for the save to finish.");
      candidate = undefined;
    },
  };
}
