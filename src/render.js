// three.js rendering of LDraw models: interactive viewer and offscreen step/part images.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { PARTS_PATH, COLORS_URL, modelText } from './ldraw.js';

THREE.Cache.enabled = true; // part files are fetched once per session

const VIEW_DIR = new THREE.Vector3(0.95, 0.8, 1.15).normalize();
let colorsPromise = null;

export async function makeLoader() {
  const loader = new LDrawLoader();
  loader.setPartsLibraryPath(PARTS_PATH);
  loader.smoothNormals = true;
  colorsPromise ||= fetch(COLORS_URL).then((r) => r.text());
  const text = await colorsPromise;
  // preloadMaterials only takes a URL; feed the cached text through a blob URL.
  const url = URL.createObjectURL(new Blob([text]));
  await loader.preloadMaterials(url);
  URL.revokeObjectURL(url);
  return loader;
}

export function parseAsync(loader, text) {
  return new Promise((res, rej) =>
    loader.parse(text, (g) => { g.rotation.x = Math.PI; g.updateMatrixWorld(true); res(g); }, rej));
}

function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2.2);
  d.position.set(3, 6, 4);
  scene.add(d);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.8);
  d2.position.set(-4, 2, -3);
  scene.add(d2);
}

function frame(camera, box, pad = 1.1) {
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 1) * pad;
  const fov = (camera.fov * Math.PI) / 180;
  const dist = r / Math.sin(Math.min(fov, fov * camera.aspect) / 2);
  camera.position.copy(sphere.center).addScaledVector(VIEW_DIR, dist);
  camera.near = dist / 50;
  camera.far = dist * 10;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
  return sphere.center;
}

export class Viewer {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf4f5f7);
    lights(this.scene);
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    const tick = (now) => {
      if (!this.el.isConnected) return;
      if (this.drop) {
        const k = Math.min(1, (now - this.drop.t0) / 280);
        this.drop.obj.position.y = -(1 - k) * (1 - k) * 60; // LDraw space: -y is up
        if (k >= 1) { this.drop.obj.position.y = 0; this.drop = null; }
      }
      this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(tick);
    };
    tick(performance.now());
  }
  resize() {
    const w = this.el.clientWidth || 600, h = this.el.clientHeight || 400;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  show(group) {
    if (this.group) this.scene.remove(this.group);
    this.group = group;
    this.scene.add(group);
    const c = frame(this.camera, new THREE.Box3().setFromObject(group));
    this.controls.target.copy(c);
  }
  // Show the first n pieces; the newest one drops into place when animate is set.
  setShown(pieces, n, animate) {
    pieces.forEach((p, i) => { p.holder.visible = i < n; p.holder.position.set(0, 0, 0); });
    this.drop = animate && n > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches ? { obj: pieces[n - 1].holder, t0: performance.now() } : null;
  }
}

// Offscreen renderer that turns models into PNG data URLs.
export class Snapshotter {
  constructor(loader, model) {
    this.loader = loader;
    this.model = model;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    lights(this.scene);
    this.camera = new THREE.PerspectiveCamera(25, 1, 1, 10000);
    this.tag = 0;
    this.cache = new Map();
  }
  async group(lines) {
    return parseAsync(this.loader, modelText(this.model, lines, ++this.tag));
  }
  shot(group, w, h, box) {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.scene.add(group);
    frame(this.camera, box || new THREE.Box3().setFromObject(group), 1.04);
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(group);
    return url;
  }
  // Image of one part (or submodel) in one color, cached.
  async part(ref, color, size = 160) {
    const k = ref + '|' + color + '|' + size;
    if (!this.cache.has(k)) {
      const g = await this.group([`1 ${color} 0 0 0 1 0 0 0 1 0 0 0 1 ${ref}`]);
      this.cache.set(k, this.shot(g, size, size));
    }
    return this.cache.get(k);
  }
  // Image of a model file built up to step `index`; framed on the finished file so scale stays steady.
  async step(file, index, w, h, fadePrev = false) {
    if (!this.cache.has(file)) {
      const all = file.steps.flat().map((i) => i.line);
      this.cache.set(file, new THREE.Box3().setFromObject(await this.group(all)));
    }
    const finalBox = this.cache.get(file);
    const prev = file.steps.slice(0, index).flat().map((i) => i.line);
    const cur = file.steps[index].map((i) => i.line);
    const root = new THREE.Group();
    if (prev.length) {
      const pg = await this.group(prev);
      if (fadePrev) pg.traverse((o) => {
        if (o.material) {
          o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.35; return c; });
          if (o.material.length === 1) o.material = o.material[0];
        }
      });
      root.add(pg);
    }
    root.add(await this.group(cur));
    return this.shot(root, w, h, finalBox);
  }
  async full(file, w, h, dir) {
    const root = new THREE.Group();
    root.add(await this.group(file.steps.flat().map((i) => i.line)));
    root.rotation.y = dir || 0;
    root.updateMatrixWorld(true);
    return this.shot(root, w, h);
  }
  dispose() { this.renderer.dispose(); }
}

// Every piece of the model as its own object, in booklet order, for the piece-by-piece builder.
const ldMatrix = (m) => new THREE.Matrix4().set(m[3], m[4], m[5], m[0], m[6], m[7], m[8], m[1], m[9], m[10], m[11], m[2], 0, 0, 0, 1);
export async function buildPieces(loader, model) {
  const placed = new Map();
  const placementsOf = (f) => {
    if (f === model.main) return [{ m: new THREE.Matrix4(), c: 16 }];
    if (!placed.has(f.key)) {
      const res = [];
      for (const parent of model.order) for (const s of parent.steps) for (const it of s) if (it.sub && it.key === f.key)
        for (const p of placementsOf(parent)) res.push({ m: p.m.clone().multiply(ldMatrix(it.m)), c: it.color === 16 ? p.c : it.color });
      placed.set(f.key, res);
    }
    return placed.get(f.key);
  };
  const inst = [];
  for (const st of model.seq) for (const it of st.items) {
    if (it.sub) continue;
    for (const p of placementsOf(st.file)) inst.push({ ref: it.ref, c: it.color === 16 ? p.c : it.color, m: p.m.clone().multiply(ldMatrix(it.m)), step: st });
  }
  const protos = new Map();
  await Promise.all([...new Set(inst.map((i) => i.ref + '|' + i.c))].map(async (k) => {
    const [ref, c] = k.split('|');
    protos.set(k, await new Promise((res, rej) => loader.parse(`1 ${c} 0 0 0 1 0 0 0 1 0 0 0 1 ${ref}`, res, rej)));
  }));
  const root = new THREE.Group();
  root.rotation.x = Math.PI;
  const pieces = inst.map((i) => {
    const holder = new THREE.Group();
    const g = protos.get(i.ref + '|' + i.c).clone();
    g.matrixAutoUpdate = false;
    g.matrix.copy(i.m);
    holder.add(g);
    root.add(holder);
    return { holder, step: i.step };
  });
  root.updateMatrixWorld(true);
  return { root, pieces };
}
