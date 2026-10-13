// Printable outputs: instruction booklet and packaging, rendered as HTML pages for print-to-PDF.
import { callout, splitBags, partDescription } from './ldraw.js';
import { PAGE_SIZES } from './pages.js';

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function swatch(colors, c) { return colors.get(c)?.hex || '#ccc'; }

export async function buildBooklet({ project, model, snap, colors, onProgress = () => {} }) {
  const [w, h] = PAGE_SIZES[project.pageSize] || PAGE_SIZES['A5 landscape'];
  const px = (mm) => Math.round(mm * 6); // ~150 dpi
  const pages = [];
  const total = model.seq.length;
  const bags = splitBags(model.seq, Math.max(1, project.bags | 0));
  const bagStart = new Map(bags.map((b, i) => [b[0], i + 1]));
  const cover = project.concepts.find((c) => c.id === project.coverConcept)?.image;
  onProgress('Rendering cover', 0);
  const finalImg = await snap.full(model.main, px(w * 0.8), px(h * 0.62));

  pages.push(`<section class="pg cover">
    <div class="cv-band"><div class="cv-num">${esc(project.setNumber)}</div><div class="cv-age">${esc(project.ages)}</div></div>
    <h1>${esc(project.name)}</h1>
    ${project.recipient ? `<div class="cv-for">Built for ${esc(project.recipient)}</div>` : ''}
    <img class="cv-img" src="${cover || finalImg}">
    <div class="cv-foot"><span>${model.pieceCount} pieces</span><span>${total} steps</span></div>
  </section>`);

  for (const st of model.seq) {
    onProgress(`Rendering step ${st.n} of ${total}`, st.n / total);
    if (bagStart.has(st)) pages.push(`<section class="pg bag"><div class="bag-icon"><span>${bagStart.get(st)}</span></div><p>Open bag ${bagStart.get(st)}</p></section>`);
    const img = await snap.step(st.file, st.index, px(w * 0.78), px(h * 0.78), project.fade);
    const parts = await Promise.all(callout(st.items).map(async (c) => `<div class="co-part"><img src="${await snap.part(c.ref, c.color, c.sub ? 220 : 140)}"><b>${c.qty}x</b></div>`));
    const sub = st.file !== model.main;
    const firstOfSub = sub && st.index === 0;
    const lastOfSub = sub && st.index === st.file.steps.length - 1;
    pages.push(`<section class="pg step${sub ? ' sub' : ''}">
      <div class="st-head"><div class="st-num">${st.n}</div><div class="callout">${parts.join('')}</div></div>
      ${firstOfSub && st.mult > 1 ? `<div class="mult">Build ${st.mult}x</div>` : ''}
      ${lastOfSub && st.mult > 1 ? `<div class="mult end">${st.mult}x</div>` : ''}
      <img class="st-img" src="${img}">
      <div class="pg-no">${pages.length + 1}</div>
    </section>`);
  }

  onProgress('Rendering parts inventory', 1);
  const cells = await Promise.all(model.inventory.map(async (p) => `<div class="inv"><img src="${await snap.part(p.id + '.dat', p.color, 120)}"><b>${p.qty}x</b><small>${esc(p.id)}<i style="background:${swatch(colors, p.color)}"></i></small></div>`));
  const perPage = w > h ? 32 : 48;
  for (let i = 0; i < cells.length; i += perPage) pages.push(`<section class="pg inventory"><h2>Parts list</h2><div class="inv-grid">${cells.slice(i, i + perPage).join('')}</div><div class="pg-no">${pages.length + 1}</div></section>`);

  const back = await snap.full(model.main, px(w * 0.6), px(h * 0.6), Math.PI);
  pages.push(`<section class="pg backcover"><img src="${back}"><p>${esc(project.notes || 'A one-of-a-kind set, designed and packed by hand.')}</p><div class="cv-num">${esc(project.setNumber)}</div></section>`);
  return { html: pages.join('\n'), bags };
}

export async function buildPackaging({ project, model, snap, colors, bags }) {
  const cover = project.concepts.find((c) => c.id === project.coverConcept)?.image;
  const front = await snap.full(model.main, 1200, 900);
  const backA = await snap.full(model.main, 700, 520, Math.PI);
  const backB = await snap.full(model.main, 700, 520, Math.PI / 2);
  const out = [];
  out.push(`<section class="pg box-front">
    <div class="bx-top"><div class="cv-age">${esc(project.ages)}</div><div class="bx-num">${esc(project.setNumber)}</div><div class="bx-pcs">${model.pieceCount} pcs</div></div>
    <h1>${esc(project.name)}</h1>
    <img src="${cover || front}">
    ${project.recipient ? `<div class="bx-for">Made for ${esc(project.recipient)}</div>` : ''}
  </section>`);
  out.push(`<section class="pg box-back"><h2>${esc(project.name)}</h2><div class="bx-views"><img src="${cover ? front : backA}"><img src="${backB}"></div>
    <p>${esc(project.notes || '')}</p><div class="bx-meta">${model.pieceCount} pieces · ${model.seq.length} steps · ${esc(project.ages)}</div></section>`);
  // Bag labels: one per bag, listing its parts so packing is easy.
  const labels = await Promise.all(bags.map(async (b, i) => {
    const items = new Map();
    // Submodel placements are skipped: their parts are counted in the submodel's own steps.
    for (const st of b) for (const it of st.items) if (!it.sub) {
      const k = it.key + '|' + it.color;
      items.set(k, { ref: it.ref, color: it.color, qty: (items.get(k)?.qty || 0) + st.mult });
    }
    const list = [...items.values()];
    const rows = await Promise.all(list.map(async (p) => `<span><img src="${await snap.part(p.ref, p.color, 90)}">${p.qty}x</span>`));
    return `<div class="label"><div class="bag-icon sm"><span>${i + 1}</span></div><div><b>${esc(project.name)}</b> · bag ${i + 1} · ${list.reduce((a, p) => a + p.qty, 0)} pcs<div class="lbl-parts">${rows.join('')}</div></div></div>`;
  }));
  out.push(`<section class="pg labels"><h2>Bag labels</h2>${labels.join('')}</section>`);
  return out.join('\n');
}

export async function describeAll(inventory) {
  await Promise.all(inventory.map(async (p) => { p.desc = await partDescription(p.id); }));
  return inventory;
}
