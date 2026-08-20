/**
 * Evaluate expressions inside the running app's renderer over the DevTools
 * protocol. Used to drive the desktop app for the live narration run without
 * hand-clicking, and to read back what the app decided.
 *
 * Usage: node scripts/cdp-eval.mjs '<javascript expression>'
 */

import { pathToFileURL } from "node:url";

const PORT = process.env.CDP_PORT ?? "9222";

async function rendererSocketUrl() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await response.json();
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page) {
    throw new Error("no renderer page target; is the app running with --remote-debugging-port?");
  }
  return page.webSocketDebuggerUrl;
}

/**
 * A live run polls the renderer a few hundred times. Hold one socket open for
 * the whole run instead of reconnecting per read.
 */
export async function openSession() {
  const socket = new WebSocket(await rendererSocketUrl());
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true });
  });

  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message));
      return;
    }
    const result = message.result?.result;
    if (message.result?.exceptionDetails) {
      waiter.reject(new Error(result?.description ?? message.result.exceptionDetails.text));
      return;
    }
    waiter.resolve(result?.value);
  });

  return {
    evaluate(expression, { timeoutMs = 120_000 } = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("CDP evaluate timed out"));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        socket.send(JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
        }));
      });
    },
    close() {
      socket.close();
    },
  };
}

export async function evaluate(expression, options) {
  const session = await openSession();
  try {
    return await session.evaluate(expression, options);
  } finally {
    session.close();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly && process.argv[2]) {
  const value = await evaluate(process.argv[2]);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}
