import * as THREE from "three";
import {
  COLUMNS,
  LIGHT_INTENSITY,
  LIGHT_RADIUS,
  LIGHT_RANGE,
  OPENING_ASPECT,
  SPOT_INNER_DEG,
  SPOT_OUTER_DEG,
  WORLD_DEPTH,
  degToRad,
  lightAim,
  lightPos,
  type VaultLightState,
} from "./vault-light-layout";

const VOLUME_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const VOLUME_FRAG = /* glsl */ `
  uniform vec3 uLightPos;
  uniform vec3 uLightDir;
  uniform float uInner;
  uniform float uOuter;
  uniform float uIntensity;
  uniform float uRange;
  uniform float uRadius;
  uniform float uShown;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vec3 toPoint = vWorldPos - uLightPos;
    float dist = length(toPoint);
    vec3 dir = toPoint / max(dist, 0.0001);
    float cosTheta = dot(dir, uLightDir);
    float cone = smoothstep(uOuter, uInner, cosTheta);
    float nd = clamp(dist / uRange, 0.0, 1.0);
    float window = 1.0 - nd * nd;
    float atten = (1.0 / (dist * dist + uRadius * uRadius)) * window * window;
    vec3 view = normalize(cameraPosition - vWorldPos);
    float shell = pow(1.0 - abs(dot(normalize(vNormal), view)), 1.35);
    float along = pow(max(dot(-view, uLightDir), 0.0), 5.0);
    float glow = cone * atten * uIntensity * uShown * mix(0.22, 0.95, shell) * mix(0.75, 1.25, along);
    vec3 rgb = vec3(0.50) + vec3(1.0, 0.88, 0.7) * glow * 0.12;
    rgb = clamp(rgb, vec3(0.47), vec3(0.62));
    gl_FragColor = vec4(rgb, 1.0);
  }
`;

/**
 * WebGL fallback: five cones in the alcove, aimed from the ceiling gimbals.
 * Used when WebGPU is missing so the shafts still occupy the air.
 */
export function startVaultVolume(canvas: HTMLCanvasElement, getState: () => VaultLightState): () => void {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  if (!renderer.getContext()) {
    renderer.dispose();
    throw new Error("WebGL unavailable");
  }
  renderer.setClearColor(0x808080, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = true;

  const height = OPENING_ASPECT;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x808080);
  const camera = new THREE.OrthographicCamera(0, 1, height, 0, 0.04, 4);
  camera.position.set(0.5, height * 0.5, 0.72);
  camera.lookAt(0.5, height * 0.5, -WORLD_DEPTH * 0.45);

  const inner = Math.cos(degToRad(SPOT_INNER_DEG));
  const outer = Math.cos(degToRad(SPOT_OUTER_DEG));
  const materials: THREE.ShaderMaterial[] = [];
  const cones: THREE.Mesh[] = [];

  for (let column = 0; column < COLUMNS; column++) {
    const pos = lightPos(column, height);
    const aim = lightAim(column, height);
    const travel = new THREE.Vector3(aim.x - pos.x, aim.y - pos.y, aim.z - pos.z);
    const length = travel.length();
    travel.normalize();

    const radius = Math.tan(degToRad(SPOT_OUTER_DEG)) * length;
    const geometry = new THREE.ConeGeometry(radius, length, 24, 1, true);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uLightPos: { value: new THREE.Vector3(pos.x, pos.y, pos.z) },
        uLightDir: { value: travel },
        uInner: { value: inner },
        uOuter: { value: outer },
        uIntensity: { value: LIGHT_INTENSITY * 0.55 },
        uRange: { value: LIGHT_RANGE },
        uRadius: { value: LIGHT_RADIUS },
        uShown: { value: 0 },
      },
      vertexShader: VOLUME_VERT,
      fragmentShader: VOLUME_FRAG,
      transparent: false,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), travel);
    mesh.translateY(-length * 0.5);
    scene.add(mesh);
    materials.push(material);
    cones.push(mesh);
  }

  let shown = 0;
  let running = true;
  let raf = 0;
  let lastLamps = -1;

  const resize = () => {
    const width = Math.max(1, canvas.clientWidth);
    const nextHeight = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, nextHeight, false);
    schedule();
  };

  const draw = () => {
    if (!running) return;
    const state = getState();
    const target = state.lit ? 1 : 0.14;
    shown += (target - shown) * 0.14;
    if (Math.abs(target - shown) < 0.003) shown = target;
    lastLamps = state.lamps;
    for (let i = 0; i < materials.length; i++) {
      const on = ((state.lamps >> i) & 1) === 1 ? 1 : 0;
      materials[i].uniforms.uShown.value = shown * on;
    }
    renderer.render(scene, camera);
    if (shown !== target) schedule();
  };

  const schedule = () => {
    if (raf || !running) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  };

  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const poll = window.setInterval(() => {
    if (!running) return;
    const state = getState();
    const target = state.lit ? 1 : 0.14;
    if (state.lamps !== lastLamps || Math.abs(target - shown) > 0.003) schedule();
  }, 120);
  schedule();

  return () => {
    running = false;
    window.clearInterval(poll);
    if (raf) cancelAnimationFrame(raf);
    observer.disconnect();
    for (const mesh of cones) {
      mesh.geometry.dispose();
    }
    for (const material of materials) {
      material.dispose();
    }
    renderer.dispose();
  };
}
