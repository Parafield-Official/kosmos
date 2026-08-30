/**
 * Canvas sources for the library wall: the plaster's fine grain and the
 * printed faces of a book that has no artwork of its own. Everything here is deterministic — the same
 * book always prints the same cover — and none of it touches three.js, so it
 * can be drawn once and handed over as a texture.
 */

/**
 * Field colours a generated cover picks from, by title hash.
 *
 * These are deliberately mid-tones. The books are the only dark elements in the
 * reference and carry the whole picture's contrast — the measured cover field
 * is `#AFA7A2`, well below the plaster around it. Cream-on-cream covers vanish.
 */
const COVER_GROUNDS = ["#CFC8C1", "#C3BAB4", "#D6CFC8", "#B8AFA9", "#CAC2BA"] as const;

const COVER_INK = "#2A2622";

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Fine plaster grain. Value noise at two octaves, kept very low amplitude —
 * it should only ever show in the mid-tones, never as visible speckle.
 */
export function plasterGrainCanvas(size = 512): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  let seed = 20260828;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  // Coarse cell noise, bilinearly read, plus a per-pixel fizz on top.
  const cells = 64;
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let index = 0; index < grid.length; index += 1) {
    grid[index] = random();
  }
  const sample = (x: number, y: number) => {
    const gx = (x / size) * cells;
    const gy = (y / size) * cells;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const at = (cx: number, cy: number) => grid[cy * (cells + 1) + cx];
    const ex = fx * fx * (3 - 2 * fx);
    const ey = fy * fy * (3 - 2 * fy);
    const top = at(x0, y0) * (1 - ex) + at(x0 + 1, y0) * ex;
    const bottom = at(x0, y0 + 1) * (1 - ex) + at(x0 + 1, y0 + 1) * ex;
    return top * (1 - ey) + bottom * ey;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = sample(x, y) * 0.72 + random() * 0.28;
      const level = Math.round(118 + (value - 0.5) * 46);
      const offset = (y * size + x) * 4;
      data[offset] = level;
      data[offset + 1] = level;
      data[offset + 2] = level;
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) {
        break;
      }
    }
  }
  if (line && lines.length < maxLines) {
    lines.push(line);
  }
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      let trimmed = last;
      while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
      }
      lines[maxLines - 1] = `${trimmed}…`;
    }
  }
  return lines;
}

/**
 * A quiet printed cover for a book with no artwork: a greige field, a small
 * caps title in the upper third, and — on about two thirds of them, as the
 * reference has it — a soft photographic plate below. The type is warm
 * near-black and is meant to actually read: the books carry the whole contrast
 * budget of the picture and everything around them is plaster.
 */
