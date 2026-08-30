import * as THREE from "three";
import { layoutBays, type BookSlot, type RibbonSpec } from "./shelf-geometry";
import {
  VIEW_HEIGHT,
  bayDepth,
  bayOptions,
  bayPlan,
  fitRibbons,
  wallExtent,
} from "./shelf-layout";
import { DEFAULT_SHELF_COLUMNS, type ShelfColumns } from "./shelf-prefs";
import { createWallMaterial, type ShelfWallMaterial } from "./shelf-wall-material";
import { generatedCoverCanvas, pagesCanvas, plasterGrainCanvas, spineCanvas } from "./shelf-art";

export interface ShelfBook {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  progress: number;
  completed: boolean;
}

export interface ShelfHover {
  id: string;
  /** Canvas-relative pixels, at the foot of the book. */
  x: number;
  y: number;
}

export interface ShelfScene {
  setBooks(books: ShelfBook[]): void;
  setColumns(columns: ShelfColumns): void;
  setAccent(hex: string): void;
  /** Keep the current hover alive while the pointer is over its HTML label. */
  holdHover(hold: boolean): void;
  dispose(): void;
}

export interface ShelfSceneOptions {
  canvas: HTMLCanvasElement;
  onOpen: (id: string) => void;
  onHover: (hover: ShelfHover | null) => void;
}

/** Camera stands well back with a narrow lens, so verticals stay vertical. */
const CAMERA_FOV = 24;
const CAMERA_DISTANCE = VIEW_HEIGHT / 2 / Math.tan((CAMERA_FOV / 2) * (Math.PI / 180));

/** The book's back board sits a hair in front of the wall plane. */
const BOOK_Z = 0.04;

const HOVER_LIFT = 0.5;
const HOVER_RISE = 0.06;

