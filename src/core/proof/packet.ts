import type { Pickup } from "../project/types";

export interface PacketClipOptions {
  /** Seconds of audio kept either side of a flag so it can be judged in context. */
  padSeconds?: number;
  /** Audio length, used to keep clips inside the recording. */
  durationSeconds?: number;
  /** Longest clip produced when neighbouring flags are merged. */
  maxClipSeconds?: number;
}

export interface PacketClip {
  fileName: string;
  start: number;
  end: number;
  /** Flags this clip covers, in time order. */
  pickupIds: string[];
}

export interface PacketInput {
  chapterIndex: number;
  chapterTitle: string;
  projectName?: string;
  narrator?: string;
  generatedAt?: string;
  audioDurationSeconds?: number;
  pickups: Pickup[];
  clips: PacketClip[];
  /** Folder name the clips are written to, relative to the packet page. */
  clipFolder?: string;
}

export interface WorkbookPart {
  path: string;
  contents: string;
}

const DEFAULT_PAD_SECONDS = 2;
const DEFAULT_MAX_CLIP_SECONDS = 30;

const KIND_LABELS: Record<Pickup["kind"], string> = {
  sub: "Misread",
  skip: "Skipped",
  insert: "Added",
  pause: "Long pause",
};

const STATUS_LABELS: Record<Pickup["status"], string> = {
  open: "Open",
  done: "Fixed",
  ignored: "Left as read",
};

/**
 * Choose the audio windows a packet needs. Every flag is heard in context, and
 * flags that sit on top of each other share one clip so a dense page does not
 * turn into a hundred near-identical files.
 */
export function planPacketClips(pickups: Pickup[], options: PacketClipOptions = {}): PacketClip[] {
  const pad = clampNumber(options.padSeconds ?? DEFAULT_PAD_SECONDS, 0, 30);
  const maxLength = clampNumber(options.maxClipSeconds ?? DEFAULT_MAX_CLIP_SECONDS, 1, 600);
  const limit = Number.isFinite(options.durationSeconds) && (options.durationSeconds ?? 0) > 0
    ? (options.durationSeconds as number)
    : undefined;

  const windows = [...pickups]
    .filter((pickup) => Number.isFinite(pickup.t_start) && Number.isFinite(pickup.t_end))
    .sort((left, right) => left.t_start - right.t_start || left.t_end - right.t_end)
    .map((pickup) => {
      const start = Math.max(0, pickup.t_start - pad);
      const rawEnd = Math.max(pickup.t_end, pickup.t_start) + pad;
      return {
        start,
        end: limit === undefined ? rawEnd : Math.min(limit, rawEnd),
        pickupIds: [pickup.id],
      };
    })
    .filter((window) => window.end > window.start);

  const merged: Array<{ start: number; end: number; pickupIds: string[] }> = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (
      previous
      && window.start <= previous.end
      && window.end - previous.start <= maxLength
    ) {
      previous.end = Math.max(previous.end, window.end);
      previous.pickupIds.push(...window.pickupIds);
      continue;
    }
    merged.push({ ...window, pickupIds: [...window.pickupIds] });
  }

  return merged.map((window, index) => ({
    fileName: `${String(index + 1).padStart(3, "0")}_${timeSlug(window.start)}.mp3`,
    start: round(window.start),
    end: round(window.end),
    pickupIds: window.pickupIds,
  }));
}

/**
 * A page an author or proofer can open in any browser, with the audio for each
 * flag beside the words. This is the deliverable that does not need the app
 * installed at the other end.
 */
