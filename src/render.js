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
    const tick = () => { if (!this.el.isConnected) return; this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(tick); };
    tick();
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
