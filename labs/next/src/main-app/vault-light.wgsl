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
const NICHE_DEPTH: f32 = 0.055;
const WARM: vec3f = vec3f(1.0, 0.94, 0.86);
const VOLUME_STEPS: i32 = 16;
const AIM_Y: f32 = 0.7;
const AIM_Z: f32 = 0.9;
const AIM_SPLAY: f32 = 0.0;
const VOLUME_DENSITY: f32 = 0.28;
const PLASTER_ALBEDO: f32 = 0.62;

struct Hit {
  p: vec3f,
  n: vec3f,
  spec: f32,
  gloss: f32,
  book: f32,
  well: f32,
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

fn lampOn(i: i32) -> bool {
  let bits = u32(params.falloff.w + 0.5);
  return (bits & (1u << u32(i))) != 0u;
}

fn anyLamp() -> bool {
  return u32(params.falloff.w + 0.5) != 0u;
}

fn openingX(backU: f32) -> f32 {
  let depthX = params.depth.z;
  return depthX + backU * (1.0 - 2.0 * depthX);
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
  return max(0.062, 0.072 + lookX(col) * -0.024);
}

fn insetR(col: i32) -> f32 {
  return max(0.062, 0.072 + lookX(col) * 0.024);
}

fn insetT(row: i32) -> f32 {
  return max(0.064, 0.074 + lookY(row) * 0.02);
}

fn insetB(row: i32) -> f32 {
  return max(0.064, 0.076 + lookY(row) * -0.026);
}

fn worldH() -> f32 {
  return params.res.y / params.res.x;
}

fn lightPosAt(i: i32) -> vec3f {
  return vec3f(lightXAt(i), worldH() - 0.008, params.extra.w);
}

fn lightAimAt(i: i32) -> vec3f {
  let H = worldH();
  let D = params.depth.w;
  return vec3f(lightXAt(i) + (f32(i) - 2.0) * abs(f32(i) - 2.0) * AIM_SPLAY, H * AIM_Y, -D * AIM_Z);
}

fn lightTravelAt(i: i32) -> vec3f {
  return normalize(lightAimAt(i) - lightPosAt(i));
}

fn hitAlcove(uv: vec2f) -> Hit {
  let depthT = params.depth.x;
  let depthB = params.depth.y;
  let depthX = params.depth.z;
  let D = params.depth.w;
  let W = 1.0;
  let H = worldH();
  var hit: Hit;
  hit.spec = 0.04;
  hit.gloss = 24.0;
  hit.book = 0.0;
  hit.well = 0.0;

  let ceilingT = uv.y / max(depthT, 0.0001);
  let ceilLeft = mix(0.0, depthX, saturate(ceilingT));
  let ceilRight = mix(1.0, 1.0 - depthX, saturate(ceilingT));
  if (uv.y <= depthT && uv.x >= ceilLeft && uv.x <= ceilRight) {
    hit.p = vec3f(uv.x * W, H, mix(0.0, -D, saturate(ceilingT)));
    hit.n = vec3f(0.0, -1.0, 0.0);
    hit.spec = 0.1;
    hit.gloss = 20.0;
    return hit;
  }

  let floorT = (uv.y - (1.0 - depthB)) / max(depthB, 0.0001);
  let floorLeft = mix(depthX, 0.0, saturate(floorT));
  let floorRight = mix(1.0 - depthX, 1.0, saturate(floorT));
  if (uv.y >= 1.0 - depthB && uv.x >= floorLeft && uv.x <= floorRight) {
    hit.p = vec3f(uv.x * W, 0.0, mix(-D, 0.0, saturate(floorT)));
    hit.n = vec3f(0.0, 1.0, 0.0);
    hit.spec = 0.28;
    hit.gloss = 48.0;
    return hit;
  }

  let wallT = uv.x / max(depthX, 0.0001);
  let wallTop = mix(0.0, depthT, saturate(wallT));
  let wallBot = mix(1.0, 1.0 - depthB, saturate(wallT));
  if (uv.x <= depthX && uv.y >= wallTop && uv.y <= wallBot) {
    hit.p = vec3f(0.0, H * (1.0 - uv.y), mix(0.0, -D, saturate(wallT)));
    hit.n = vec3f(1.0, 0.0, 0.0);
    hit.spec = 0.07;
    return hit;
  }

  let wallTr = (1.0 - uv.x) / max(depthX, 0.0001);
  let wallTopR = mix(0.0, depthT, saturate(wallTr));
  let wallBotR = mix(1.0, 1.0 - depthB, saturate(wallTr));
  if (uv.x >= 1.0 - depthX && uv.y >= wallTopR && uv.y <= wallBotR) {
    hit.p = vec3f(W, H * (1.0 - uv.y), mix(0.0, -D, saturate(wallTr)));
    hit.n = vec3f(-1.0, 0.0, 0.0);
    hit.spec = 0.07;
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

  let worldX = mix(depthX, 1.0 - depthX, backU);
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

    let nicheX0 = openingX(SIDE_PAD + f32(col) * cellW);
    let nicheX1 = openingX(SIDE_PAD + f32(col) * cellW + NICHE_W);
    let nicheTopV = padY + f32(row) * cellH;
    let nicheY1 = H * (1.0 - nicheTopV);
    let nicheY0 = H * (1.0 - (nicheTopV + nicheH));
    hit.well = 1.0;

    if (onBook) {
      let bx = mix(nicheX0, nicheX1, lu);
      let by = mix(nicheY1, nicheY0, lv);
      hit.p = vec3f(bx, by, -D + NICHE_DEPTH * 0.42);
      hit.n = normalize(vec3f((lu - 0.5) * 0.12, 0.16, 1.0));
      hit.spec = 0.08;
      hit.gloss = 18.0;
      hit.book = 1.0;
      return hit;
    }

    if (lu < iL) {
      let t = saturate(lu / max(iL, 0.0001));
      hit.p = vec3f(mix(nicheX0, nicheX0 + 0.004, t), mix(nicheY1, nicheY0, lv), mix(-D, -D - NICHE_DEPTH, t));
      hit.n = normalize(mix(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.12), smoothstep(0.0, 0.42, t)));
      hit.spec = 0.06;
      return hit;
    }
    if (lu > 1.0 - iR) {
      let t = saturate((1.0 - lu) / max(iR, 0.0001));
      hit.p = vec3f(mix(nicheX1, nicheX1 - 0.004, t), mix(nicheY1, nicheY0, lv), mix(-D, -D - NICHE_DEPTH, t));
      hit.n = normalize(mix(vec3f(0.0, 0.0, 1.0), vec3f(-1.0, 0.0, 0.12), smoothstep(0.0, 0.42, t)));
      hit.spec = 0.06;
      return hit;
    }
    if (lv < iT) {
      let t = saturate(lv / max(iT, 0.0001));
      hit.p = vec3f(mix(nicheX0, nicheX1, lu), mix(nicheY1, nicheY1 - 0.004, t), mix(-D, -D - NICHE_DEPTH, t));
      hit.n = normalize(mix(vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.1), smoothstep(0.0, 0.42, t)));
      hit.spec = 0.05;
      return hit;
    }
    if (lv > 1.0 - iB) {
      let t = saturate((1.0 - lv) / max(iB, 0.0001));
      hit.p = vec3f(mix(nicheX0, nicheX1, lu), mix(nicheY0, nicheY0 + 0.004, t), mix(-D, -D - NICHE_DEPTH, t));
      hit.n = normalize(mix(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.08), smoothstep(0.0, 0.42, t)));
      hit.spec = 0.14;
      hit.gloss = 22.0;
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

fn sampleLight(p: vec3f, i: i32) -> f32 {
  if (!lampOn(i)) { return 0.0; }
  let pos = lightPosAt(i);
  let travel = lightTravelAt(i);
  let toPoint = p - pos;
  let dist = length(toPoint);
  let cosTheta = dot(normalize(toPoint), travel);
  let cone = spotCone(cosTheta, params.falloff.x, params.falloff.y);
  return params.intensity * cone * attenuation(dist, params.falloff.z, params.extra.y);
}

/** Un-coned falloff so the can still lights its own soffit. */
fn fixtureGlow(p: vec3f, i: i32) -> f32 {
  if (!lampOn(i)) { return 0.0; }
  let dist = length(p - lightPosAt(i));
  return params.intensity * attenuation(dist, params.falloff.z * 0.42, params.extra.y * 0.5);
}

/** Spot energy along the beam axis so shafts travel from the can, not as a 2D wash. */
fn beamEnergy(p: vec3f, i: i32) -> f32 {
  if (!lampOn(i)) { return 0.0; }
  let pos = lightPosAt(i);
  let travel = lightTravelAt(i);
  let toP = p - pos;
  let dist = length(toP);
  if (dist < 0.0001) {
    return params.intensity * 4.0;
  }
  let along = dot(toP, travel);
  let radial = length(toP - travel * along);
  let cosTheta = along / dist;
  let cone = spotCone(cosTheta, params.falloff.x, params.falloff.y);
  let energy = params.intensity * cone * attenuation(dist, params.falloff.z, params.extra.y);
  let axis = exp(-radial * 11.0);
  return energy * (0.48 + axis * 1.15);
}

fn inScatter(p: vec3f, rd: vec3f) -> vec3f {
  var glow = vec3f(0.0);
  let lightColor = srgbToLinear3(WARM);
  for (var i = 0; i < LIGHT_COUNT; i++) {
    let pos = lightPosAt(i);
    let travel = lightTravelAt(i);
    let energy = beamEnergy(p, i);
    let toLight = pos - p;
    let dist = length(toLight);
    let toward = pow(max(dot(-rd, toLight / max(dist, 0.0001)), 0.0), 2.5);
    let along = pow(max(dot(-rd, travel), 0.0), 4.0);
    let phase = mix(0.78, 1.65, max(toward, along));
    let near = exp(-dist * 5.5);
    glow += lightColor * (energy * VOLUME_DENSITY * phase * (1.0 + near * 0.85) + fixtureGlow(p, i) * near * 0.45);
  }
  return glow;
}

fn raymarchVolume(ro: vec3f, rd: vec3f, tmax: f32) -> vec3f {
  var acc = vec3f(0.0);
  let steps = f32(VOLUME_STEPS);
  let ds = tmax / steps;
  for (var s = 0; s < VOLUME_STEPS; s++) {
    let t = (f32(s) + 0.5) * ds;
    acc += inScatter(ro + rd * t, rd) * ds;
  }
  return acc;
}

fn shadeSurface(hit: Hit) -> vec3f {
  let N = normalize(hit.n);
  let H = worldH();
  let cam = vec3f(0.5, 0.42 * H, 0.62);
  let V = normalize(cam - hit.p);
  let lightColor = srgbToLinear3(WARM);
  var direct = vec3f(0.0);

  for (var i = 0; i < LIGHT_COUNT; i++) {
    let pos = lightPosAt(i);
    let toPoint = hit.p - pos;
    let energy = sampleLight(hit.p, i);
    direct += lambert(N, toPoint, lightColor, energy);
    let Hvec = normalize(normalize(-toPoint) + V);
    let spec = pow(max(dot(N, Hvec), 0.0), hit.gloss) * hit.spec * energy;
    direct += lightColor * spec;
  }

  var ceilingKiss = 0.0;
  if (N.y < -0.4) {
    for (var i = 0; i < LIGHT_COUNT; i++) {
      let d = distance(hit.p.xz, lightPosAt(i).xz);
      ceilingKiss += exp(-d * 14.0) * fixtureGlow(hit.p, i);
    }
  }

  var bounceLight = vec3f(0.0);
  for (var i = 0; i < LIGHT_COUNT; i++) {
    if (!lampOn(i)) { continue; }
    let pos = lightPosAt(i);
    let floorP = vec3f(pos.x, 0.012, mix(pos.z, -params.depth.w * 0.7, 0.35));
    let toP = hit.p - floorP;
    let bounceE = params.intensity * 0.34 * attenuation(length(toP), params.falloff.z, params.extra.y * 1.6);
    bounceLight += lambert(N, toP, lightColor, bounceE);
  }

  var entered = 0.0;
  if (hit.well > 0.5) {
    let opening = vec3f(hit.p.x, hit.p.y, -params.depth.w);
    for (var i = 0; i < LIGHT_COUNT; i++) {
      entered += sampleLight(opening, i);
    }
    let recess = saturate((-hit.p.z - params.depth.w) / NICHE_DEPTH);
    entered *= mix(0.42, 0.2, recess);
  }

  var bounce = 0.0;
  if (abs(N.x) > 0.55) {
    bounce = 0.18;
  } else if (N.z > 0.5) {
    bounce = 0.16;
  } else if (N.y > 0.5) {
    bounce = 0.32;
  } else if (N.y < -0.4) {
    bounce = 0.14;
  } else {
    bounce = 0.2;
  }

  var well = 1.0;
  if (hit.well > 0.5) {
    let D = params.depth.w;
    let recess = saturate((-hit.p.z - D) / NICHE_DEPTH);
    well = mix(1.0, 0.82, recess);
    if (N.y < -0.3) {
      well = mix(0.78, 0.46, recess);
      bounce += 0.14;
    } else if (N.y > 0.35) {
      well = mix(1.0, 0.72, recess);
    } else if (abs(N.x) > 0.4) {
      well = mix(0.9, 0.58, recess);
    }
  }

  let up = saturate(hit.p.y / max(H, 0.0001));
  let ambient = 0.06 + 0.08 * up + 0.055 * (1.0 - up);
  return (direct * well + bounceLight) * (0.46 + bounce) * PLASTER_ALBEDO
    + lightColor * (ceilingKiss * 0.55 + ambient * 0.14 + entered * 0.045);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let hit = hitAlcove(uv);
  let identity = vec3f(0.5);
  if (hit.book > 0.5) {
    return vec4f(identity, 1.0);
  }
  if (!anyLamp()) {
    return vec4f(vec3f(0.32), 1.0);
  }
  let strength = mix(0.0, 1.0, saturate(params.lit));
  let soffit = hit.well < 0.5 && hit.n.y < -0.35;
  let H = worldH();
  let cam = vec3f(0.5, 0.42 * H, 0.62);
  let toHit = hit.p - cam;
  let dist = length(toHit);
  let rd = toHit / max(dist, 0.0001);
  var lit = vec3f(0.0);
  if (!soffit) {
    lit += raymarchVolume(cam, rd, dist);
  }
  lit += shadeSurface(hit);
  var rgb = identity + (lit - vec3f(0.07)) * 0.7 * strength;
  rgb = clamp(rgb, vec3f(0.48), vec3f(0.84));
  return vec4f(rgb, 1.0);
}