export function buildPacketHtml(input: PacketInput): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const clipFolder = input.clipFolder ?? "clips";
  const clipFor = new Map<string, PacketClip>();
  for (const clip of input.clips) {
    for (const id of clip.pickupIds) {
      clipFor.set(id, clip);
    }
  }
  const pickups = [...input.pickups].sort((left, right) => left.t_start - right.t_start);
  const open = pickups.filter((pickup) => pickup.status === "open");
  const title = `Chapter ${input.chapterIndex}: ${input.chapterTitle}`;

  const rows = pickups.map((pickup, index) => {
    const clip = clipFor.get(pickup.id);
    const player = clip
      ? `<audio controls preload="none" src="${escapeAttribute(`${clipFolder}/${clip.fileName}`)}"></audio>`
      : `<span class="missing">No clip</span>`;
    return [
      "      <tr>",
      `        <td class="index">${index + 1}</td>`,
      `        <td class="time"><code>${escapeText(formatTimestamp(pickup.t_start))}</code></td>`,
      `        <td>${escapeText(KIND_LABELS[pickup.kind])}</td>`,
      `        <td class="words">${wordsCell(pickup)}</td>`,
      `        <td class="clip">${player}</td>`,
      `        <td>${escapeText(STATUS_LABELS[pickup.status])}</td>`,
      `        <td>${escapeText(pickup.note ?? "")}</td>`,
      "      </tr>",
    ].join("\n");
  });

  return [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${escapeText(`Pickups — ${title}`)}</title>`,
    `<style>${PACKET_CSS}</style>`,
    "</head>",
    "<body>",
    "  <header>",
    `    <p class="kicker">${escapeText(input.projectName ?? "Audiobook")}</p>`,
    `    <h1>${escapeText(title)}</h1>`,
    `    <p class="meta">${escapeText(summaryLine({
      open: open.length,
      total: pickups.length,
      narrator: input.narrator,
      durationSeconds: input.audioDurationSeconds,
      generatedAt,
    }))}</p>`,
    "  </header>",
    pickups.length === 0
      ? "  <p class=\"empty\">Nothing was flagged in this chapter.</p>"
      : [
        "  <table>",
        "    <thead>",
        "      <tr><th>#</th><th>Time</th><th>Type</th><th>Script → Heard</th><th>Listen</th><th>Status</th><th>Note</th></tr>",
        "    </thead>",
        "    <tbody>",
        ...rows,
        "    </tbody>",
        "  </table>",
      ].join("\n"),
    "  <footer>",
    "    <p>Clips carry a couple of seconds either side of each flag. Timings are from the",
    "    recording this packet was built from.</p>",
    "  </footer>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * The same flags as a spreadsheet, because publishers and proofers work in one.
 * Written as Open XML parts so the caller can zip them into a .xlsx without a
 * spreadsheet library.
 */
export function buildPacketWorkbookParts(input: PacketInput): WorkbookPart[] {
  const pickups = [...input.pickups].sort((left, right) => left.t_start - right.t_start);
  const header = [
    "#",
    "Timecode",
    "Start (s)",
    "End (s)",
    "Type",
    "Script",
    "Heard",
    "Status",
    "Confidence",
    "Note",
    "Chapter",
    "Clip",
  ];
  const clipFor = new Map<string, PacketClip>();
  for (const clip of input.clips) {
    for (const id of clip.pickupIds) {
      clipFor.set(id, clip);
    }
  }
  const rows: SheetCell[][] = [
    header.map((value) => ({ kind: "text", value } as SheetCell)),
    ...pickups.map((pickup, index): SheetCell[] => [
      { kind: "number", value: index + 1 },
      { kind: "text", value: formatTimestamp(pickup.t_start) },
      { kind: "number", value: round(pickup.t_start) },
      { kind: "number", value: round(pickup.t_end) },
      { kind: "text", value: KIND_LABELS[pickup.kind] },
      { kind: "text", value: pickup.expected },
      { kind: "text", value: pickup.heard },
      { kind: "text", value: STATUS_LABELS[pickup.status] },
      { kind: "number", value: round(clampNumber(pickup.confidence, 0, 1)) },
      { kind: "text", value: pickup.note ?? "" },
      { kind: "text", value: `Chapter ${input.chapterIndex}: ${input.chapterTitle}` },
      { kind: "text", value: clipFor.get(pickup.id)?.fileName ?? "" },
    ]),
  ];

  return [
    {
      path: "[Content_Types].xml",
      contents: `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
        + `<Default Extension="xml" ContentType="application/xml"/>`
        + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
        + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        + `</Types>`,
    },
    {
      path: "_rels/.rels",
      contents: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
        + `</Relationships>`,
    },
    {
      path: "xl/workbook.xml",
      contents: `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
        + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + `<sheets><sheet name="Pickups" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      contents: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
        + `</Relationships>`,
    },
    {
      path: "xl/worksheets/sheet1.xml",
      contents: sheetXml(rows),
    },
  ];
}

