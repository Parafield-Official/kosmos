import { lambert } from "@vgpu/wgsl-std/light";
import { srgbToLinear3 } from "@vgpu/wgsl-std/color";

struct Params {
  res: vec2f,
  lit: f32,
  intensity: f32,
  depth: vec4f,
  falloff: vec4f,
  lightX: vec4f,
  extra: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;

const LIGHT_COUNT: i32 = 5;
const NICHE_W: f32 = 0.1195;
const NICHE_ASPECT: f32 = 127.0 / 143.0;
const COL_GAP: f32 = NICHE_W * 70.0 / 127.0;
const ROW_GAP: f32 = NICHE_W * 35.0 / 127.0;
const SIDE_PAD: f32 = NICHE_W * 74.0 / 127.0;
const VERT_PAD: f32 = NICHE_W * 46.0 / 127.0;
const BOOK_W: f32 = 0.803;
const BOOK_H: f32 = 0.909;
const NICHE_DEPTH: f32 = 0.085;
const WARM: vec3f = vec3f(1.0, 0.93, 0.78);

struct Hit {
  p: vec3f,
  n: vec3f,
  spec: f32,
  gloss: f32,
}

fn saturate(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn lightXAt(i: i32) -> f32 {
  if (i == 0) { return params.lightX.x; }
  if (i == 1) { return params.lightX.y; }
  if (i == 2) { return params.lightX.z; }
  if (i == 3) { return params.lightX.w; }
  return params.extra.x;
}

fn occupiedAt(slot: i32) -> bool {
  let bits = u32(params.extra.z + 0.5);
  return (bits & (1u << u32(slot))) != 0u;
}

fn attenuation(distance: f32, range: f32, radius: f32) -> f32 {
  let d2 = distance * distance + radius * radius;
  let inv = 1.0 / d2;
  let nd = saturate(distance / range);
  let window = 1.0 - nd * nd;
  return inv * window * window;
}

fn spotCone(cosTheta: f32, innerCos: f32, outerCos: f32) -> f32 {
  return smoothstep(outerCos, innerCos, cosTheta);
}

fn lookX(col: i32) -> f32 {
  return (f32(col) - 2.0) * 0.5;
}

fn lookY(row: i32) -> f32 {
  if (row == 0) { return 0.42; }
  if (row == 1) { return 0.12; }
  return -0.28;
}

fn insetL(col: i32) -> f32 {
  return max(0.032, 0.055 + lookX(col) * -0.09);
}

fn insetR(col: i32) -> f32 {
  return max(0.032, 0.055 + lookX(col) * 0.09);
}

fn insetT(row: i32) -> f32 {
  return max(0.045, 0.075 + lookY(row) * 0.08);
}

fn insetB(row: i32) -> f32 {
  return max(0.038, 0.06 + lookY(row) * -0.12);
}

fn hitAlcove(uv: vec2f) -> Hit {
  let depthT = params.depth.x;
  let depthB = params.depth.y;
  let depthX = params.depth.z;
  let D = params.depth.w;
  let W = 1.0;
  let H = params.res.y / params.res.x;
  var hit: Hit;
  hit.spec = 0.04;
  hit.gloss = 24.0;

  let ceilingT = uv.y / max(depthT, 0.0001);
  let ceilLeft = mix(0.0, depthX, saturate(ceilingT));
  let ceilRight = mix(1.0, 1.0 - depthX, saturate(ceilingT));
  if (uv.y <= depthT && uv.x >= ceilLeft && uv.x <= ceilRight) {
    hit.p = vec3f(uv.x * W, H, mix(0.0, -D, saturate(ceilingT)));
    hit.n = vec3f(0.0, -1.0, 0.0);
    hit.spec = 0.08;
    hit.gloss = 18.0;
    return hit;
  }

  let floorT = (uv.y - (1.0 - depthB)) / max(depthB, 0.0001);
  let floorLeft = mix(depthX, 0.0, saturate(floorT));
  let floorRight = mix(1.0 - depthX, 1.0, saturate(floorT));
  if (uv.y >= 1.0 - depthB && uv.x >= floorLeft && uv.x <= floorRight) {
    hit.p = vec3f(uv.x * W, 0.0, mix(-D, 0.0, saturate(floorT)));
    hit.n = vec3f(0.0, 1.0, 0.0);
    hit.spec = 0.22;
    hit.gloss = 42.0;
    return hit;
  }

  let wallT = uv.x / max(depthX, 0.0001);
  let wallTop = mix(0.0, depthT, saturate(wallT));
  let wallBot = mix(1.0, 1.0 - depthB, saturate(wallT));
  if (uv.x <= depthX && uv.y >= wallTop && uv.y <= wallBot) {
    hit.p = vec3f(0.0, H * (1.0 - uv.y), mix(0.0, -D, saturate(wallT)));
    hit.n = vec3f(1.0, 0.0, 0.0);
    hit.spec = 0.06;
    return hit;
  }

  let wallTr = (1.0 - uv.x) / max(depthX, 0.0001);
  let wallTopR = mix(0.0, depthT, saturate(wallTr));
  let wallBotR = mix(1.0, 1.0 - depthB, saturate(wallTr));
  if (uv.x >= 1.0 - depthX && uv.y >= wallTopR && uv.y <= wallBotR) {
    hit.p = vec3f(W, H * (1.0 - uv.y), mix(0.0, -D, saturate(wallTr)));
    hit.n = vec3f(-1.0, 0.0, 0.0);
    hit.spec = 0.06;
    return hit;
  }

  let backU = saturate((uv.x - depthX) / max(1.0 - 2.0 * depthX, 0.0001));
  let backV = saturate((uv.y - depthT) / max(1.0 - depthT - depthB, 0.0001));
  let backW = (1.0 - 2.0 * depthX) * W;
  let backH = (1.0 - depthT - depthB) * H;
  let backAspect = backW / max(backH, 0.0001);
  let padY = VERT_PAD * backAspect;
  let gapY = ROW_GAP * backAspect;
  let nicheH = NICHE_W * (1.0 / NICHE_ASPECT) * backAspect;

  let xLocal = backU - SIDE_PAD;
  let yLocal = backV - padY;
  let cellW = NICHE_W + COL_GAP;
  let cellH = nicheH + gapY;
  let colF = floor(xLocal / max(cellW, 0.0001));
  let rowF = floor(yLocal / max(cellH, 0.0001));
  let col = i32(colF);
  let row = i32(rowF);
  let inCol = col >= 0 && col < 5 && xLocal - colF * cellW <= NICHE_W;
  let inRow = row >= 0 && row < 3 && yLocal - rowF * cellH <= nicheH;

  let worldX = backU * W;
  let worldY = H * (1.0 - backV);

  if (inCol && inRow) {
    let lu = (xLocal - colF * cellW) / NICHE_W;
    let lv = (yLocal - rowF * cellH) / nicheH;
    let iL = insetL(col);
    let iR = insetR(col);
    let iT = insetT(row);
    let iB = insetB(row);
    let slot = row * 5 + col;
    let hasBook = occupiedAt(slot);
    let bookLeft = 0.5 - BOOK_W * 0.5;
    let bookRight = 0.5 + BOOK_W * 0.5;
    let bookTop = 1.0 - BOOK_H;
    let onBook = hasBook && lu > bookLeft && lu < bookRight && lv > bookTop;

    let nicheX0 = (SIDE_PAD + f32(col) * cellW) * W;
    let nicheX1 = nicheX0 + NICHE_W * W;
    let nicheTopV = padY + f32(row) * cellH;
    let nicheY1 = H * (1.0 - nicheTopV);
    let nicheY0 = H * (1.0 - (nicheTopV + nicheH));

    if (onBook) {
      let bx = mix(nicheX0, nicheX1, lu);
      let by = mix(nicheY1, nicheY0, lv);
      hit.p = vec3f(bx, by, -D + NICHE_DEPTH * 0.42);
      hit.n = normalize(vec3f((lu - 0.5) * 0.12, 0.08, 1.0));
      hit.spec = 0.28;
      hit.gloss = 36.0;
      return hit;
    }

    if (lu < iL) {
      let t = saturate(lu / max(iL, 0.0001));
      hit.p = vec3f(mix(nicheX0, nicheX0 + 0.004, t), mix(nicheY1, nicheY0, lv), mix(-D, -D - NICHE_DEPTH, t));
      hit.n = vec3f(1.0, 0.0, 0.12);
      hit.spec = 0.05;
      return hit;
    }
    if (lu > 1.0 - iR) {
      let t = saturate((1.0 - lu) / max(iR, 0.0001));
      hit.p = vec3f(mix(nicheX1, nicheX1 - 0.004, t), mix(nicheY1, nicheY0, lv), mix(-D, -D - NICHE_DEPTH, t));
      hit.n = vec3f(-1.0, 0.0, 0.12);
      hit.spec = 0.05;
      return hit;
    }
    if (lv < iT) {
      let t = saturate(lv / max(iT, 0.0001));
      hit.p = vec3f(mix(nicheX0, nicheX1, lu), mix(nicheY1, nicheY1 - 0.004, t), mix(-D, -D - NICHE_DEPTH, t));
      hit.n = vec3f(0.0, -1.0, 0.1);
      hit.spec = 0.04;
      return hit;
    }
    if (lv > 1.0 - iB) {
      let t = saturate((1.0 - lv) / max(iB, 0.0001));
      hit.p = vec3f(mix(nicheX0, nicheX1, lu), mix(nicheY0, nicheY0 + 0.004, t), mix(-D, -D - NICHE_DEPTH, t));
      hit.n = vec3f(0.0, 1.0, 0.08);
      hit.spec = 0.1;
      hit.gloss = 20.0;
      return hit;
    }

    hit.p = vec3f(mix(nicheX0, nicheX1, lu), mix(nicheY1, nicheY0, lv), -D - NICHE_DEPTH);
    hit.n = vec3f(0.0, 0.0, 1.0);
    hit.spec = 0.05;
    return hit;
  }

  hit.p = vec3f(worldX, worldY, -D);
  hit.n = vec3f(0.0, 0.0, 1.0);
  hit.spec = 0.05;
  return hit;
}

fn shade(hit: Hit) -> vec3f {
  let N = normalize(hit.n);
  let W = 1.0;
  let H = params.res.y / params.res.x;
  let D = params.depth.w;
  let cam = vec3f(0.5 * W, 0.42 * H, 0.62);
  let V = normalize(cam - hit.p);
  let innerCos = params.falloff.x;
  let outerCos = params.falloff.y;
  let range = params.falloff.z;
  let ambient = params.falloff.w;
  let radius = params.extra.y;
  let z = params.extra.w;
  let lightColor = srgbToLinear3(WARM);
  let strength = mix(0.22, 1.0, saturate(params.lit));

  var direct = vec3f(0.0);
  var glow = 0.0;

  for (var i = 0; i < LIGHT_COUNT; i++) {
    let lx = lightXAt(i);
    let pos = vec3f(lx, H - 0.006, z);
    let aim = vec3f(lx, H * 0.86, -D);
    let travel = normalize(aim - pos);
    let toPoint = hit.p - pos;
    let dist = length(toPoint);
    let cosTheta = dot(normalize(toPoint), travel);
    let cone = spotCone(cosTheta, innerCos, outerCos);
    let atten = attenuation(dist, range, radius);
    let energy = params.intensity * cone * atten * strength;
    direct += lambert(N, toPoint, lightColor, energy);

    let Hvec = normalize(normalize(-toPoint) + V);
    let spec = pow(max(dot(N, Hvec), 0.0), hit.gloss) * hit.spec * energy;
    direct += lightColor * spec;

    let dCeil = distance(hit.p.xz, pos.xz);
    let spill = params.intensity * strength * exp(-dCeil * 18.0) / (dist * dist + 0.02);
    glow += spill * step(N.y, -0.5);
  }

  let bounceFloor = 0.04 * max(N.y, 0.0) * strength;
  let bounceCeil = 0.03 * max(-N.y, 0.0) * strength;
  let bounceBack = 0.02 * max(N.z, 0.0) * strength;
  let heightGain = mix(0.64, 1.0, saturate(hit.p.y / max(H, 0.0001)));
  let fill = lightColor * (ambient * strength * (0.7 + 0.3 * max(N.z, 0.0)) + bounceFloor + bounceCeil + bounceBack);
  let ceilingSpill = lightColor * glow * 0.7;

  return (direct * heightGain + fill + ceilingSpill);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let hit = hitAlcove(uv);
  let linear = shade(hit);
  let lum = clamp(dot(linear, vec3f(0.22, 0.71, 0.07)), 0.5, 1.0);
  return vec4f(lum * 1.03, lum, lum * 0.94, 1.0);
}