export function createShelfScene({ canvas, onOpen, onHover }: ShelfSceneOptions): ShelfScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  if (!renderer.getContext()) {
    throw new Error("WebGL unavailable");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 1, 400);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Shared textures ──────────────────────────────────────────────────────
  const grain = new THREE.CanvasTexture(plasterGrainCanvas(512));
  grain.wrapS = THREE.RepeatWrapping;
  grain.wrapT = THREE.RepeatWrapping;

  const pages = new THREE.CanvasTexture(pagesCanvas(256));
  pages.colorSpace = THREE.SRGBColorSpace;

  const environment = buildEnvironment(renderer);
  scene.environment = environment;

  // ── Materials ────────────────────────────────────────────────────────────
  const wallMaterial: ShelfWallMaterial = createWallMaterial(grain);
  const pageMaterial = new THREE.MeshStandardMaterial({
    map: pages,
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.16,
  });

  // ── Lights ───────────────────────────────────────────────────────────────
  // These reach the books only: the wall paints its own light. Book faces are
  // near-flat to camera, so the rig is deliberately dull — it exists to place
  // the covers at the right value, not to model them.
  const hemisphere = new THREE.HemisphereLight(0xfff5e8, 0xd6c3a8, 0.66);
  scene.add(hemisphere);

  const windowLight = new THREE.DirectionalLight(0xfffdf8, 0.34);
  windowLight.position.set(-24, 14, 34);
  scene.add(windowLight);

  // The cove, as far as a book is concerned: a warm kiss straight down onto
  // the top edge and the upper third of the cover.
  const coveLight = new THREE.DirectionalLight(0xfff0dc, 0.28);
  coveLight.position.set(0, 26, 9);
  scene.add(coveLight);

  // ── Groups rebuilt on change ─────────────────────────────────────────────
  const wallGroup = new THREE.Group();
  const bookGroup = new THREE.Group();
  scene.add(wallGroup, bookGroup);

  let aspect = 1.83;
  let ribbons: RibbonSpec[] = fitRibbons(aspect);
  let columns: ShelfColumns = DEFAULT_SHELF_COLUMNS;
  let books: ShelfBook[] = [];
  let accent = new THREE.Color(0x50384c);

  /** Everything the current set of books owns; thrown away on every rebuild. */
  let bookScrap: Array<{ dispose: () => void }> = [];
  const bookNodes: BookNode[] = [];

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let hoverId: string | null = null;
  let heldHover = false;
  let dirty = true;
  let running = true;
  let lastTime = performance.now();

  function markDirty() {
    dirty = true;
  }

  // ── Wall ─────────────────────────────────────────────────────────────────
  let wallGeometry: THREE.PlaneGeometry | null = null;

  function buildWall() {
    clearGroup(wallGroup);
    wallGeometry?.dispose();
    const extent = wallExtent(aspect);
    wallGeometry = new THREE.PlaneGeometry(extent.halfWidth * 2, extent.halfHeight * 2);
    wallGroup.add(new THREE.Mesh(wallGeometry, wallMaterial));
    wallMaterial.setRibbons(ribbons);
    wallMaterial.setFrame((VIEW_HEIGHT * aspect) / 2, VIEW_HEIGHT / 2);
    // Grain repeats in world units so it never stretches with the frame.
    grain.repeat.set(1, 1);
  }

  // ── Books ────────────────────────────────────────────────────────────────
  interface BookNode {
    id: string;
    group: THREE.Group;
    cover: THREE.Mesh;
    baseY: number;
    lift: number;
    target: number;
    /** Foot of the book in world space, where the HTML label is anchored. */
    anchor: THREE.Vector3;
  }

  function buildBooks() {
    clearGroup(bookGroup);
    bookNodes.length = 0;
    for (const item of bookScrap) {
      item.dispose();
    }
    bookScrap = [];

    const placed: BookSlot[] = [];
    let index = 0;
    for (let row = 0; row < ribbons.length; row += 1) {
      const ribbon = ribbons[row];
      const rowBooks = books.slice(index, index + columns);
      index += columns;
      if (rowBooks.length === 0) {
        continue;
      }
      // Every row is laid out for a full shelf so a half-empty wall keeps the
      // same rhythm as a full one.
      const plans = Array.from({ length: columns }, (_, slot) =>
        bayPlan(rowBooks[slot]?.id ?? `${row}:${slot}`, columns),
      );
      const slots = layoutBays(ribbon, plans, bayOptions(columns, row));
      for (let slot = 0; slot < rowBooks.length; slot += 1) {
        addBook(rowBooks[slot], slots[slot]);
        placed.push(slots[slot]);
      }
    }
    wallMaterial.setBooks(placed);
  }

  function addBook(book: ShelfBook, slot: BookSlot) {
    const depth = bayDepth(book.id, slot.width);
    const geometry = new THREE.BoxGeometry(slot.width, slot.height, depth);
    bookScrap.push(geometry);

    const group = new THREE.Group();
    group.position.set(slot.x, slot.baseY, BOOK_Z);
    // A degree or two of settle about the base, alternating so a row never
    // looks stamped out.
    const jitter = (hashUnit(book.id) - 0.5) * 2;
    group.rotation.x = -0.016 - jitter * 0.008;
    group.rotation.z = jitter * 0.004;

    const cover = new THREE.Mesh(geometry, bookMaterials(book, slot));
    cover.position.set(0, slot.height / 2, depth / 2);
    cover.userData.bookId = book.id;
    group.add(cover);
    bookGroup.add(group);

    bookNodes.push({
      id: book.id,
      group,
      cover,
      baseY: slot.baseY,
      lift: 0,
      target: 0,
      anchor: new THREE.Vector3(slot.x, slot.baseY - 0.3, BOOK_Z + depth),
    });
  }

  function bookMaterials(book: ShelfBook, slot: BookSlot): THREE.Material[] {
    const cover = coverTexture(book, slot.width);
    const spine = new THREE.CanvasTexture(spineCanvas(book.title, book.author, 512));
    spine.colorSpace = THREE.SRGBColorSpace;
    bookScrap.push(spine);

    const board = new THREE.MeshStandardMaterial({
      color: book.completed ? accent.clone().lerp(new THREE.Color(0xc9c0b8), 0.62) : 0xa79e97,
      roughness: 0.84,
      metalness: 0,
      envMapIntensity: 0.16,
    });
    const spineMaterial = new THREE.MeshStandardMaterial({
      map: spine,
      roughness: 0.84,
      metalness: 0,
      envMapIntensity: 0.16,
    });
    const coverMaterial = new THREE.MeshStandardMaterial({
      map: cover,
      roughness: 0.8,
      metalness: 0,
      envMapIntensity: 0.18,
    });
    bookScrap.push(board, spineMaterial, coverMaterial);
    // BoxGeometry order: +x, -x, +y, -y, +z, -z.
    return [pageMaterial, spineMaterial, pageMaterial, pageMaterial, coverMaterial, board];
  }

  function coverTexture(book: ShelfBook, width: number): THREE.Texture {
    if (book.coverUrl) {
      const texture = new THREE.TextureLoader().load(book.coverUrl, markDirty);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      bookScrap.push(texture);
      return texture;
    }
    const canvas = generatedCoverCanvas(book.title, book.author, Math.round(150 * width));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    bookScrap.push(texture);
    return texture;
  }

  // ── Sizing ───────────────────────────────────────────────────────────────
  function resize() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const nextAspect = width / height;
    renderer.setSize(width, height, false);
    camera.aspect = nextAspect;
    camera.updateProjectionMatrix();
    if (Math.abs(nextAspect - aspect) > 0.01) {
      aspect = nextAspect;
      ribbons = fitRibbons(aspect);
      buildWall();
      buildBooks();
    }
    markDirty();
  }

  const observer = new ResizeObserver(() => resize());
  if (canvas.parentElement) {
    observer.observe(canvas.parentElement);
  }

  // ── Pointer ──────────────────────────────────────────────────────────────
  function pickAt(clientX: number, clientY: number): BookNode | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      bookNodes.map((node) => node.cover),
      false,
    );
    const first = hits[0];
    if (!first) {
      return null;
    }
    const id = (first.object.userData as { bookId?: string }).bookId;
    return bookNodes.find((node) => node.id === id) ?? null;
  }

  function reportHover(node: BookNode | null) {
    if (!node) {
      hoverId = null;
      canvas.removeAttribute("data-over");
      onHover(null);
      return;
    }
    hoverId = node.id;
    canvas.setAttribute("data-over", "");
    const projected = node.anchor.clone().project(camera);
    onHover({
      id: node.id,
      x: ((projected.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - projected.y) / 2) * canvas.clientHeight,
    });
  }

  function onPointerMove(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    parallax.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    parallax.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    const node = pickAt(event.clientX, event.clientY);
    if (node?.id !== hoverId) {
      reportHover(node);
    }
    markDirty();
  }

  function onPointerLeave() {
    parallax.targetX = 0;
    parallax.targetY = 0;
    if (!heldHover) {
      reportHover(null);
    }
    markDirty();
  }

  function onClick(event: MouseEvent) {
    const node = pickAt(event.clientX, event.clientY);
    if (node) {
      onOpen(node.id);
    }
  }

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onClick);

  // ── Frame ────────────────────────────────────────────────────────────────
  function frame(now: number) {
    if (!running) {
      return;
    }
    const delta = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    let moving = false;

    for (const node of bookNodes) {
      node.target = node.id === hoverId ? 1 : 0;
      if (reduceMotion) {
        node.lift = node.target;
      } else if (Math.abs(node.lift - node.target) > 0.001) {
        // Time-based ease so the settle is identical on any refresh rate.
        node.lift += (node.target - node.lift) * (1 - Math.exp(-delta * 13));
        moving = true;
      } else {
        node.lift = node.target;
      }
      node.group.position.z = BOOK_Z + node.lift * HOVER_LIFT;
      node.group.position.y = node.baseY + node.lift * HOVER_RISE;
    }

    if (!reduceMotion) {
      const ease = 1 - Math.exp(-delta * 6);
      const dx = (parallax.targetX - parallax.x) * ease;
      const dy = (parallax.targetY - parallax.y) * ease;
      if (Math.abs(dx) > 0.0002 || Math.abs(dy) > 0.0002) {
        parallax.x += dx;
        parallax.y += dy;
        moving = true;
      }
      // A few pixels of head movement, so the wall has volume without drifting.
      camera.position.x = parallax.x * 0.55;
      camera.position.y = -parallax.y * 0.38;
      camera.lookAt(parallax.x * 0.12, -parallax.y * 0.08, 0);
    }

    if (dirty || moving) {
      renderer.render(scene, camera);
      dirty = false;
      if (hoverId) {
        const node = bookNodes.find((item) => item.id === hoverId);
        if (node) {
          reportHover(node);
        }
      }
    }
    requestAnimationFrame(frame);
  }

  resize();
  buildWall();
  buildBooks();
  requestAnimationFrame(frame);

  // A handle for the shot script and for measuring the frame back off the
  // buffer while tuning; the render loop is paused when the page is hidden.
  const debugKey = "__shelfWall";
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)[debugKey] = {
      render: () => renderer.render(scene, camera),
      material: wallMaterial,
    };
  }

  return {
    setBooks(next) {
      books = next;
      buildBooks();
      markDirty();
    },
    setColumns(next) {
      if (next === columns) {
        return;
      }
      columns = next;
      buildBooks();
      markDirty();
    },
    setAccent(hex) {
      accent = new THREE.Color(hex);
      buildBooks();
      markDirty();
    },
    holdHover(hold) {
      heldHover = hold;
    },
    dispose() {
      running = false;
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      clearGroup(wallGroup);
      clearGroup(bookGroup);
      for (const item of bookScrap) {
        item.dispose();
      }
      bookScrap = [];
      wallGeometry?.dispose();
      grain.dispose();
      pages.dispose();
      wallMaterial.dispose();
      pageMaterial.dispose();
      environment.dispose();
      renderer.dispose();
      if (import.meta.env.DEV) {
        delete (window as unknown as Record<string, unknown>)[debugKey];
      }
    },
  };
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    group.remove(group.children[0]);
  }
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 9) % 1000) / 999;
}

/**
 * A warm room in a texture, for the books to pick up: brighter and cooler at
 * the top left where the window is, settling to a warm floor bounce. The wall
 * does not use this — it paints its own light — but a cover with real artwork
 * needs something to sit in.
 */
function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#f6f1e9");
  sky.addColorStop(0.48, "#e6ded2");
  sky.addColorStop(0.52, "#d8cec0");
  sky.addColorStop(1, "#c6b9a8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const glare = ctx.createRadialGradient(48, 34, 2, 48, 34, 74);
  glare.addColorStop(0, "rgba(255, 255, 255, 0.7)");
  glare.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(texture);
  texture.dispose();
  pmrem.dispose();
  return target.texture;
}