/**
 * A pause has no misread word, so printing "— → —" tells the reader nothing.
 * Show how long the silence ran instead.
 */
function wordsCell(pickup: Pickup): string {
  if (pickup.kind === "pause") {
    const length = Math.max(0, pickup.t_end - pickup.t_start);
    return `<span class="silence">${escapeText(`${length.toFixed(1)}s of silence`)}</span>`;
  }
  return `<span class="written">${escapeText(pickup.expected || "—")}</span>`
    + `<span class="arrow"> → </span>`
    + `<span class="heard">${escapeText(pickup.heard || "nothing heard")}</span>`;
}

interface SheetCell {
  kind: "text" | "number";
  value: string | number;
}

const XML_HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;

function sheetXml(rows: SheetCell[][]): string {
  const body = rows.map((cells, rowOffset) => {
    const rowNumber = rowOffset + 1;
    const rendered = cells.map((cell, columnOffset) => {
      const reference = `${columnName(columnOffset)}${rowNumber}`;
      if (cell.kind === "number") {
        const numeric = Number(cell.value);
        return `<c r="${reference}"><v>${Number.isFinite(numeric) ? numeric : 0}</v></c>`;
      }
      const text = String(cell.value);
      if (text === "") {
        return `<c r="${reference}"/>`;
      }
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeText(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${rendered}</row>`;
  }).join("");
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${body}</sheetData></worksheet>`;
}

/** Spreadsheet column names: A, B … Z, AA, AB … */
export function columnName(index: number): string {
  let remaining = Math.max(0, Math.floor(index));
  let name = "";
  for (;;) {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    if (remaining < 26) {
      return name;
    }
    remaining = Math.floor(remaining / 26) - 1;
  }
}

function summaryLine(input: {
  open: number;
  total: number;
  narrator?: string;
  durationSeconds?: number;
  generatedAt: string;
}): string {
  const parts = [
    `${input.open} open of ${input.total} flagged`,
  ];
  if (input.narrator) {
    parts.push(`Narrator: ${input.narrator}`);
  }
  if (Number.isFinite(input.durationSeconds) && (input.durationSeconds ?? 0) > 0) {
    parts.push(`Recording: ${formatTimestamp(input.durationSeconds as number)}`);
  }
  parts.push(`Prepared ${readableDate(input.generatedAt)}`);
  return parts.join(" · ");
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** A date a person can read, stated in UTC so the page says which clock it used. */
function readableDate(value: string): string {
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) {
    return value;
  }
  const day = String(stamp.getUTCDate());
  const month = MONTHS[stamp.getUTCMonth()];
  const time = `${String(stamp.getUTCHours()).padStart(2, "0")}:${String(stamp.getUTCMinutes()).padStart(2, "0")}`;
  return `${day} ${month} ${stamp.getUTCFullYear()}, ${time} UTC`;
}

function timeSlug(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}m${rest.toFixed(1).padStart(4, "0").replace(".", "s")}`;
}

function formatTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function clampNumber(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) {
    return low;
  }
  return Math.min(high, Math.max(low, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}

const PACKET_CSS = [
  "body{margin:0;padding:32px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#2f2a26;background:#fdfaf6}",
  "header{max-width:1040px;margin:0 auto 24px}",
  ".kicker{margin:0;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:#8a7d72}",
  "h1{margin:4px 0 6px;font-size:22px}",
  ".meta{margin:0;color:#766a60;font-size:13px}",
  "table{max-width:1040px;margin:0 auto;border-collapse:collapse;width:100%}",
  "th,td{padding:10px 8px;border-bottom:1px solid #ece4da;text-align:left;vertical-align:top;font-size:13px}",
  "th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72}",
  ".index{color:#a09488;width:34px}",
  ".time code{font-size:12px}",
  ".written{text-decoration:line-through;color:#8a7d72}",
  ".heard{font-weight:600}",
  ".silence{color:#766a60}",
  ".clip audio{width:220px;height:32px}",
  ".missing{color:#a09488;font-size:12px}",
  ".empty,footer{max-width:1040px;margin:24px auto 0;color:#766a60;font-size:13px}",
].join("");
