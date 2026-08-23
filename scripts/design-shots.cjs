/**
 * Photographs the design workbench panel by panel so a layout can be looked at
 * instead of imagined. Run `npm run design` in another terminal first.
 *
 *   node scripts/design-shots.cjs [--url http://127.0.0.1:5173] [--out design/shots]
 *
 * Electron is already a dev dependency, so this needs nothing new installed.
 */

const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const BASE_URL = flag("url", "http://127.0.0.1:5173");
const OUT_DIR = resolve(flag("out", "design/shots"));
const WIDTH = Number(flag("width", "1180"));

const PANELS = [
  "book-pickups",
  "book-pickups-empty",
  "word-scan",
  "word-scan-empty",
  "pickups",
  "pickups+open",
  "pickups+open=first",
  "glossary",
  "acx",
  "acx-trouble",
  "collaboration",
  "settings",
  "update-arriving",
  "update-ready",
  "update-applied",
];

async function shoot(window, panel) {
  const [id, ...modifiers] = panel.split("+");
  const query = modifiers.map((modifier) => `&${modifier}`).join("");
  await window.loadURL(`${BASE_URL}/design/preview.html?panel=${id}${query}`);
  // Let fonts settle before measuring, or the capture is a frame too early.
  await window.webContents.executeJavaScript(
    "document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))).then(() => document.documentElement.scrollHeight)",
  );
  // Open menus are positioned outside the panel box, so measure the document.
  const height = await window.webContents.executeJavaScript(
    "Math.ceil(Math.max(document.querySelector('[data-panel]').getBoundingClientRect().height + 64, document.body.scrollHeight))",
  );
  window.setContentSize(WIDTH, Math.min(Math.max(height, 240), 4000));
  await new Promise((done) => setTimeout(done, 200));
  const image = await window.webContents.capturePage();
  const file = join(OUT_DIR, `${panel.replace(/[+=]/g, "-")}.png`);
  writeFileSync(file, image.toPNG());
  console.log(`${panel} -> ${file}`);
}

app.whenReady().then(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const window = new BrowserWindow({
    width: WIDTH,
    height: 900,
    show: false,
    webPreferences: { offscreen: false },
  });

  try {
    for (const panel of PANELS) {
      await shoot(window, panel);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