export function generatedCoverCanvas(title: string, author: string, size = 512): HTMLCanvasElement {
  const width = size;
  const height = Math.round(size * 1.5);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const hash = hashString(title || "untitled");
  const ground = COVER_GROUNDS[hash % COVER_GROUNDS.length];

  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);

  // Press grain: a faint vertical wash so the board is not perfectly flat.
  const wash = ctx.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, "rgba(255, 252, 246, 0.16)");
  wash.addColorStop(0.55, "rgba(255, 255, 255, 0)");
  wash.addColorStop(1, "rgba(74, 66, 58, 0.05)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  const margin = width * 0.12;
  const plate = (hash >>> 5) % 3 !== 0;

  ctx.fillStyle = COVER_INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const titleSize = Math.round(width * (plate ? 0.082 : 0.098));
  ctx.font = `500 ${titleSize}px "Iowan Old Style", Georgia, serif`;
  const lines = fitText(ctx, title || "Untitled", width - margin * 2, plate ? 2 : 3);
  let y = height * (plate ? 0.135 : 0.235);
  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += titleSize * 1.2;
  }

  if (plate) {
    // A quiet plate: a horizon, a wash, a soft veil. Never a picture of
    // anything, but enough tonal weight to read as printed artwork.
    const top = height * 0.3;
    const bottom = height - margin * 0.9;
    const left = margin * 0.75;
    const right = width - margin * 0.75;
    const horizon = top + (bottom - top) * (0.42 + (((hash >>> 11) % 100) / 100) * 0.26);
    // Pale, and only a little darker than the board it sits on. The plates in
    // the reference are washed-out photographs, not blocks — an inset much
    // below the cover's own value reads as a broken image, which is precisely
    // how the first build looked.
    const sky = ctx.createLinearGradient(0, top, 0, horizon);
    sky.addColorStop(0, "#E4DFD9");
    sky.addColorStop(1, "#D3CCC5");
    ctx.fillStyle = sky;
    ctx.fillRect(left, top, right - left, horizon - top);
    const land = ctx.createLinearGradient(0, horizon, 0, bottom);
    land.addColorStop(0, "#AFA69E");
    land.addColorStop(1, "#C6BEB6");
    ctx.fillStyle = land;
    ctx.fillRect(left, horizon, right - left, bottom - horizon);
    const veil = ctx.createLinearGradient(0, top, 0, bottom);
    veil.addColorStop(0, "rgba(255, 250, 242, 0.20)");
    veil.addColorStop(1, "rgba(40, 34, 28, 0.05)");
    ctx.fillStyle = veil;
    ctx.fillRect(left, top, right - left, bottom - top);
  } else {
    ctx.strokeStyle = "rgba(42, 38, 34, 0.42)";
    ctx.lineWidth = Math.max(1, width * 0.004);
    ctx.beginPath();
    ctx.moveTo(width * 0.38, y + titleSize * 0.42);
    ctx.lineTo(width * 0.62, y + titleSize * 0.42);
    ctx.stroke();

    const authorSize = Math.round(width * 0.045);
    ctx.font = `500 ${authorSize}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = "rgba(42, 38, 34, 0.8)";
    const spaced = (author || "Unknown author").toUpperCase().split("").join(" ");
    ctx.fillText(spaced, width / 2, y + titleSize * 1.35);
  }

  return canvas;
}

/**
 * The spine: the same ground as the cover with the title running bottom-to-top,
 * so a book turned edge-on in the niche still names itself.
 */
export function spineCanvas(title: string, author: string, size = 512): HTMLCanvasElement {
  const height = size;
  const width = Math.round(size * 0.16);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const hash = hashString(title || "untitled");
  ctx.fillStyle = COVER_GROUNDS[hash % COVER_GROUNDS.length];
  ctx.fillRect(0, 0, width, height);

  const shade = ctx.createLinearGradient(0, 0, width, 0);
  shade.addColorStop(0, "rgba(120, 108, 96, 0.20)");
  shade.addColorStop(0.5, "rgba(255, 255, 255, 0.14)");
  shade.addColorStop(1, "rgba(120, 108, 96, 0.20)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = Math.round(width * 0.44);
  ctx.font = `500 ${fontSize}px "Iowan Old Style", Georgia, serif`;
  ctx.fillStyle = COVER_INK;
  const label = fitText(ctx, `${title}${author ? `  ·  ${author}` : ""}`, height * 0.86, 1)[0] ?? "";
  ctx.fillText(label, 0, 0);
  ctx.restore();

  return canvas;
}

/** Cream page block with a faint striation, seen at the fore edge. Never
 *  white — against a plaster wall a white page edge reads as a blown highlight. */
export function pagesCanvas(size = 256): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#DED3C2";
  ctx.fillRect(0, 0, size, size);
  let seed = 7717;
  for (let x = 0; x < size; x += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const tone = (seed / 0xffffffff) * 0.16;
    ctx.fillStyle = `rgba(176, 160, 138, ${tone.toFixed(3)})`;
    ctx.fillRect(x, 0, 1, size);
  }
  return canvas;
}
