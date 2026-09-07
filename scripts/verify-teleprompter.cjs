/** Real Chromium layout regression checks. No microphone, model, or user project.
 * Run: node_modules/.bin/electron scripts/verify-teleprompter.cjs
 * --baseline bundles the UI before the teleprompter fixes (2ae0d51).
 */
const { app, BrowserWindow } = require("electron");
const { build } = require("esbuild");
const { readFileSync, writeFileSync, mkdtempSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join, resolve, relative } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");

const repo = resolve(__dirname, "..");
const output = mkdtempSync(join(tmpdir(), "kosmos-prompter-check-"));
const baseline = process.argv.includes("--baseline");
app.setPath("userData", join(output, "profile"));
const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { RecordScreen } from "./labs/next/src/main-app/RecordScreen";
import { ReviewScript } from "./labs/next/src/main-app/ReviewScript";
import { ReviewScreen } from "./labs/next/src/main-app/ReviewScreen";
import { tokenizeManuscript } from "./src/core/proof/normalize";
import { encodeWavPcm16 } from "./src/core/audio/wav";
const paragraph = "The lantern shone beside the window as the reader began another sentence. Across the quiet room a clock marked the passing minutes, and every word stayed in its proper place. The next sentence continues across several displayed lines so that a sentence and a visual line cannot be confused.";
const paragraphs = ["Chapter 1", ...Array.from({ length: 12 }, () => paragraph), "End"];
const manuscript = paragraphs.join("\\n");
const tokens = tokenizeManuscript(manuscript);
const transcript = tokens.map((token, index) => ({ text: token.text, start: index, end: index + 0.9 }));
const wav = encodeWavPcm16(new Float32Array(8000), 8000, 1);
window.kosmosNext = {
  readChapterContent: async () => ({ ok: true, html: paragraphs.map(p => '<p>' + p + '</p>').join('') }),
  readChapterAudio: async () => ({ ok: true, base64: btoa(String.fromCharCode(...wav)) }),
};
const root = createRoot(document.getElementById("root"));
const NativeAudio = window.Audio;
let project = {
  id: "teleprompter-check", title: "Layout check", author: "Test", folder: "/fixture",
  manuscript: "fixture.txt", chapters: [{ id: "ch1", title: "Chapter 1", wordCount: tokens.length,
  recordedPct: 0, hasOriginalAudio: true, hasWorkingAudio: false, hasMasteredAudio: false,
  originalFile: "fixture.wav", recordedWords: transcript.map((word, index) => ({ index, start: word.start, end: word.end })),
  resumeWordIndex: 0, proofed: false, mastered: false }],
  createdAt: "2026-09-07", updatedAt: "2026-09-07",
};
window.fixture = {
  count: tokens.length,
  playbackAudios: [],
  rejectNextPlay: false,
  proof(native = false) {
    localStorage.setItem('kosmos-booth-highlight', 'word');
    window.Audio = function (src) {
      if (native) {
        const audio = new NativeAudio(src);
        window.fixture.playbackAudios.push(audio);
        return audio;
      }
      const audio = document.createElement('audio');
      Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
      audio.play = () => window.fixture.rejectNextPlay
        ? (window.fixture.rejectNextPlay = false, Promise.reject(new DOMException('blocked', 'NotAllowedError')))
        : Promise.resolve();
      audio.pause = () => audio.dispatchEvent(new Event('pause'));
      window.fixture.playbackAudios.push(audio);
      return audio;
    };
    project = { ...project, chapters: [{ ...project.chapters[0],
      workingFile: 'working.wav', hasWorkingAudio: true,
      punches: [{ t_start: 0, t_end: 1, durationDelta: 10 }],
      pickups: [{ id:'flag-one', chapter_id:'ch1', t_start:native ? 0.4 : 80, t_end:native ? 0.6 : 85,
        line_start:native ? 0.4 : 80, line_end:native ? 0.6 : 85, manuscript_index:80, kind:'sub', status:'open',
        expected:'stayed', heard:'stayed', confidence:1, seat:'narration' }],
    }] };
    root.render(<ReviewScreen project={project} chapterId="ch1" embedded onBack={() => {}} onChange={() => {}} />);
  },
  playbackTime(time, event = 'timeupdate') {
    const audio = window.fixture.playbackAudios.at(-1);
    audio.currentTime = time;
    audio.dispatchEvent(new Event(event));
  },
  tapeTime(index) {
    const audio = document.querySelector('audio');
    Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => index + 0.1 });
    audio.dispatchEvent(new Event('timeupdate'));
  },
  record(index) {
    project = { ...project, chapters: [{ ...project.chapters[0], resumeWordIndex: index }] };
    root.render(<RecordScreen project={project} chapterId="ch1" embedded onBack={() => {}}
      onChange={next => { project = next; }} />);
  },
  review(index, mode = "line", fontPx = 28, spacing = 1.55, theme = "white", playing = true) {
    root.render(<div className="ma-proof-prompt"><ReviewScript chapterId="ch1" chapterTitle="Chapter 1"
      manuscript={manuscript} transcript={transcript} playAt={index + 0.1}
      playKey={playing ? "original" : null} sourceKind="take" highlight={mode}
      theme={theme} fontPx={fontPx} lineSpacing={spacing} onRedo={() => {}} /></div>);
  },
};
window.fixture.record(80);
`;

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1150, height: 900, show: false,
    webPreferences: { backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" } });
  const failures = [];
  let passed = 0;
  try {
    const bundle = await build({ stdin: { contents: fixture, resolveDir: repo, loader: "tsx" },
      bundle: true, write: false, platform: "browser", define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
      plugins: baseline ? [{ name: "baseline", setup(build) {
        build.onLoad({ filter: /main-app\/((RecordScreen|ReviewScreen|ReviewScript|TeleprompterFocus)\.tsx|reading-prefs\.ts)$/ }, ({ path }) => ({
          contents: execFileSync("git", ["show", `2ae0d51:${relative(repo, path)}`], { cwd: repo, encoding: "utf8" }), loader: "tsx",
        }));
      } }] : [],
    });
    const styles = ["main-app.css", "vault.css", "paper.css"].map(name => {
      const path = `labs/next/src/main-app/${name}`;
      return baseline ? execFileSync("git", ["show", `2ae0d51:${path}`], { cwd: repo, encoding: "utf8" })
        : readFileSync(join(repo, path), "utf8");
    }).join("\n");
    // Keep the real embedded panel styles while isolating it from the 3D room.
    const sizing = `body{margin:0;padding:25px;background:#d5d0c9;font-family:Arial}
      .quest-workspace{width:1060px;height:800px!important}
      .ma-proof-prompt{width:610px;height:690px!important}
      .ma-record-embed{height:760px!important}
      .ma-flow-prompt{height:610px!important}
      .ma-teleprompter{height:610px!important}
      .ma-record-embed{grid-template-columns:610px 400px!important}`;
    const html = join(output, "fixture.html");
    writeFileSync(html, `<style>${styles}\n${sizing}</style><div class="vault-overlay"><div class="quest-workspace"><div id="root"></div></div></div>`);
    await window.loadFile(html);
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text);
    const js = code => window.webContents.executeJavaScript(code);
    const settle = () => js(`document.fonts.ready.then(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }))`);
    async function check(name, work) {
      try { await work(); passed++; console.log(`PASS ${name}`); }
      catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
    }
    async function metrics(index) {
      return js(`(() => {
        const root = document.querySelector('.ma-teleprompter-scroll, .ma-review-prose');
        const words = [...root.querySelectorAll('.ma-tp-word, .ma-review-word')];
        const word = words[${index}];
        const rect = word.getBoundingClientRect();
        const box = root.getBoundingClientRect();
        const caret = document.querySelector('.ma-teleprompter-caret');
        const rails = [...document.querySelectorAll('.ma-tp-rail')].map(el => {
          const r = el.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, word:el.classList.contains('is-word') };
        });
        const row = words.filter(el => el.closest('p') === word.closest('p') && Math.abs(el.getBoundingClientRect().top - rect.top) < 4);
        return { scroll:root.scrollTop, row:row.map(el=>words.indexOf(el)), rails,
          caret:caret ? caret.getBoundingClientRect().top + caret.getBoundingClientRect().height / 2 : null,
          mid:rect.top + rect.height/2, target:box.top + root.clientTop + root.clientHeight * .42,
          left:row[0].getBoundingClientRect().left, right:row.at(-1).getBoundingClientRect().right,
          now:root.querySelectorAll('.is-now').length,
          locate:!!document.querySelector('.ma-locate-speak:not(:disabled)'),
        };
      })()`);
    }
    const aligned = m => {
      assert.ok(m.caret != null, "caret must be visible");
      assert.ok(Math.abs(m.caret - m.mid) < 2, `caret ${m.caret} must align with word ${m.mid}`);
    };
    const lineOnly = m => {
      assert.equal(m.now, 0, "line mode must not style a single current word");
      assert.equal(m.rails.filter(r => r.word).length, 0, "line mode must not draw a word rail");
      assert.equal(m.rails.length, 1, "line mode must draw exactly one visual row");
      assert.ok(Math.abs(m.rails[0].left - (m.left - 18)) < 2, "band starts at visual row start");
      assert.ok(Math.abs(m.rails[0].right - (m.right + 18)) < 2, "band ends at visual row end");
      aligned(m);
    };
    await settle();
    await check("recording: Line has one row and no word highlight", async () => lineOnly(await metrics(80)));
    await check("recording: scroll does not displace the guide from the text", async () => {
      await js(`document.querySelector('.ma-teleprompter-scroll').scrollTop += 30`); await settle(); aligned(await metrics(80));
    });
    await check("recording: small manual scroll survives the next cursor update", async () => {
      const before = (await metrics(80)).scroll;
      await js(`window.fixture.record(81)`); await settle();
      const after = await metrics(81); assert.ok(Math.abs(after.scroll - before) < 1); assert.ok(after.locate);
    });
    await check("recording: Locate resumes follow", async () => {
      await js(`document.querySelector('.ma-locate-speak').click()`); await settle();
      const m = await metrics(81); aligned(m); assert.ok(Math.abs(m.mid - m.target) < 2);
    });
    await check("recording: cursor updates within a line keep the line still", async () => {
      const before = await metrics(81);
      const next = before.row.find(index => index !== 81);
      assert.ok(next != null);
      await js(`window.fixture.record(${next})`); await settle();
      const after = await metrics(next); assert.ok(Math.abs(after.scroll - before.scroll) < 1); lineOnly(after);
    });
    await check("recording: tape timing cannot reattach a manually scrolled page", async () => {
      await js(`window.fixture.record(80)`); await settle();
      await js(`document.querySelector('.ma-teleprompter-scroll').scrollTop += 25`); await settle();
      const before = (await metrics(80)).scroll;
      await js(`window.fixture.tapeTime(81)`); await settle();
      assert.ok(Math.abs((await metrics(81)).scroll - before) < 1); lineOnly(await metrics(81));
      await js(`document.querySelector('.ma-locate-speak').click()`); await settle();
    });
    await check("recording: Settings switches Word, Paragraph, and Line immediately", async () => {
      await js(`document.querySelector('[title="Teleprompter settings"]').click()`); await settle();
      const select = async label => {
        await js(`[...document.querySelectorAll('[role="radio"]')].find(el => el.textContent === '${label}').click()`);
        await settle();
      };
      await select('Word'); const word = await metrics(81);
      assert.equal(word.now, 1); assert.equal(word.rails.length, 1); assert.ok(word.rails[0].word);
      await select('Paragraph'); const paragraph = await metrics(81);
      assert.equal(paragraph.now, 0); assert.equal(paragraph.rails.filter(r => r.word).length, 0);
      await select('Line'); lineOnly(await metrics(81));
      await select('Spacious'); lineOnly(await metrics(81));
      await js(`document.querySelector('.booth-sheet-close').click()`); await settle();
    });
    await check("recording: final word and completed cursor remain visible", async () => {
      await js(`window.fixture.record(window.fixture.count)`); await settle();
      const count = await js(`window.fixture.count`); const m = await metrics(count - 1);
      lineOnly(m); assert.ok(Math.abs(m.mid - m.target) < 2, "last word reaches reading position");
    });
    await js(`window.fixture.review(80)`); await settle();
    await check("proofread: Line is a visual row, not a sentence", async () => lineOnly(await metrics(80)));
    await check("proofread: Word draws only one word rail", async () => {
      await js(`window.fixture.review(80, 'word')`); await settle(); const m = await metrics(80);
      assert.equal(m.now, 1); assert.equal(m.rails.length, 1); assert.ok(m.rails[0].word); aligned(m);
    });
    await check("proofread: Paragraph has bands without a word highlight", async () => {
      await js(`window.fixture.review(80, 'paragraph')`); await settle(); const m = await metrics(80);
      assert.equal(m.now, 0); assert.equal(m.rails.filter(r => r.word).length, 0); assert.ok(m.rails.length > 1); aligned(m);
    });
    await check("proofread: font size and spacing remeasure a stationary cursor", async () => {
      await js(`window.fixture.review(80, 'line', 48, 1.8)`); await settle(); lineOnly(await metrics(80));
    });
    await check("proofread: narrower panel remeasures line wrapping", async () => {
      await js(`document.querySelector('.ma-proof-prompt').style.width = '410px'`); await settle(); lineOnly(await metrics(80));
    });
    await check("proofread: manual wheel scrolling stays detached during playback", async () => {
      await js(`(() => { const root = document.querySelector('.ma-review-prose'); root.dispatchEvent(new WheelEvent('wheel', {deltaY:25})); root.scrollTop += 25; })()`);
      await settle(); const before = (await metrics(80)).scroll;
      await js(`window.fixture.review(81, 'line', 48, 1.8)`); await settle();
      assert.ok(Math.abs((await metrics(81)).scroll - before) < 1); aligned(await metrics(81));
    });
    await check("proofread: offscreen cursor has no floating caret", async () => {
      await js(`document.querySelector('.ma-review-prose').scrollTop = 0`); await settle();
      assert.equal((await metrics(81)).caret, null);
    });
    await check("proofread: keyboard browsing survives the next timing update", async () => {
      await js(`document.querySelector('.ma-locate-speak').click()`); await settle();
      await js(`document.querySelector('.ma-review-prose').dispatchEvent(new KeyboardEvent('keydown', { key:'PageDown' }))`);
      const before = (await metrics(81)).scroll;
      await js(`window.fixture.review(100, 'line', 48, 1.8)`); await settle();
      assert.ok(Math.abs((await metrics(100)).scroll - before) < 1);
    });
    await check("proofread: Locate and end of script work after manual scrolling", async () => {
      await js(`document.querySelector('.ma-locate-speak').click(); window.fixture.review(window.fixture.count - 1, 'line', 48, 1.8)`);
      await settle(); const count = await js(`window.fixture.count`); const m = await metrics(count - 1);
      lineOnly(m); assert.ok(Math.abs(m.mid - m.target) < 2);
    });
    await check("proofread: theme change preserves line geometry", async () => {
      await js(`window.fixture.review(80, 'line', 28, 1.55, 'black')`); await settle(); lineOnly(await metrics(80));
    });
    if (!baseline) {
      await js(`window.fixture.proof()`); await settle();
      await check("Proofread screen: Pause keeps the highlight and resumes the same clip", async () => {
        await js(`document.querySelector('[aria-label="Listen to original"]').click()`); await settle();
        await js(`window.fixture.playbackTime(81.1)`); await settle();
        await js(`document.querySelector('[aria-label="Pause original"]').click()`); await settle();
        assert.equal(await js(`document.querySelector('.ma-review-word.is-now').dataset.token`), '81');
        assert.equal(await js(`document.querySelector('.ma-locate-speak').disabled`), false);
        await js(`document.querySelector('[aria-label="Listen to original"]').click()`); await settle();
        assert.equal(await js(`window.fixture.playbackAudios.length`), 1);
        assert.equal(await js(`window.fixture.playbackAudios[0].currentTime`), 81.1);
      });
      await check("Proofread screen: clip completion keeps original-tape timing and Locate", async () => {
        await js(`window.fixture.playbackTime(85.2)`); await settle();
        assert.equal(await js(`document.querySelector('.ma-review-word.is-now').dataset.token`), '85');
        await js(`document.querySelector('.ma-review-prose').scrollTop = 0`); await settle();
        await js(`document.querySelector('.ma-locate-speak').click()`); await settle();
        aligned(await metrics(85));
      });
      await check("Proofread screen: playback rejection is visible and Play retries", async () => {
        await js(`window.fixture.rejectNextPlay = true; document.querySelector('[aria-label="Listen to original"]').click()`); await settle();
        assert.match(await js(`document.querySelector('[role="alert"]').textContent`), /blocked/);
        await js(`document.querySelector('[aria-label="Listen to original"]').click()`); await settle();
        assert.equal(await js(`document.querySelector('[role="alert"]') === null`), true);
        assert.equal(await js(`!!document.querySelector('[aria-label="Pause original"]')`), true);
      });
      await check("Proofread screen: media errors remain visible inside the action sheet", async () => {
        await js(`document.querySelector('[aria-label="More actions"]').click()`); await settle();
        await js(`window.fixture.playbackTime(82, 'error')`); await settle();
        assert.match(await js(`document.querySelector('[role="dialog"] [role="alert"]').textContent`), /Try Play again/);
      });
      await check("Proofread screen: native audio pause, resume, and completion retain the cursor", async () => {
        await js(`document.querySelector('.booth-sheet-close').click(); window.fixture.proof(true)`); await settle();
        await js(`document.querySelector('[aria-label="Listen to original"]').click()`); await settle();
        await js(`new Promise(resolve => setTimeout(resolve, 80))`);
        assert.equal(await js(`window.fixture.playbackAudios.at(-1).paused`), false);
        await js(`document.querySelector('[aria-label="Pause original"]').click()`); await settle();
        assert.equal(await js(`window.fixture.playbackAudios.at(-1).paused`), true);
        const pausedAt = await js(`window.fixture.playbackAudios.at(-1).currentTime`);
        assert.ok(pausedAt >= 0.25);
        assert.equal(await js(`document.querySelector('.ma-locate-speak').disabled`), false);
        await js(`document.querySelector('[aria-label="Listen to original"]').click()`);
        await js(`new Promise(resolve => setTimeout(resolve, 1200))`); await settle();
        assert.equal(await js(`window.fixture.playbackAudios.at(-1).paused`), true);
        assert.equal(await js(`!!document.querySelector('[aria-label="Listen to original"]')`), true);
        assert.equal(await js(`document.querySelector('.ma-locate-speak').disabled`), false);
        assert.equal(await js(`!!document.querySelector('.ma-review-word.is-now')`), true);
      });
    }
    writeFileSync(join(output, "teleprompter.png"), (await window.webContents.capturePage()).toPNG());
    writeFileSync(join(output, "results.json"), JSON.stringify({ baseline, passed, failures }, null, 2));
    console.log(`${passed} passed, ${failures.length} failed. Artifacts: ${output}`);
    if (failures.length) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window.destroy(); app.exit(process.exitCode ?? 0); }
});
