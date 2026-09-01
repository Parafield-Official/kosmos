import * as THREE from "three";
import type { RibbonSpec } from "./shelf-geometry";
import {
  INNER_FILLET,
  LIP_WIDTH,
  MERGE_RADIUS,
  OUTER_ROLL,
  PROUD,
  RECESS_DEPTH,
} from "./shelf-layout";

/**
 * The plaster wall, drawn as one height field.
 *
 * The reference is a straight-on, near-orthographic photograph, so the wall is
 * a single plane and its relief is evaluated per pixel from the ribbon
 * outlines: three lozenges standing proud of a base wall, smoothly maxed
 * together so they merge into one poured mass with a crease where they meet,
 * and a recess cut into each lozenge's face. Modelling this as real geometry
 * and lighting it with real lamps is what produced the flat cream smear —
 * a near-white diffuse surface under near-white light has nowhere to go. Here
 * every value in the frame is authored directly, which is the only way to hit
 * the reference's actual tonal structure: plaster spanning luminance 146–235,
 * a 20% room falloff to the right, warm shadows and near-neutral highlights.
 *
 * Books are still real meshes in front of this plane; their contact and cast
 * shadows are drawn here, from uniforms, so they land correctly on a curved
 * recess floor without a shadow map.
 */

const MAX_BOOKS = 15;

const VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vP = world.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

#define ROWS 3
#define MAX_BOOKS ${MAX_BOOKS}

varying vec2 vP;

uniform vec2  uRowX[ROWS];
uniform vec4  uTopEdge[ROWS];
uniform vec4  uBotEdge[ROWS];

uniform float uLip;
uniform float uRoll;
uniform float uProud;
uniform float uFillet;
uniform float uDepth;
uniform float uMerge;

uniform vec4  uBooks[MAX_BOOKS];
uniform int   uBookCount;

uniform sampler2D uGrain;
uniform float uGrainScale;
uniform float uGrainAmount;

uniform vec2  uFrame;
uniform vec3  uPlaster;
uniform vec3  uSky;
uniform vec3  uBounce;
uniform vec3  uKeyColour;
uniform vec3  uCoveColour;
uniform vec3  uJambColour;
uniform vec3  uKeyDir;
uniform float uKeyGain;
uniform float uAmbGain;
uniform float uCoveGain;
uniform float uWashGain;
uniform float uAoGain;
uniform float uShadowGain;
uniform vec3  uFallX;
uniform float uFallY;
uniform float uJambWidth;

const float PI = 3.141592653589793;

