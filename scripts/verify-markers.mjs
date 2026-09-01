/**
 * Check the marker exports with parsers we did not write.
 *
 * The unit tests assert the strings we produce; that only proves we produce
 * what we intended. This reads the same files back with ffprobe (subtitles) and
 * Python's csv module (the comma- and tab-delimited tables), on pickups
 * containing the things that break naive exporters: commas, quotes, newlines,
 * em dashes, long labels and times past an hour.
 *
 * Usage: node scripts/verify-markers.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ffprobe = path.join(root, "vendor", "bin", "ffprobe");
const corePath = path.join(root, "dist-core", "markers.cjs");

if (!existsSync(corePath)) {
  throw new Error("dist-core is not built; run npm run build:core first.");
}
const markers = require(corePath);

const PICKUPS = [
  {
    id: "p1",
    chapter_id: "ch01",
    t_start: 12.5,
    t_end: 13.25,
    expected: "dawn",
    heard: "down",
    kind: "sub",
    seat: "narration",
    status: "open",
    confidence: 0.91,
    note: "Second take, please",
  },
  {
    id: "p2",
    chapter_id: "ch01",
    t_start: 61.004,
    t_end: 61.004,
    expected: "Worcester, Massachusetts",
    heard: "Worcester Massachusetts",
    kind: "sub",
    seat: "narration",
    status: "open",
    confidence: 0.4,
    note: "Comma, quote \" and\na newline",
  },
  {
    id: "p3",
    chapter_id: "ch01",
    t_start: 3725.75,
    t_end: 3728.5,
    expected: "",
    heard: "",
    kind: "pause",
    seat: "narration",
    status: "open",
    confidence: 1,
  },
  {
    id: "p4",
    chapter_id: "ch01",
    t_start: 200,
    t_end: 200.2,
    expected: "a".repeat(200),
    heard: "b".repeat(200),
    kind: "insert",
    seat: "N1",
    status: "open",
    confidence: 0.6,
  },
  {
    id: "p5",
    chapter_id: "ch01",
    t_start: 5,
    t_end: 5.4,
    expected: "ignored",
    heard: "row",
    kind: "sub",
    seat: "narration",
    status: "ignored",
    confidence: 0.5,
  },
];

const workspace = mkdtempSync(path.join(os.tmpdir(), "kosmos-markers-"));
const files = new Map(
  markers.markerFileSet("01_chapter", PICKUPS).map((file) => {
    const target = path.join(workspace, file.fileName);
    writeFileSync(target, file.contents, "utf8");
    return [file.fileName.replace("01_chapter_", ""), target];
  }),
);

const problems = [];
function check(label, condition, detail) {
  console.log(`${condition ? "ok  " : "FAIL"}  ${label}${condition || !detail ? "" : ` — ${detail}`}`);
  if (!condition) {
    problems.push(label);
  }
}

/** Read a delimited file with a parser we did not write. */
function pythonRows(file, delimiter) {
  const script = [
    "import csv, json, sys",
    `rows = list(csv.reader(open(sys.argv[1], newline=''), delimiter=${JSON.stringify(delimiter)}))`,
    "print(json.dumps(rows))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`python3 could not read ${path.basename(file)}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

console.log("Reaper regions (csv module)");
{
  const rows = pythonRows(files.get("reaper_regions.csv"), ",");
  check(
    "header is the one Reaper's Region/Marker Manager writes",
    rows[0].join(",") === "#,Name,Start,End,Length,Color",
    rows[0].join(","),
  );
  check("every row has six fields", rows.every((row) => row.length === 6), JSON.stringify(rows.map((row) => row.length)));
  check("ignored pickups are left out", rows.length === 5, `${rows.length - 1} regions`);
  check("regions are numbered with Reaper's R prefix", rows.slice(1).every((row, index) => row[0] === `R${index + 1}`));
  const commaRow = rows.find((row) => row[1].startsWith("Worcester, Massachusetts"));
  check("a comma inside a name survives the round trip", Boolean(commaRow), JSON.stringify(rows[2]));
  check(
    "a quote and newline inside a name do not split the row",
    rows.every((row) => !row[1].includes("\n")),
  );
  check(
    "start, end and length agree",
    rows.slice(1).every((row) => Math.abs((Number(row[2]) + Number(row[4])) - Number(row[3])) < 0.002),
  );
  check("times past an hour stay in seconds", rows.some((row) => Number(row[2]) > 3600));
}

console.log("\nAudition markers (csv module, tab-delimited)");
{
  const rows = pythonRows(files.get("audition_markers.csv"), "\t");
  check(
    "header matches Audition's own export",
    rows[0].join("\t") === "Name\tStart\tDuration\tTime Format\tType\tDescription",
    rows[0].join(" | "),
  );
  check("every row has six fields", rows.every((row) => row.length === 6));
  check("decimal times are M:SS.sss, widening past an hour", rows.slice(1).every((row) => /^\d+:(?:\d{2}:)?\d{2}\.\d{3}$/u.test(row[1])), JSON.stringify(rows.slice(1).map((row) => row[1])));
  check("a note carrying a newline stays on one row", rows.every((row) => !row[5].includes("\n")));
  const hourRow = rows.slice(1).find((row) => row[1].split(":").length === 3);
  check("an hour-plus marker is written with hours", Boolean(hourRow), JSON.stringify(rows.slice(1).map((row) => row[1])));
}

console.log("\nPickup table (csv module)");
{
  const rows = pythonRows(files.get("pickups.csv"), ",");
  check("every row has eleven fields", rows.every((row) => row.length === 11), JSON.stringify(rows.map((row) => row.length)));
  check(
    "the quoted note comes back exactly as written, minus the newline",
    rows.some((row) => row[10] === 'Comma, quote " and a newline'),
    JSON.stringify(rows.map((row) => row[10])),
  );
  check("timecode column is HH:MM:SS.sss", rows.slice(1).every((row) => /^\d{2}:\d{2}:\d{2}\.\d{3}$/u.test(row[3])));
}

console.log("\nAudacity labels (three tab-separated columns)");
{
  const lines = readFileSync(files.get("audacity_labels.txt"), "utf8").split("\n").filter(Boolean);
  check("every line is start, end, label", lines.every((line) => line.split("\t").length === 3));
  check(
    "times are plain seconds with three decimals",
    lines.every((line) => /^\d+\.\d{3}\t\d+\.\d{3}\t/u.test(line)),
  );
  check(
    "labels are in time order",
    lines.map((line) => Number(line.split("\t")[0])).every((value, index, all) => index === 0 || all[index - 1] <= value),
  );
  check("no label carries a tab or newline of its own", lines.every((line) => line.split("\t")[2].length > 0));
}

console.log("\nSubtitles (ffprobe)");
{
  const srt = files.get("pickups.srt");
  const probe = spawnSync(
    ffprobe,
    ["-hide_banner", "-v", "error", "-i", srt, "-show_entries", "packet=pts_time,duration_time", "-of", "json"],
    { encoding: "utf8" },
  );
  check("ffprobe reads the file as subtitles", probe.status === 0, probe.stderr.trim());
  if (probe.status === 0) {
    const packets = JSON.parse(probe.stdout).packets ?? [];
    check("every cue is found", packets.length === 4, `${packets.length} cues`);
    check(
      "cue times match the pickups",
      Math.abs(Number(packets[0]?.pts_time) - 12.5) < 0.01
      && Math.abs(Number(packets[3]?.pts_time) - 3725.75) < 0.01,
      JSON.stringify(packets.map((packet) => packet.pts_time)),
    );
    check(
      "no cue is zero-length, so every marker paints",
      packets.every((packet) => Number(packet.duration_time) >= 0.5),
      JSON.stringify(packets.map((packet) => packet.duration_time)),
    );
  }
  const text = execFileSync(
    path.join(root, "vendor", "bin", "ffmpeg"),
    ["-hide_banner", "-v", "error", "-i", srt, "-f", "srt", "-"],
    { encoding: "utf8" },
  );
  check(
    "the words survive a trip through ffmpeg",
    text.includes("dawn") && text.includes("Worcester"),
    text.slice(0, 120),
  );
}

console.log("\nReadme");
{
  const readme = readFileSync(files.get("MARKERS_README.txt"), "utf8");
  check("says which file each editor wants", ["Audacity", "Reaper", "Audition"].every((name) => readme.includes(name)));
  check("does not claim Pro Tools can import text markers", /Pro Tools cannot import text or CSV markers/u.test(readme));
}

rmSync(workspace, { recursive: true, force: true });
if (problems.length > 0) {
  console.error(`\n${problems.length} check${problems.length === 1 ? "" : "s"} failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("\nEvery marker file parses the way its editor expects.");
