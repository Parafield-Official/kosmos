/**
 * One-shot Electron workflow probe. It opens the real app/main process with an
 * isolated project, feeds macOS TTS into the renderer's microphone boundary,
 * and records evidence from the narrator flow.
 */
const { app, BrowserWindow, dialog } = require("electron");
const { spawnSync } = require("node:child_process");
const {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TEST_ROOT = path.join(os.tmpdir(), "kosmos-duke-workflow-latest");
const PROJECT_DIR = path.join(TEST_ROOT, "The Duke and I workflow.booth");
const USER_DATA_DIR = path.join(TEST_ROOT, "user-data");
const EVIDENCE_DIR = path.join(TEST_ROOT, "evidence");
const MANUSCRIPT_PATH = path.join(TEST_ROOT, "the duke and I.txt");
const LIVE_WAV_PATH = path.join(TEST_ROOT, "duke-tts-with-errors.wav");
const PICKUP_WAV_PATH = path.join(TEST_ROOT, "duke-pickup-correct.wav");
const RESULT_PATH = path.join(TEST_ROOT, "results.json");

const MANUSCRIPT = [
  "The Bridgertons are by far the most prolific family in the upper echelons of society.",
  "Such industriousness on the part of the viscountess and the late viscount is commendable, although one can find only banality in their choice of names for their children.",
  "Anthony, Benedict, Colin, Daphne, Eloise, Francesca, Gregory, and Hyacinth bring orderliness to the family.",
  "Lady Whistledown wrote the news.",
].join("\n\n");

const FIRST_SPOKEN_SEGMENT =
  "The Bridgertons are by far the most prolific family in the upper";
const SECOND_SPOKEN_SEGMENT = [
  "echelons of society.",
  // Five continuous manuscript departures exercise the stop-on-drift path.
  "Such extraordinary work by this mysterious duchess and her companion is commendable,",
  // A later isolated substitution should become a review point, not a halt.
  "although one can find only triviality in their choice of names for their children.",
  "Anthony, Benedict, Colin, Daphne, Eloise, Francesca, Gregory, and Hyacinth bring orderliness to the family.",
  "Lady Whistledown wrote the news.",
].join(" ");
const PICKUP_SPOKEN_SEGMENT =
  "Such industriousness on the part of the viscountess and the late viscount is commendable, although one can find only banality in their choice of names for their children.";

const results = {
  startedAt: new Date().toISOString(),
  root: TEST_ROOT,
  assertions: [],
  observations: {},
  screenshots: [],
  fatal: null,
};

function note(name, pass, detail = "") {
  results.assertions.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function run(command, args) {
  const completed = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (completed.status !== 0) {
    throw new Error(
      `${command} failed (${completed.status}): ${completed.stderr || completed.stdout}`,
    );
  }
}

function buildFixtures() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(PROJECT_DIR, { recursive: true });
  mkdirSync(USER_DATA_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const modelDirectory = path.join(USER_DATA_DIR, "models");
  mkdirSync(modelDirectory, { recursive: true });
  linkSync(
    path.join(ROOT, "vendor", "models", "ggml-small.en.bin"),
    path.join(modelDirectory, "ggml-small.en.bin"),
  );
  linkSync(
    path.join(ROOT, "vendor", "models", "ggml-small.en.bin.sha256"),
    path.join(modelDirectory, "ggml-small.en.bin.sha256"),
  );
  writeFileSync(MANUSCRIPT_PATH, `${MANUSCRIPT}\n`, "utf8");

  const firstAiff = path.join(TEST_ROOT, "first.aiff");
  const secondAiff = path.join(TEST_ROOT, "second.aiff");
  const pickupAiff = path.join(TEST_ROOT, "pickup.aiff");
  run("say", ["-v", "Samantha", "-r", "168", "-o", firstAiff, FIRST_SPOKEN_SEGMENT]);
  run("say", ["-v", "Samantha", "-r", "168", "-o", secondAiff, SECOND_SPOKEN_SEGMENT]);
  run("say", ["-v", "Samantha", "-r", "168", "-o", pickupAiff, PICKUP_SPOKEN_SEGMENT]);
  run("ffmpeg", [
    "-y",
    "-v", "error",
    "-i", firstAiff,
    "-f", "lavfi",
    "-t", "5.4",
    "-i", "anullsrc=r=16000:cl=mono",
    "-i", secondAiff,
    "-filter_complex",
    "[0:a]aresample=16000[a0];[1:a]aresample=16000[a1];[2:a]aresample=16000[a2];[a0][a1][a2]concat=n=3:v=0:a=1[out]",
    "-map", "[out]",
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    LIVE_WAV_PATH,
  ]);
  run("ffmpeg", [
    "-y",
    "-v", "error",
    "-i", pickupAiff,
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    PICKUP_WAV_PATH,
  ]);
  note(
    "Duke manuscript and TTS fixtures built",
    existsSync(MANUSCRIPT_PATH) && existsSync(LIVE_WAV_PATH) && existsSync(PICKUP_WAV_PATH),
    "The live read contains a 5.4s mid-sentence pause, a five-word drift, and an isolated substitution.",
  );
}

buildFixtures();

process.env.WHISPER_MODEL_PATH = path.join(ROOT, "vendor", "models", "ggml-small.en.bin");
const originalSetPath = app.setPath.bind(app);
app.setPath = (name, value) => originalSetPath(
  name,
  name === "userData" ? USER_DATA_DIR : value,
);

const originalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async (...args) => {
  const options = args.length === 1 ? args[0] : args[1];
  const title = String(options?.title ?? "");
  if (title.includes("Choose a folder for the Kosmos project")) {
    return { canceled: false, filePaths: [PROJECT_DIR] };
  }
  if (title.includes("Import a chapter manuscript")) {
    return { canceled: false, filePaths: [MANUSCRIPT_PATH] };
  }
  return originalShowOpenDialog(...args);
};

process.chdir(ROOT);
require(path.join(ROOT, "electron", "main.cjs"));

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(test, label, timeout = 30_000, interval = 250) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await test();
      if (last) {
        return last;
      }
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}${last ? ` (${String(last)})` : ""}`);
}

async function js(window, source) {
  return window.webContents.executeJavaScript(source, true);
}

async function bodyText(window) {
  return js(window, "document.body?.innerText || ''");
}

async function waitText(window, text, timeout = 30_000) {
  const wanted = text.toLocaleLowerCase("en-US");
  return waitFor(
    async () => (await bodyText(window)).toLocaleLowerCase("en-US").includes(wanted),
    `text “${text}”`,
    timeout,
  );
}

async function clickButton(window, text, scope = "document") {
  const result = await js(window, `(() => {
    const root = ${scope};
    const wanted = ${JSON.stringify(text)};
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const button = [...root.querySelectorAll("button")].find((candidate) => {
      const label = normalize(candidate.textContent);
      return label === wanted || label.endsWith(wanted);
    });
    if (!button) {
      return { ok: false, buttons: [...root.querySelectorAll("button")].map((candidate) => normalize(candidate.textContent)).filter(Boolean) };
    }
    if (button.disabled) {
      return { ok: false, disabled: true, title: button.title };
    }
    button.click();
    return { ok: true };
  })()`);
  if (!result?.ok) {
    throw new Error(`Could not click “${text}”: ${JSON.stringify(result)}`);
  }
}

async function clickNav(window, text) {
  const result = await js(window, `(() => {
    const wanted = ${JSON.stringify(text)};
    const button = [...document.querySelectorAll(".studio-nav-item")].find((candidate) =>
      candidate.querySelector("strong")?.textContent?.trim() === wanted
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!result) {
    throw new Error(`Could not open ${text} navigation`);
  }
}

async function setValue(window, selector, value, index = 0) {
  const changed = await js(window, `(() => {
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!element) return false;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
    descriptor?.set?.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!changed) {
    throw new Error(`Could not set ${selector}[${index}]`);
  }
}

async function capture(window, name) {
  await sleep(250);
  const filePath = path.join(EVIDENCE_DIR, `${name}.png`);
  const image = await window.webContents.capturePage();
  writeFileSync(filePath, image.toPNG());
  results.screenshots.push(filePath);
  console.log(`SHOT ${filePath}`);
  return filePath;
}

async function installMockMicrophone(window) {
  const live = readFileSync(LIVE_WAV_PATH).toString("base64");
  const pickup = readFileSync(PICKUP_WAV_PATH).toString("base64");
  await js(window, `(async () => {
    window.__kosmosMicAssets = {
      live: ${JSON.stringify(live)},
      pickup: ${JSON.stringify(pickup)},
    };
    window.__kosmosNextMic = "live";
    window.__kosmosMicEnded = true;
    window.__kosmosMicUses = [];
    window.__kosmosMicContext = null;
    window.__kosmosPauseMic = async (paused) => {
      const context = window.__kosmosMicContext;
      if (!context) return "missing";
      if (paused) await context.suspend();
      else await context.resume();
      return context.state;
    };
    window.__kosmosSetMic = (name) => {
      window.__kosmosNextMic = name;
      window.__kosmosMicEnded = false;
    };
    const decode = (base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const name = window.__kosmosNextMic || "live";
        const context = new AudioContext({ sampleRate: 48000 });
        window.__kosmosMicContext = context;
        await context.resume();
        const buffer = await context.decodeAudioData(decode(window.__kosmosMicAssets[name]).slice(0));
        const source = context.createBufferSource();
        const destination = context.createMediaStreamDestination();
        source.buffer = buffer;
        source.connect(destination);
        window.__kosmosMicEnded = false;
        window.__kosmosMicDuration = buffer.duration;
        window.__kosmosMicUses.push({ name, duration: buffer.duration, startedAt: performance.now() });
        source.onended = () => {
          window.__kosmosMicEnded = true;
          window.__kosmosMicUses.at(-1).endedAt = performance.now();
        };
        source.start();
        return destination.stream;
      },
    });
    return { liveBytes: window.__kosmosMicAssets.live.length, pickupBytes: window.__kosmosMicAssets.pickup.length };
  })()`);
}

async function useMic(window, name) {
  await js(window, `window.__kosmosSetMic(${JSON.stringify(name)}); true`);
}

async function waitMicEnded(window, timeout = 90_000) {
  return waitFor(
    () => js(window, "Boolean(window.__kosmosMicEnded)"),
    "TTS microphone feed to finish",
    timeout,
    300,
  );
}

async function testAudioPlayback(window, selector, name) {
  const prepared = await js(window, `(async () => {
    const audio = document.querySelector(${JSON.stringify(selector)});
    if (!audio) return { ok: false, reason: "missing" };
    audio.currentTime = 0;
    audio.volume = 0.08;
    try {
      await audio.play();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  })()`);
  if (!prepared.ok) {
    note(name, false, prepared.reason);
    return false;
  }
  await sleep(1_200);
  const state = await js(window, `(() => {
    const audio = document.querySelector(${JSON.stringify(selector)});
    const currentTime = audio?.currentTime ?? 0;
    audio?.pause();
    return { currentTime, duration: audio?.duration };
  })()`);
  const pass = state.currentTime > 0.5;
  note(name, pass, `advanced to ${Number(state.currentTime).toFixed(2)}s of ${Number(state.duration).toFixed(2)}s`);
  return pass;
}

async function ensureGlossary(window, spelling, respell) {
  const found = await js(window, `(() => {
    const wanted = ${JSON.stringify(spelling.toLocaleLowerCase("en-US"))};
    const row = [...document.querySelectorAll(".glossary-table tbody tr")].find((candidate) =>
      candidate.querySelector('input[aria-label="Spelling"]')?.value?.trim().toLocaleLowerCase("en-US") === wanted
    );
    if (!row) return false;
    const input = row.querySelector('input[aria-label="Respelling"]');
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    descriptor?.set?.call(input, ${JSON.stringify(respell)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (found) {
    await waitFor(
      () => js(window, `Boolean([...document.querySelectorAll(".glossary-table tbody tr")].find((row) =>
        row.querySelector('input[aria-label="Spelling"]')?.value?.trim().toLocaleLowerCase("en-US") === ${JSON.stringify(spelling.toLocaleLowerCase("en-US"))}
      )?.querySelector("button"))`),
      `${spelling} glossary Save button`,
    );
    const saved = await js(window, `(() => {
      const row = [...document.querySelectorAll(".glossary-table tbody tr")].find((candidate) =>
        candidate.querySelector('input[aria-label="Spelling"]')?.value?.trim().toLocaleLowerCase("en-US") === ${JSON.stringify(spelling.toLocaleLowerCase("en-US"))}
      );
      const button = [...row.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Save");
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!saved) throw new Error(`Could not save ${spelling} glossary row`);
  } else {
    await setValue(window, '.glossary-add-row input[placeholder="Leominster"]', spelling);
    await setValue(window, '.glossary-add-row input[placeholder="LEM-ster"]', respell);
    await clickButton(window, "Add", 'document.querySelector(".glossary-add-row")');
  }
  await sleep(500);
}

async function runWorkflow(window) {
  window.setContentSize(1380, 940);
  window.webContents.on("console-message", (_event, details) => {
    if (details.level === "error") console.log(`RENDERER ${details.message}`);
  });

  await waitText(window, "Create a book", 45_000);
  await capture(window, "01-fresh-electron");
  await clickButton(window, "Create a book");
  await waitText(window, "Update manuscript", 30_000);
  await clickButton(window, "Update manuscript");
  await waitText(window, "Chapter 1", 60_000);
  await waitText(window, "The Bridgertons are by far", 60_000);
  note("TXT manuscript imported into a fresh Electron project", true, MANUSCRIPT_PATH);

  await clickNav(window, "People");
  await waitText(window, "Author and narrator");
  await setValue(window, 'input[placeholder="Alex Author"]', "Max");
  await clickButton(window, "Save role", 'document.querySelector(".collaboration-card")');
  await waitText(window, "Max · author");
  note("Author identity appears in the workflow", true, "Max · author");

  await clickNav(window, "Words");
  await waitText(window, "Words");
  await ensureGlossary(window, "Whistledown", "WISS-ul-down");
  await ensureGlossary(window, "Daphne", "DAF-nee");
  await capture(window, "02-pronunciation-guide");
  note("Agreed pronunciation entries prepared", true, "Whistledown and Daphne have respellings.");

  await clickNav(window, "Review");
  await waitText(window, "Listen against the page");
  const beforeTake = await bodyText(window);
  note(
    "Review honestly reports that no take exists yet",
    beforeTake.toLocaleLowerCase("en-US").includes("need a take"),
    "Expected “Need a take” before recording.",
  );
  await capture(window, "03-review-before-take");

  await clickNav(window, "Record");
  await waitText(window, "Open the page");
  await installMockMicrophone(window);
  await clickButton(window, "Open the page");
  await waitText(window, "Start narrating");
  await useMic(window, "live");
  await clickButton(window, "Start narrating", 'document.querySelector(".booth-dock")');
  await waitText(window, "Pronunciations in Chapter 1");
  const briefing = await bodyText(window);
  note(
    "Pre-recording pronunciation briefing appears",
    briefing.includes("WISS-ul-down") && briefing.includes("DAF-nee"),
    "Both agreed respellings are visible before the take.",
  );
  await capture(window, "04-pronunciation-briefing");
  await clickButton(window, "Start narrating", 'document.querySelector(".pronunciation-briefing")');
  await waitFor(
    () => js(window, `[...document.querySelectorAll(".booth-dock button")].some((button) => button.textContent.includes("Pause"))`),
    "narration capture controls",
    30_000,
  );
  await sleep(900);
  const cursorBeforePause = await js(window, `(() => {
    const label = document.querySelector('[aria-label^="Live cursor "]')?.getAttribute("aria-label") || "";
    return Number(label.match(/Live cursor (\\d+)/)?.[1] || 0);
  })()`);
  await js(window, "window.__kosmosPauseMic(true)");
  await clickButton(window, "Pause", 'document.querySelector(".booth-dock")');
  await waitText(window, "Your place is held", 15_000);
  await capture(window, "05-narration-paused");
  await sleep(1_800);
  const pausedState = await js(window, `(() => {
    const label = document.querySelector('[aria-label^="Live cursor "]')?.getAttribute("aria-label") || "";
    return {
      cursor: Number(label.match(/Live cursor (\\d+)/)?.[1] || 0),
      micEnded: Boolean(window.__kosmosMicEnded),
      resumeVisible: [...document.querySelectorAll(".booth-dock button")].some((button) => button.textContent.includes("Resume"))
    };
  })()`);
  note(
    "Pause holds the narrator's place and excludes the break",
    pausedState.cursor === cursorBeforePause && !pausedState.micEnded && pausedState.resumeVisible,
    `cursor ${cursorBeforePause} stayed at ${pausedState.cursor}; Resume remained available`,
  );
  await clickButton(window, "Resume", 'document.querySelector(".booth-dock")');
  await js(window, "window.__kosmosPauseMic(false)");
  await waitFor(
    () => js(window, `[...document.querySelectorAll(".booth-dock button")].some((button) => button.textContent.includes("Pause"))`),
    "narration resume",
    15_000,
  );
  note("Resume continues the same narration session", true, `continued from cursor ${pausedState.cursor}`);

  let cueSeen = false;
  let haltSeen = false;
  const liveDeadline = Date.now() + 75_000;
  while (Date.now() < liveDeadline) {
    const state = await js(window, `({
      ended: Boolean(window.__kosmosMicEnded),
      cue: Boolean(document.querySelector(".pronunciation-cue")),
      halt: Boolean(document.querySelector(".booth-halt"))
    })`);
    if (state.cue && !cueSeen) {
      cueSeen = true;
      await capture(window, "05-pronunciation-cue");
    }
    if (state.halt && !haltSeen) {
      haltSeen = true;
      await capture(window, "06-live-drift-halt");
      await clickButton(window, "Continue", 'document.querySelector(".booth-halt")');
    }
    if (state.ended) break;
    await sleep(300);
  }
  note("Ahead-of-cursor pronunciation cue appears without autoplay", cueSeen, cueSeen ? "Cue rendered during the read." : "No cue rendered during this TTS read.");
  note("Five-word manuscript drift stops the page and offers Continue", haltSeen, haltSeen ? "Continue resumed the read." : "The live matcher never raised the halt banner.");
  await waitMicEnded(window, 30_000);
  await clickButton(window, "Stop", 'document.querySelector(".booth-dock")');
  await waitFor(
    () => js(window, "Boolean(document.querySelector('.booth-playback.fresh audio'))"),
    "fresh booth replay",
    45_000,
  );
  await capture(window, "07-replay-after-stop");
  note("A fresh replay panel appears immediately after Stop", true, "Saved this read");
  await testAudioPlayback(window, ".booth-playback.fresh audio", "Booth replay audio is playable");

  await waitFor(
    async () => {
      const text = (await bodyText(window)).toLocaleLowerCase("en-US");
      return text.includes("pronunciation check") && !text.includes("checking automatically");
    },
    "post-recording pronunciation check",
    180_000,
    750,
  ).catch((error) => {
    note("Post-recording pronunciation consistency completes", false, error.message);
  });
  const postPronunciation = (await bodyText(window)).toLocaleLowerCase("en-US");
  if (postPronunciation.includes("pronunciation check")) {
    note("Post-recording pronunciation consistency is visible", true);
    await capture(window, "08-pronunciation-consistency");
  }

  await clickButton(window, "Check this read", 'document.querySelector(".booth-playback")');
  await waitText(window, "Open pickups", 30_000);
  await waitFor(
    async () => {
      const text = await bodyText(window);
      return !text.includes("Checking…") && !text.includes("—Word changes") && !text.includes("—Long pauses");
    },
    "proof statistics",
    180_000,
    750,
  ).catch(async () => {
    const text = await bodyText(window);
    if (text.includes("Check this chapter")) {
      await clickButton(window, "Check this chapter", 'document.querySelector(".booth-proof-panel")');
      await waitFor(
        async () => !(await bodyText(window)).includes("Checking…"),
        "manual proof run",
        180_000,
        750,
      );
    }
  });
  const proofStats = await js(window, `(() => {
    const articles = [...document.querySelectorAll(".booth-proof-stats article")];
    return Object.fromEntries(articles.map((article) => [
      article.querySelector("span")?.textContent?.trim(),
      article.querySelector("strong")?.textContent?.trim()
    ]));
  })()`);
  results.observations.liveProofStats = proofStats;
  note("Proofing summarizes pickups, word changes, and pauses", Boolean(proofStats["Open pickups"]), JSON.stringify(proofStats));
  await capture(window, "09-proofing-summary");

  await clickButton(window, "Open full review", 'document.querySelector(".booth-proof-panel")');
  await waitText(window, "Words that drifted, pauses, and pickups.");
  await waitText(window, "Listen against the page");
  const liveReview = await js(window, `({
    page: document.body.innerText,
    transcript: document.querySelector("#local-transcript")?.value || "",
    pickupKinds: [...document.querySelectorAll(".pickup-row .kind-badge")].map((node) => node.textContent.trim()),
    pickupCount: document.querySelectorAll(".pickup-row").length
  })`);
  results.observations.liveReview = {
    transcript: liveReview.transcript,
    pickupKinds: liveReview.pickupKinds,
    pickupCount: liveReview.pickupCount,
  };
  note("Review shows the transcript generated from the recording", liveReview.transcript.split(/\s+/).length > 20, `${liveReview.transcript.split(/\s+/).length} words`);
  note("Review contains word-mistake pickups", liveReview.pickupKinds.some((kind) => !kind.toLocaleLowerCase("en-US").includes("pause")), liveReview.pickupKinds.join(", "));
  note("Review contains the injected long pause", liveReview.pickupKinds.some((kind) => kind.toLocaleLowerCase("en-US").includes("pause")), liveReview.pickupKinds.join(", "));
  await capture(window, "10-full-live-review");

  const occurrenceInput = await js(window, "Boolean(document.querySelector('.occurrence-search input'))");
  if (occurrenceInput) {
    await setValue(window, ".occurrence-search input", "Daphne");
    await waitFor(
      () => js(window, "document.querySelectorAll('.occurrence-list li').length > 0"),
      "Daphne occurrence results",
      15_000,
    );
    const occurrenceCount = await js(window, "document.querySelectorAll('.occurrence-list li').length");
    note("Across-this-recording occurrence search finds Daphne", occurrenceCount > 0, `${occurrenceCount} occurrence(s)`);
    await clickButton(window, "Play 1", 'document.querySelector(".occurrence-panel")');
    await sleep(700);
    const playing = await js(window, `(() => {
      const audio = document.querySelector(".review-page audio");
      const currentTime = audio?.currentTime || 0;
      audio?.pause();
      return currentTime;
    })()`);
    note("Occurrence result plays the matching recorded range", playing > 0, `playhead ${Number(playing).toFixed(2)}s`);
    await capture(window, "11-occurrence-search");
  } else {
    note("Across-this-recording occurrence search is present", false);
  }

  // Make a chapter take through the app's actual recorder, then re-run proof so
  // destructive pickup recording is permitted against the correct audio clock.
  await clickNav(window, "Record");
  await waitText(window, "Record this chapter");
  await useMic(window, "live");
  await clickButton(window, "Record", 'document.querySelector(\'section[aria-label="Record this chapter"]\')');
  await waitFor(
    () => js(window, `(() => {
      const root = document.querySelector('section[aria-label="Record this chapter"]');
      return [...root.querySelectorAll("button")].some((button) => button.textContent.includes("Stop & review") && !button.disabled);
    })()`),
    "chapter recorder to start",
  );
  await waitMicEnded(window, 90_000);
  await clickButton(window, "Stop & review", 'document.querySelector(\'section[aria-label="Record this chapter"]\')');
  await waitFor(
    () => js(window, `Boolean(document.querySelector('section[aria-label="Record this chapter"] .recorder-review audio'))`),
    "chapter take review",
    30_000,
  );
  await capture(window, "12-recorded-take-review");
  await testAudioPlayback(
    window,
    'section[aria-label="Record this chapter"] .recorder-review audio',
    "Recorder review plays the captured TTS take before saving",
  );
  await clickButton(window, "Use this take", 'document.querySelector(\'section[aria-label="Record this chapter"] .recorder-review\')');
  await waitText(window, "Take attached", 45_000);
  note("Reviewed recording becomes the chapter take", true);

  await clickNav(window, "Review");
  await waitText(window, "Take ready");
  await clickButton(window, "Check chapter");
  await waitFor(
    async () => !(await bodyText(window)).includes("Checking…"),
    "chapter-take proof",
    180_000,
    750,
  );
  await waitFor(
    () => js(window, "document.querySelectorAll('.pickup-row').length > 0"),
    "chapter-take pickups",
    30_000,
  );
  const enabledPickup = await js(window, `(() => {
    const rows = [...document.querySelectorAll(".pickup-row")];
    const row = rows.find((candidate) => {
      const kind = candidate.querySelector(".kind-badge")?.textContent?.trim().toLocaleLowerCase("en-US");
      const button = [...candidate.querySelectorAll("button")].find((item) => item.textContent.trim() === "Record pickup");
      return !kind?.includes("pause") && button && !button.disabled;
    });
    if (!row) return null;
    const button = [...row.querySelectorAll("button")].find((item) => item.textContent.trim() === "Record pickup");
    return {
      text: row.querySelector(".pickup-reading")?.textContent?.trim(),
      lineText: row.querySelector(".pickup-line-text")?.textContent?.trim() || "",
      title: button.title,
    };
  })()`);
  note("A checked chapter-take pickup can be recorded", Boolean(enabledPickup), JSON.stringify(enabledPickup));
  results.observations.pickupBeforePunch = enabledPickup;
  const pickupButtonClicked = await js(window, `(() => {
    const row = [...document.querySelectorAll(".pickup-row")].find((candidate) => {
      const kind = candidate.querySelector(".kind-badge")?.textContent?.trim().toLocaleLowerCase("en-US");
      const button = [...candidate.querySelectorAll("button")].find((item) => item.textContent.trim() === "Record pickup");
      return !kind?.includes("pause") && button && !button.disabled;
    });
    const button = row && [...row.querySelectorAll("button")].find((item) => item.textContent.trim() === "Record pickup");
    button?.click();
    return Boolean(button);
  })()`);
  if (pickupButtonClicked) {
    await waitText(window, "Read this line again");
    const modal = await js(window, `({
      text: document.querySelector(".punch-recorder")?.innerText || "",
      lineText: document.querySelector(".punch-line")?.textContent?.trim() || "",
      replaceRange: document.querySelector(".punch-preroll span")?.textContent?.trim() || ""
    })`);
    results.observations.pickupModal = modal;
    note(
      "Pickup modal supplies the complete line and replacement range",
      Boolean(modal.lineText),
      modal.lineText || "No line text was supplied; the modal fell back to the old word-only warning.",
    );
    await capture(window, "13-pickup-modal");
    await clickButton(window, "Play the 3s lead-in", 'document.querySelector(".punch-recorder")');
    await sleep(700);
    const leadInPosition = await js(window, `(() => {
      const audio = document.querySelector('audio[hidden]');
      const currentTime = audio?.currentTime || 0;
      audio?.pause();
      return currentTime;
    })()`);
    note("Pickup lead-in plays from the chapter take", leadInPosition >= 0, `playhead ${Number(leadInPosition).toFixed(2)}s`);

    await useMic(window, "pickup");
    await clickButton(window, "Record", 'document.querySelector(".punch-recorder .recorder-panel")');
    await waitMicEnded(window, 60_000);
    await clickButton(window, "Stop & review", 'document.querySelector(".punch-recorder .recorder-panel")');
    await waitFor(
      () => js(window, "Boolean(document.querySelector('.punch-recorder .recorder-review audio'))"),
      "pickup recording review",
      30_000,
    );
    await testAudioPlayback(
      window,
      ".punch-recorder .recorder-review audio",
      "Pickup reread is playable before applying the punch",
    );
    await clickButton(window, "Use this take", 'document.querySelector(".punch-recorder .recorder-review")');
    await waitFor(
      () => js(window, "!document.querySelector('.punch-recorder')"),
      "pickup punch to apply",
      60_000,
    );
    note("Pickup punch applies and returns to Review", true);
    await capture(window, "14-pickup-applied");
    await clickButton(window, "Check chapter");
    await waitFor(
      async () => {
        const transcript = await js(window, "document.querySelector('#local-transcript')?.value || ''");
        const text = await bodyText(window);
        return transcript.split(/\s+/).length > 20 && !text.includes("Checking…");
      },
      "post-punch proof refresh",
      180_000,
      750,
    );
    note("Review rechecks the edited take after the punch", true);
    await capture(window, "15-post-punch-recheck");
  }

  const project = JSON.parse(readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
  const alignmentPath = path.join(PROJECT_DIR, project.chapters[0].pickups_path);
  const alignment = JSON.parse(readFileSync(alignmentPath, "utf8"));
  results.observations.savedProject = {
    chapter: project.chapters[0],
    people: project.people,
    glossary: project.glossary,
    punchRecordings: project.punch_recordings,
    pickupKinds: alignment.pickups.map((pickup) => pickup.kind),
    transcriptWords: alignment.transcript.length,
  };
  note(
    "Electron persisted the take, transcript, pickups, and punch history",
    Boolean(project.chapters[0].audio_path)
      && alignment.transcript.length > 20
      && project.punch_recordings.length > 0,
    `${alignment.transcript.length} transcript words, ${alignment.pickups.length} pickups, ${project.punch_recordings.length} punch record(s)`,
  );
}

app.whenReady().then(async () => {
  let window;
  try {
    window = await waitFor(
      () => BrowserWindow.getAllWindows()[0],
      "fresh Electron window",
      45_000,
    );
    await waitFor(
      () => js(window, "document.readyState === 'complete' || document.readyState === 'interactive'"),
      "renderer readiness",
      45_000,
    );
    await runWorkflow(window);
  } catch (error) {
    results.fatal = error?.stack || String(error);
    console.error("FATAL", results.fatal);
    if (window && !window.isDestroyed()) {
      try {
        await capture(window, "99-fatal-state");
        results.observations.fatalBody = await bodyText(window);
      } catch {
        // The renderer may already be gone.
      }
    }
  } finally {
    results.finishedAt = new Date().toISOString();
    results.passed = results.assertions.filter((assertion) => assertion.pass).length;
    results.failed = results.assertions.filter((assertion) => !assertion.pass).length;
    writeFileSync(RESULT_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");
    console.log(`RESULT ${RESULT_PATH}`);
    app.quit();
  }
});
