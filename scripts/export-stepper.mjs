// Usage: node scripts/export-stepper.mjs model.mpd out.json  (per-piece geometry for the 3D build stepper)
// Export a model as per-piece geometry (build order) for the stepper viewer.
globalThis.ProgressEvent = class extends Event { constructor(t, o = {}) { super(t); Object.assign(this, o); } };
import * as THREE from 'three';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import fs from 'fs';
import { parseLDraw, PARTS_PATH, COLORS_URL } from '../src/ldraw.js';

const [src, out] = process.argv.slice(2);
const model = parseLDraw(fs.readFileSync(src, 'utf8'));
const L = new LDrawLoader(); L.setPartsLibraryPath(PARTS_PATH);
const colText = await (await fetch(COLORS_URL)).text();
fs.writeFileSync('/tmp/claude-0/s/colors.ldr', colText);
await L.preloadMaterials(COLORS_URL);
const mat = (m) => new THREE.Matrix4().set(m[3], m[4], m[5], m[0], m[6], m[7], m[8], m[1], m[9], m[10], m[11], m[2], 0, 0, 0, 1);
const colors = new Map();
for (const line of colText.split(/\r?\n/)) {
  const m = line.match(/CODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})\s+EDGE\s+(#[0-9A-Fa-f]{6}|\d+)(.*)$/);
  if (m) colors.set(+m[1], { hex: m[2], edge: m[3].startsWith('#') ? m[3] : '#333333', alpha: (m[4].match(/ALPHA\s+(\d+)/) || [])[1] });
}

// Instances in booklet order, each with its world matrix.
const inst = [];
const placements = new Map(); // submodel key -> list of {matrix, color}
function placementsOf(f) {
  if (f === model.main) return [{ m: new THREE.Matrix4(), c: 16 }];
  if (placements.has(f.key)) return placements.get(f.key);
  const res = [];
  for (const parent of model.order) for (const s of parent.steps) for (const it of s) if (it.sub && it.key === f.key)
    for (const p of placementsOf(parent)) res.push({ m: p.m.clone().multiply(mat(it.m)), c: it.color === 16 ? p.c : it.color });
  placements.set(f.key, res);
  return res;
}
for (const st of model.seq) for (const it of st.items) {
  if (it.sub) continue;
  for (const p of placementsOf(st.file)) {
    const c = it.color === 16 ? p.c : it.color;
    inst.push({ ref: it.ref, c, m: p.m.clone().multiply(mat(it.m)), step: st.n });
  }
}

// One geometry bundle per part+colour.
const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
const parts = {};
for (const i of inst) {
  const k = i.ref.toLowerCase() + '|' + i.c;
  if (parts[k]) continue;
  const g = await new Promise((res, rej) => L.parse(`1 ${i.c} 0 0 0 1 0 0 0 1 0 0 0 1 ${i.ref}`, res, rej));
  g.updateMatrixWorld(true);
  const byColor = new Map(); const lines = [];
  g.traverse((o) => {
    if (o.isMesh) {
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      geo.computeVertexNormals?.();
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
      for (const gr of groups) {
        const mm = ms[gr.materialIndex] || ms[0];
        const code = mm.userData?.code ?? i.c;
        const cc = colors.get(+code) || colors.get(i.c) || { hex: '#' + mm.color.getHexString() };
        const key = cc.hex + (cc.alpha ? '|t' : '');
        const e = byColor.get(key) || { hex: cc.hex, t: !!cc.alpha, p: [], n: [] };
        const v = new THREE.Vector3();
        for (let j = gr.start, end = Math.min(gr.start + gr.count, pos.count); j < end; j++) {
          v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld); e.p.push(v.x, v.y, v.z);
          if (nor) { v.fromBufferAttribute(nor, j).applyMatrix3(nm).normalize(); e.n.push(v.x, v.y, v.z); }
        }
        byColor.set(key, e);
      }
    } else if (o.isLineSegments && !o.isConditionalLine && !(o.material && o.material.isLDrawConditionalLineMaterial)) {
      const pos = o.geometry.attributes.position; const v = new THREE.Vector3();
      for (let j = 0; j < pos.count; j++) { v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld); lines.push(v.x, v.y, v.z); }
    }
  });
  parts[k] = {
    meshes: [...byColor.values()].map((e) => ({ c: e.hex, t: e.t, p: b64(new Float32Array(e.p)), n: b64(new Int8Array(e.n.map((x) => Math.round(x * 127)))) })),
    lines: b64(new Float32Array(lines)),
    edge: (colors.get(i.c) || {}).edge || '#333333',
  };
}
const steps = model.seq.map((s) => ({ n: s.n, sub: s.file !== model.main, title: s.file.title, mult: s.mult }));
const data = { title: model.main.title, parts, inst: inst.map((i) => ({ k: i.ref.toLowerCase() + '|' + i.c, m: i.m.elements.map((x) => +x.toFixed(4)), s: i.step })), steps };
fs.writeFileSync(out, JSON.stringify(data));
console.log('pieces', inst.length, 'parts', Object.keys(parts).length, 'bytes', fs.statSync(out).size);
