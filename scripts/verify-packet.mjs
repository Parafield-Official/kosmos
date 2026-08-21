/**
 * Build a pickup packet from real audio and check it with other people's tools.
 *
 * The unit tests cover clip planning and the markup we generate. This runs the
 * whole export the way the desktop app does — the same core modules, the same
 * ffmpeg arguments — against a real recording, then reads the result back with
 * ffprobe (are the clips real audio, at the right times?), openpyxl (does Excel
 * see the spreadsheet?) and Python's HTML parser (is the page well-formed and
 * are its players pointing at files that exist?).
 *
 * Usage: node scripts/verify-packet.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ffmpeg = path.join(root, "vendor", "bin", "ffmpeg");
const ffprobe = path.join(root, "vendor", "bin", "ffprobe");
const packetCore = require(path.join(root, "dist-core", "proof-packet.cjs"));
const { zipSync, strToU8 } = require("fflate");

const problems = [];
function check(label, condition, detail) {
  console.log(`${condition ? "ok  " : "FAIL"}  ${label}${condition || !detail ? "" : ` — ${detail}`}`);
  if (!condition) {
    problems.push(label);
  }
}

const workspace = mkdtempSync(path.join(os.tmpdir(), "kosmos-packet-"));
const packetFolder = path.join(workspace, "packet");
const clipFolder = path.join(packetFolder, "clips");
mkdirSync(clipFolder, { recursive: true });

/**
 * A minute of narration built from the example recording, so clips can be cut
 * at plausible places and there is real audio inside them.
 */
const source = path.join(root, "public", "examples", "proof", "on_vs_in.wav");
const audioPath = path.join(workspace, "chapter.wav");
execFileSync(ffmpeg, [
  "-hide_banner", "-v", "error", "-y",
  "-stream_loop", "44", "-i", source,
  "-c:a", "pcm_s16le",
  audioPath,
], { stdio: "ignore" });
const durationSeconds = Number(execFileSync(ffprobe, [
  "-hide_banner", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath,
], { encoding: "utf8" }).trim());
console.log(`Source recording: ${durationSeconds.toFixed(2)}s\n`);

const pickups = [
  { id: "p1", t_start: 1.2, t_end: 1.6, expected: "on", heard: "in", kind: "sub", status: "open", confidence: 0.92, note: "Second take" },
  { id: "p2", t_start: 2.0, t_end: 2.4, expected: "mat", heard: "map", kind: "sub", status: "open", confidence: 0.71 },
  { id: "p3", t_start: 20.5, t_end: 24.5, expected: "", heard: "", kind: "pause", status: "open", confidence: 1 },
  { id: "p4", t_start: 30.0, t_end: 30.4, expected: "Worcester, \"quoted\" & <angled>", heard: "Wooster", kind: "sub", status: "done", confidence: 0.44, note: "Fixed" },
  { id: "p5", t_start: durationSeconds - 0.3, t_end: durationSeconds - 0.1, expected: "end", heard: "and", kind: "sub", status: "open", confidence: 0.5 },
].map((pickup) => ({ chapter_id: "ch01", seat: "narration", ...pickup }));

const clips = packetCore.planPacketClips(pickups, { durationSeconds });
console.log(`Planned ${clips.length} clips for ${pickups.length} flags`);

check(
  "flags within a couple of seconds of each other share one clip",
  clips.length === 4,
  `${clips.length} clips: ${clips.map((clip) => `${clip.start}-${clip.end}`).join(", ")}`,
);
check(
  "no clip runs past the end of the recording",
  clips.every((clip) => clip.end <= durationSeconds + 0.001),
  JSON.stringify(clips.map((clip) => clip.end)),
);
check("no clip starts before the recording", clips.every((clip) => clip.start >= 0));

// The same ffmpeg call the app makes.
for (const clip of clips) {
  execFileSync(ffmpeg, [
    "-y", "-v", "error",
    "-ss", String(Math.max(0, clip.start)),
    "-i", audioPath,
    "-t", String(Math.max(0.25, clip.end - clip.start)),
    "-map_metadata", "-1",
    "-codec:a", "libmp3lame",
    "-b:a", "96k",
    "-ar", "44100",
    "-ac", "1",
    path.join(clipFolder, clip.fileName),
  ], { stdio: "ignore" });
}

console.log("\nClips (ffprobe)");
for (const clip of clips) {
  const file = path.join(clipFolder, clip.fileName);
  const probed = JSON.parse(execFileSync(ffprobe, [
    "-hide_banner", "-v", "error",
    "-show_entries", "stream=codec_name,sample_rate,channels:format=duration",
    "-of", "json", file,
  ], { encoding: "utf8" }));
  const stream = probed.streams[0];
  const length = Number(probed.format.duration);
  const planned = clip.end - clip.start;
  // An MP3 frame is 26 ms, and the encoder pads the last one.
  const closeEnough = Math.abs(length - planned) < 0.12;
  check(
    `${clip.fileName}: ${stream.codec_name} ${stream.sample_rate}Hz ${stream.channels}ch, ${length.toFixed(2)}s`,
    stream.codec_name === "mp3" && Number(stream.sample_rate) === 44100 && Number(stream.channels) === 1 && closeEnough,
    `planned ${planned.toFixed(2)}s`,
  );
}