float ss(float x) {
  float t = clamp(x, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/* Smootherstep. Its curvature is zero at both ends as well as its slope, so a
   roll built from it has no crease where it flattens out. Plain smoothstep
   leaves a second-derivative jump there, which on a wall this soft shows up as
   a hard horizontal line right across the frame. */
float ss5(float x) {
  float t = clamp(x, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/* One swell along an edge: zero value and zero slope at both ends, so the
   caps stay tangent and the outline never creases. */
float bowShape(float u, float skew) {
  float k = clamp(skew, 0.12, 0.88);
  float v = u < k ? 0.5 * ss(u / k) : 0.5 + 0.5 * ss((u - k) / (1.0 - k));
  return sin(PI * v);
}

float edgeY(vec4 e, float u) {
  return mix(e.x, e.y, ss(u)) + e.z * bowShape(u, e.w);
}

/* Signed distance to one opening: negative inside. The spine runs horizontally
   between the cap centres and carries a varying radius, so the caps fall out of
   the same expression and the boundary is exact. */
float sdRow(vec2 xr, vec4 te, vec4 be, vec2 p) {
  float u = clamp((p.x - xr.x) / (xr.y - xr.x), 0.0, 1.0);
  float yt = edgeY(te, u);
  float yb = edgeY(be, u);
  vec2 q = vec2(mix(xr.x, xr.y, u), 0.5 * (yt + yb));
  return length(p - q) - 0.5 * (yt - yb);
}

vec3 sdAll(vec2 p) {
  return vec3(
    sdRow(uRowX[0], uTopEdge[0], uBotEdge[0], p),
    sdRow(uRowX[1], uTopEdge[1], uBotEdge[1], p),
    sdRow(uRowX[2], uTopEdge[2], uBotEdge[2], p));
}

/* Outwards from the opening: flat lip, then a long roll down to the base wall. */
float outerZ(float d) {
  return uProud * ss5((uLip + uRoll - d) / uRoll);
}

/* Inwards: a much steeper roll into the recess, then the flat back panel. */
float innerZ(float d) {
  return uDepth * ss5(-d / uFillet);
}

float smax(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

float surfaceZ(vec2 p) {
  vec3 d = sdAll(p);
  float lobes = smax(smax(outerZ(d.x), outerZ(d.y), uMerge), outerZ(d.z), uMerge);
  float cut = max(max(innerZ(d.x), innerZ(d.y)), innerZ(d.z));
  return lobes - cut;
}

/* Light thrown by one row's cove strip.
   x: the strip itself and its halo, wrapped round the caps
   y: the wash down the back panel
   z: how far inside the recess this point is */
vec3 coveRow(vec2 xr, vec4 te, vec4 be, vec2 p) {
  float u = clamp((p.x - xr.x) / (xr.y - xr.x), 0.0, 1.0);
  float yt = edgeY(te, u);
  float yb = edgeY(be, u);
  float radius = max(0.5 * (yt - yb), 0.05);
  vec2 q = vec2(mix(xr.x, xr.y, u), 0.5 * (yt + yb));
  vec2 v = p - q;
  float len = max(length(v), 1e-4);
  float d = len - radius;
  float around = v.y / len;

  // The strip is tucked behind the lip, at the crest of the inner roll.
  float ds = d + uFillet * 0.16;

  // It traces the ceiling, then wraps the caps and dies a little way along the
  // floor at each end. "endness" is how close to a cap we are.
  float endness = 1.0 - ss((min(p.x - xr.x, xr.y - p.x) + radius * 0.30) / (radius * 1.30));
  float lowest = mix(-0.10, -0.84, endness);
  float perimeter = ss((around - lowest + 0.30) / 0.58);

  // The source is concealed, so this term is deliberately faint. A halo held at
  // a fixed distance from the rim is a ring whatever its width, and a ring
  // reads as a light fixture laid on the wall — which is exactly how an earlier
  // build looked. The brightness the eye actually reads belongs to the wash
  // below, a vertical gradient down the back panel. This term only warms the
  // crest, and carries the wrap around the caps where a vertical gradient has
  // nothing to say. It must also die almost completely past the crest, or the
  // outer bead picks up an outline.
  float side = mix(1.0, 0.05, ss((ds + 0.05) / 0.34));
  float core = 0.06 * exp(-(ds * ds) / 0.55);
  float halo = 0.15 * exp(-abs(ds) / 1.45) + 0.15 * exp(-abs(ds) / 3.40);
  float glow = (core + halo) * side * perimeter;

  // Spill escaping forward past the lip, grazing the lozenge below. Monotone
  // decay, never a band with a peak in it.
  float under = yb - p.y;
  glow += 0.62 * ss(under / 0.60) * exp(-max(under, 0.0) / 2.6);

  float below = max(0.0, yt - p.y);
  // The wash reaches further out than the shadow mask does, because bounce off
  // the back panel washes back up onto the underside of the top lip — that is
  // what stops the lip reading as a dark overhang.
  float washMask = ss((uFillet * 0.9 - d) / (uFillet * 2.2));
  // Books stand ON the floor, which is the opening's own boundary. A mask that
  // reaches zero at d = 0 therefore erases every contact shadow at exactly the
  // touch line and leaves the books looking pasted on, so this stays near one
  // right through the floor fillet and only falls away out on the bead.
  float inside = ss((uFillet * 1.2 - d) / (uFillet * 1.4));
  // Brightest immediately under the lip and falling away down the panel — the
  // top quarter of the opening carries most of it, exactly as the reference's
  // back panels do.
  float aboveFloor = max(0.0, p.y - yb);
  float wash = (0.34 + 0.92 * exp(-below / (0.78 * radius))
    + 0.12 * exp(-abs(below - 2.0 * radius) / (0.32 * radius))
    + 0.62 * exp(-aboveFloor / (0.10 * radius)))
    * (1.0 - 0.30 * endness);
  return vec3(glow, wash * washMask, inside);
}

/* A soft shoulder instead of a hard clip: the reference has nothing at 255. */
float shoulder(float x) {
  float k = 0.86;
  return x < k ? x : k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k)));
}

void main() {
  vec2 p = vP;

  float e = 0.03;
  float z = surfaceZ(p);
  float zxp = surfaceZ(p + vec2(e, 0.0));
  float zxm = surfaceZ(p - vec2(e, 0.0));
  float zyp = surfaceZ(p + vec2(0.0, e));
  float zym = surfaceZ(p - vec2(0.0, e));
  vec3 n = normalize(vec3(-(zxp - zxm) / (2.0 * e), -(zyp - zym) / (2.0 * e), 1.0));

  // Broad occlusion: how much higher the plaster stands a little way off. This
  // is what darkens the crease between two lozenges and the far ends of a
  // niche. It shades the room fill only — the cove is a local source and is
  // not occluded by the wall it is mounted in.
  // Eight taps on two rings rather than a four-tap cross: a cross leaves
  // axis-aligned plateaus, which show up as horizontal bands right across a
  // wall made of nothing but wide soft gradients.
  float r = 1.35;
  float q = r * 0.48;
  float wide = 0.125 * (
      surfaceZ(p + vec2(r, 0.0)) + surfaceZ(p - vec2(r, 0.0))
    + surfaceZ(p + vec2(0.0, r)) + surfaceZ(p - vec2(0.0, r))
    + surfaceZ(p + vec2(q, q)) + surfaceZ(p + vec2(-q, q))
    + surfaceZ(p + vec2(q, -q)) + surfaceZ(p + vec2(-q, -q)));
  float occ = max(wide - z, 0.0) / uProud;
  // Saturating curve with no knee, so occlusion never terraces.
  float ao = 1.0 - uAoGain * (occ / (occ + 0.55));

  vec3 coveA = coveRow(uRowX[0], uTopEdge[0], uBotEdge[0], p);
  vec3 coveB = coveRow(uRowX[1], uTopEdge[1], uBotEdge[1], p);
  vec3 coveC = coveRow(uRowX[2], uTopEdge[2], uBotEdge[2], p);
  float glow = coveA.x + coveB.x + coveC.x;
  float wash = coveA.y + coveB.y + coveC.y;
  float inside = max(max(coveA.z, coveB.z), coveC.z);

  // Room gradient. The window is off to the left, so the near half of the wall
  // is evenly lit and the falloff only bites past the middle; the top right
  // corner is the darkest plaster in the frame. Blue falls fastest, which is
  // why the reference gets warmer with distance from the window while the
  // plaster next to it reads almost neutral.
  float rx = clamp((p.x + uFrame.x) / (2.0 * uFrame.x), 0.0, 1.0);
  float ry = clamp((p.y + uFrame.y) / (2.0 * uFrame.y), 0.0, 1.0);
  float away = ss((rx - 0.22) / 0.74);
  vec3 room = (1.0 - uFallX * away) * (1.0 - uFallY * ry * away);

  float ndl = dot(n, normalize(uKeyDir));
  float key = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 ambient = mix(uBounce, uSky, hemi) * (uAmbGain * ao);

  vec3 col = uPlaster * (ambient + uKeyColour * (uKeyGain * key)) * room;
  col += uCoveColour * (uCoveGain * glow + uWashGain * wash) * mix(1.0, 0.68, rx);

  // Books: a short contact shadow at the touch line and a wide, very faint
  // cast on the back panel, offset down and away from the middle of the frame.
  float shade = 0.0;
  for (int i = 0; i < MAX_BOOKS; i++) {
    if (i >= uBookCount) break;
    vec4 b = uBooks[i];
    vec2 rel = p - vec2(b.x, b.y);
    // Gaussians, not plateaus: a soft-edged rectangle leaves a visible seam
    // where its shoulder starts, and on this wall that reads as a step.
    float sx = rel.x / (b.z * 1.18);
    float contactX = exp(-sx * sx);
    float contactY = 0.40 * exp(-abs(rel.y) / (b.w * 0.16))
      + 0.60 * exp(-abs(rel.y) / (b.w * 0.032));
    vec2 drop = vec2(b.x + sign(b.x) * b.z * 0.40, b.y + b.w * 0.26);
    float dx = (p.x - drop.x) / (b.z * 1.9);
    float dy = (p.y - drop.y) / (b.w * 0.7);
    shade += contactX * contactY * 0.95 + exp(-dx * dx - dy * dy) * 0.10;
  }
  col *= 1.0 - clamp(shade, 0.0, 1.0) * uShadowGain * inside;

  // Fine plaster grain, held to the mid-tones so it never speckles a highlight.
  float grain = texture2D(uGrain, p * uGrainScale).r - 0.5;
  float mid = 1.0 - ss(abs(max(col.r, max(col.g, col.b)) - 0.55) / 0.42);
  col *= 1.0 + grain * uGrainAmount * mid;

  // The window jamb: the one cool thing in the picture, a sliver at the far
  // left with its own shadow line falling onto the plaster beside it.
  float jamb = 1.0 - ss((rx - uJambWidth * 0.55) / (uJambWidth * 0.5));
  float reveal = ss((rx - uJambWidth) / (uJambWidth * 0.55))
    * (1.0 - ss((rx - uJambWidth * 1.1) / (uJambWidth * 2.6)));
  col = mix(col, uJambColour * 0.50, jamb);
  col *= 1.0 - 0.16 * reveal;

  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col *= 1.0 + (dither - 0.5) * 0.016;

  col = vec3(shoulder(col.r), shoulder(col.g), shoulder(col.b));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function linear(hex: number): THREE.Vector3 {
  const colour = new THREE.Color(hex);
  return new THREE.Vector3(colour.r, colour.g, colour.b);
}

export interface ShelfWallMaterial extends THREE.ShaderMaterial {
  setRibbons(ribbons: ReadonlyArray<RibbonSpec>): void;
  setBooks(books: ReadonlyArray<{ x: number; baseY: number; width: number; height: number }>): void;
  setFrame(halfWidth: number, halfHeight: number): void;
}

export function createWallMaterial(grain: THREE.Texture): ShelfWallMaterial {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uRowX: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uTopEdge: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uBotEdge: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uLip: { value: LIP_WIDTH },
      uRoll: { value: OUTER_ROLL },
      uProud: { value: PROUD },
      uFillet: { value: INNER_FILLET },
      uDepth: { value: RECESS_DEPTH },
      uMerge: { value: MERGE_RADIUS },
      uBooks: {
        value: Array.from({ length: MAX_BOOKS }, () => new THREE.Vector4()),
      },
      uBookCount: { value: 0 },
      uGrain: { value: grain },
      uGrainScale: { value: 0.34 },
      uGrainAmount: { value: 0.075 },
      uFrame: { value: new THREE.Vector2(26.5, 14.5) },

      // Values, not colours: the plaster is a mid-tone that the cove has room
      // to be brighter than. The warmth lives in the bounce and the albedo, so
      // shadows read warm while the cove line comes out nearly neutral.
      uPlaster: { value: linear(0xcac7c3) },
      uSky: { value: linear(0xfffdfa) },
      uBounce: { value: linear(0xffecd8) },
      uKeyColour: { value: linear(0xfffefc) },
      uCoveColour: { value: linear(0xfffefd) },
      uJambColour: { value: linear(0xdfe6f0) },
      uKeyDir: { value: new THREE.Vector3(-0.34, 0.52, 0.78) },
      uKeyGain: { value: 0.78 },
      uAmbGain: { value: 0.4 },
      uCoveGain: { value: 0.44 },
      uWashGain: { value: 0.46 },
      uAoGain: { value: 0.62 },
      uShadowGain: { value: 0.9 },
      uFallX: { value: new THREE.Vector3(0.36, 0.4, 0.46) },
      uFallY: { value: 0.16 },
      uJambWidth: { value: 0.024 },
    },
  }) as ShelfWallMaterial;

  material.setRibbons = (ribbons) => {
    const rowX = material.uniforms.uRowX.value as THREE.Vector2[];
    const top = material.uniforms.uTopEdge.value as THREE.Vector4[];
    const bottom = material.uniforms.uBotEdge.value as THREE.Vector4[];
    for (let index = 0; index < 3; index += 1) {
      const ribbon = ribbons[index] ?? ribbons[0];
      rowX[index].set(ribbon.x0, ribbon.x1);
      top[index].set(ribbon.top.start, ribbon.top.end, ribbon.top.bow, ribbon.top.skew);
      bottom[index].set(
        ribbon.bottom.start,
        ribbon.bottom.end,
        ribbon.bottom.bow,
        ribbon.bottom.skew,
      );
    }
  };

  material.setBooks = (books) => {
    const slots = material.uniforms.uBooks.value as THREE.Vector4[];
    const count = Math.min(books.length, MAX_BOOKS);
    for (let index = 0; index < count; index += 1) {
      const book = books[index];
      slots[index].set(book.x, book.baseY, book.width / 2, book.height);
    }
    material.uniforms.uBookCount.value = count;
  };

  material.setFrame = (halfWidth, halfHeight) => {
    (material.uniforms.uFrame.value as THREE.Vector2).set(halfWidth, halfHeight);
  };

  return material;
}
