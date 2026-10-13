// LDraw (.ldr / .mpd) parsing: files, steps, build sequence, inventory.

export const LIB = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/';
export const PARTS_PATH = LIB + 'complete/ldraw/';
export const COLORS_URL = LIB + 'colors/ldcfgalt.ldr';

export const norm = (s) => s.trim().replace(/\\/g, '/').toLowerCase();
export const partId = (ref) => norm(ref).replace(/^parts\//, '').replace(/\.dat$/, '');

export function parseLDraw(text, mainName = 'model.ldr') {
  const lines = text.replace(/\r/g, '').split('\n');
  const files = new Map();
  const order = [];
  let cur = null;
  const add = (name) => {
    cur = { name, key: norm(name), lines: [] };
    if (!files.has(cur.key)) { files.set(cur.key, cur); order.push(cur); }
  };
  if (!lines.some((l) => /^\s*0\s+FILE\s+/i.test(l))) add(mainName);
  for (const raw of lines) {
    const l = raw.trim();
    const m = l.match(/^0\s+FILE\s+(.+)$/i);
    if (m) { add(m[1]); continue; }
    if (/^0\s+NOFILE\b/i.test(l)) { cur = null; continue; }
    if (cur && l) cur.lines.push(l);
  }
  if (!order.length) throw new Error('No LDraw content found');

  for (const f of order) {
    f.title = (f.lines.find((l) => /^0\s+(?!FILE|Name:|Author:|!|BFC|STEP)/i.test(l)) || '').replace(/^0\s+/, '') || f.name;
    const steps = [[]];
    for (const l of f.lines) {
      if (/^0\s+(STEP|ROTSTEP)\b/i.test(l)) { steps.push([]); continue; }
      const t = l.split(/\s+/);
      if (t[0] !== '1' || t.length < 15) continue;
      const ref = t.slice(14).join(' ');
      steps[steps.length - 1].push({ line: l, color: +t[1], ref, key: norm(ref), m: t.slice(2, 14).map(Number) });
    }
    f.steps = steps.filter((s) => s.length);
  }
  for (const f of order) for (const s of f.steps) for (const it of s) it.sub = files.has(it.key);

  const main = order[0];
  if (!main.steps.length) throw new Error('No parts found. Check that this is an LDraw .ldr or .mpd file.');
  return { files, order, main, text, ...analyze(files, main) };
}

function analyze(files, main) {
  // Inventory, flattened with color inheritance (16 = parent color).
  const inv = new Map();
  const uses = new Map();
  const flatten = (f, color, mult, depth) => {
    if (depth > 30) throw new Error('Submodel recursion too deep');
    for (const s of f.steps) for (const it of s) {
      const c = it.color === 16 ? color : it.color;
      if (it.sub) {
        uses.set(it.key, (uses.get(it.key) || 0) + mult);
        flatten(files.get(it.key), c, mult, depth + 1);
      } else {
        const id = partId(it.ref);
        const k = id + '|' + c;
        const e = inv.get(k) || { id, color: c, qty: 0 };
        e.qty += mult;
        inv.set(k, e);
      }
    }
  };
  flatten(main, 16, 1, 0);

  // Build sequence: submodel steps come before the parent step that first uses them.
  const seq = [];
  const done = new Set();
  const walk = (f) => {
    done.add(f.key);
    f.steps.forEach((s, i) => {
      for (const it of s) if (it.sub && !done.has(it.key)) walk(files.get(it.key));
      seq.push({ file: f, index: i, items: s, mult: f === main ? 1 : (uses.get(f.key) || 1) });
    });
  };
  walk(main);
  seq.forEach((st, i) => { st.n = i + 1; st.pieces = countPieces(files, st.items) * st.mult; });

  const inventory = [...inv.values()].sort((a, b) => a.color - b.color || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { inventory, seq, uses, pieceCount: inventory.reduce((a, b) => a + b.qty, 0) };
}

function countPieces(files, items) {
  let n = 0;
  for (const it of items) n += it.sub ? files.get(it.key).steps.reduce((a, s) => a + countPieces(files, s), 0) : 1;
  return n;
}

// Group the items added in a step into callout entries {ref, color, qty, sub}.
export function callout(items) {
  const g = new Map();
  for (const it of items) {
    const k = it.key + '|' + it.color;
    const e = g.get(k) || { ref: it.ref, key: it.key, color: it.color, qty: 0, sub: it.sub };
    e.qty++;
    g.set(k, e);
  }
  return [...g.values()];
}

// Split the build sequence into bags of roughly equal piece counts, preferring submodel boundaries.
export function splitBags(seq, nBags) {
  const total = seq.reduce((a, s) => a + s.pieces, 0);
  const target = total / Math.max(1, nBags);
  const bags = [];
  let cur = [];
  let acc = 0;
  seq.forEach((s, i) => {
    cur.push(s);
    acc += s.pieces;
    const next = seq[i + 1];
    const boundary = !next || next.file !== s.file;
    if (bags.length < nBags - 1 && acc >= target * (bags.length + 1) * (boundary ? 0.85 : 1.15)) {
      bags.push(cur); cur = [];
    }
  });
  if (cur.length) bags.push(cur);
  return bags;
}

// Text of a model containing only `lines` as the main file, plus every submodel definition.
export function modelText(model, lines, tag = '') {
  let out = '0 FILE __step' + tag + '.ldr\n' + lines.join('\n') + '\n0 NOFILE\n';
  for (const f of model.order) {
    if (f === model.main) continue;
    out += '0 FILE ' + f.name + '\n' + f.lines.join('\n') + '\n0 NOFILE\n';
  }
  return out;
}

export async function loadColors() {
  const text = await (await fetch(COLORS_URL)).text();
  const colors = new Map();
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})\s+EDGE\s+(#[0-9A-Fa-f]{6}|\d+)(.*)$/);
    if (m) colors.set(+m[2], { code: +m[2], name: m[1].replace(/_/g, ' '), hex: m[3], edge: m[4], alpha: /ALPHA/.test(m[5]) });
  }
  return colors;
}

const descCache = new Map();
export async function partDescription(id) {
  if (descCache.has(id)) return descCache.get(id);
  const p = fetch(PARTS_PATH + 'parts/' + id + '.dat')
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('missing'))))
    .then((t) => t.split(/\r?\n/)[0].replace(/^0\s+/, '').replace(/\s+/g, ' ').trim())
    .then((d) => {
      // Renamed parts point at their new number; show that part's description.
      const mv = d.match(/^~Moved to (\S+)/i);
      return mv && mv[1].toLowerCase() !== id ? partDescription(mv[1].toLowerCase()) : d;
    })
    .catch(() => null);
  descCache.set(id, p);
  return p;
}