const packetInput = {
  chapterIndex: 1,
  chapterTitle: "The Pier",
  projectName: "Verification Book",
  narrator: "R. Vance",
  generatedAt: "2026-08-20T12:00:00.000Z",
  audioDurationSeconds: durationSeconds,
  pickups,
  clips,
};

writeFileSync(path.join(packetFolder, "index.html"), packetCore.buildPacketHtml(packetInput), "utf8");
const workbookFiles = {};
for (const part of packetCore.buildPacketWorkbookParts(packetInput)) {
  workbookFiles[part.path] = strToU8(part.contents);
}
writeFileSync(path.join(packetFolder, "pickups.xlsx"), Buffer.from(zipSync(workbookFiles, { level: 6 })));

console.log("\nSpreadsheet (openpyxl)");
{
  const script = `
import json, sys
from openpyxl import load_workbook
book = load_workbook(sys.argv[1])
sheet = book.active
rows = [[cell.value for cell in row] for row in sheet.iter_rows()]
print(json.dumps({"title": sheet.title, "rows": rows, "sheets": book.sheetnames}))
`;
  const result = spawnSync("python3", ["-c", script, path.join(packetFolder, "pickups.xlsx")], { encoding: "utf8" });
  check("Excel's own format rules accept the file", result.status === 0, result.stderr.trim().split("\n").at(-1));
  if (result.status === 0) {
    const book = JSON.parse(result.stdout);
    check("the sheet is named for what it holds", book.title === "Pickups", book.title);
    check("every flag has a row", book.rows.length === pickups.length + 1, `${book.rows.length - 1} rows`);
    check(
      "times are numbers a spreadsheet can sort and chart",
      book.rows.slice(1).every((row) => typeof row[2] === "number" && typeof row[3] === "number"),
      JSON.stringify(book.rows[1]),
    );
    check(
      "quotes and angle brackets come back as written",
      book.rows.some((row) => row[5] === 'Worcester, "quoted" & <angled>'),
      JSON.stringify(book.rows.map((row) => row[5])),
    );
    check(
      "each row names the clip to listen to",
      book.rows.slice(1).every((row) => typeof row[11] === "string" && row[11].endsWith(".mp3")),
      JSON.stringify(book.rows.slice(1).map((row) => row[11])),
    );
  }
}

console.log("\nPage (Python HTML parser)");
{
  const script = `
import json, sys
from html.parser import HTMLParser

class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.audio = []
        self.rows = 0
        self.stack = []
        self.mismatched = []
        self.text = []
    def handle_starttag(self, tag, attrs):
        if tag == "audio":
            self.audio.append(dict(attrs).get("src"))
        if tag == "tr":
            self.rows += 1
        if tag not in ("meta", "br", "img", "input", "link"):
            self.stack.append(tag)
    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            self.mismatched.append((tag, self.stack[-1] if self.stack else None))
            return
        self.stack.pop()
    def handle_data(self, data):
        if data.strip():
            self.text.append(data.strip())

page = Page()
page.feed(open(sys.argv[1], encoding="utf-8").read())
print(json.dumps({
    "audio": page.audio,
    "rows": page.rows,
    "unclosed": page.stack,
    "mismatched": page.mismatched,
    "text": page.text,
}))
`;
  const result = spawnSync("python3", ["-c", script, path.join(packetFolder, "index.html")], { encoding: "utf8" });
  check("the page parses", result.status === 0, result.stderr.trim().split("\n").at(-1));
  if (result.status === 0) {
    const page = JSON.parse(result.stdout);
    check("every tag is closed in order", page.unclosed.length === 0 && page.mismatched.length === 0, JSON.stringify(page));
    check("there is a row per flag, plus the header", page.rows === pickups.length + 1, `${page.rows} rows`);
    check("every flag has a player", page.audio.length === pickups.length, `${page.audio.length} players`);
    check(
      "every player points at a clip that exists",
      page.audio.every((src) => existsSync(path.join(packetFolder, decodeURIComponent(src)))),
      JSON.stringify(page.audio),
    );
    const text = page.text.join(" ");
    check("the escaped words read as written", text.includes('Worcester, "quoted" & <angled>'), text.slice(0, 200));
    check("a long pause says how long it was", /4\.0s of silence/u.test(text));
    check("the header counts what is still open", /4 open of 5 flagged/u.test(text), text.slice(0, 240));
    check("the date is written for a person", /20 Aug 2026, 12:00 UTC/u.test(text));
  }
}

rmSync(workspace, { recursive: true, force: true });
if (problems.length > 0) {
  console.error(`\n${problems.length} check${problems.length === 1 ? "" : "s"} failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("\nThe packet opens, plays and adds up in tools we did not write.");
