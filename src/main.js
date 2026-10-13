import { listProjects, loadProject, saveProject, deleteProject, newProject, uid, getSetting, setSetting } from './store.js';
import { parseLDraw, loadColors, partDescription, splitBags } from './ldraw.js';
import { makeLoader, Viewer, Snapshotter, buildPieces } from './render.js';
import { STYLES, buildPrompt, generate, refine } from './imagegen.js';
import { wantedRows, wantedXML, partsCSV, blLink, BL_COLOR } from './bricklink.js';
import { PAGE_SIZES, pageCSS } from './pages.js';
const printing = () => import('./print.js');

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const S = { project: null, model: null, loader: null, snap: null, colors: new Map(), viewer: null, bags: null };

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
window.addEventListener('error', (e) => toast('Something went wrong: ' + (e.message || 'unknown error'), 5000));
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message !== 'no key') toast('Something went wrong: ' + (e.reason?.message || e.reason), 5000); });
let saveT;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => saveProject(S.project).then(refreshPicker), 300); };
const download = (name, text, type = 'text/plain') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const slug = (s) => (s || 'set').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- projects ----------
async function refreshPicker() {
  const ps = await listProjects();
  $('#proj-select').innerHTML = ps.map((p) => `<option value="${p.id}" ${p.id === S.project?.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}
async function openProject(p) {
  S.project = p;
  S.bags = null;
  setSetting('last', p.id);
  bindFields();
  renderConcepts();
  $('#book').innerHTML = ''; $('#pack').innerHTML = '';
  $('#print-book').disabled = $('#print-pack').disabled = true;
  await loadModel(p.ldraw, p.ldrawName, false);
  await refreshPicker();
}
$('#proj-select').onchange = async (e) => openProject(await loadProject(e.target.value));
$('#proj-new').onclick = async () => { const p = newProject(); await saveProject(p); openProject(p); };
$('#proj-del').onclick = async () => {
  if (!confirm(`Delete "${S.project.name}" and its concepts? This cannot be undone.`)) return;
  await deleteProject(S.project.id);
  const ps = await listProjects();
  openProject(ps[0] || (await (async () => { const p = newProject(); await saveProject(p); return p; })()));
};

$('#proj-export').onclick = () => download(slug(S.project.name) + '.brickgift.json', JSON.stringify({ brickgift: 1, project: S.project }), 'application/json');
$('#proj-import').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const p = data.project;
    if (data.brickgift !== 1 || !p?.id || !Array.isArray(p.concepts)) throw new Error('not a BrickGift backup');
    const exists = (await listProjects()).some((x) => x.id === p.id);
    if (exists && !confirm(`Replace your current copy of "${p.name}" with this backup?`)) return;
    await saveProject(p);
    openProject(p);
    toast(`Restored "${p.name}"`);
  } catch (err) { toast('Could not restore: ' + err.message, 5000); }
};

// ---------- tabs ----------
$('#tabs').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'model') S.viewer?.resize();
  if (b.dataset.tab === 'buy') renderParts();
};

// ---------- fields ----------
const FIELDS = { '#f-name': 'name', '#f-recipient': 'recipient', '#f-occasion': 'occasion', '#f-idea': 'idea', '#f-pieces': 'pieces', '#f-notes': 'notes', '#f-bags': 'bags', '#f-setno': 'setNumber', '#f-ages': 'ages', '#f-page': 'pageSize', '#f-packpage': 'packPageSize', '#f-style': 'style' };
$('#f-style').innerHTML = Object.keys(STYLES).map((s) => `<option>${s}</option>`).join('');
$('#f-page').innerHTML = $('#f-packpage').innerHTML = Object.keys(PAGE_SIZES).map((s) => `<option>${s}</option>`).join('');
function bindFields() {
  const p = S.project;
  p.packPageSize ||= 'A4 landscape';
  p.style ||= Object.keys(STYLES)[0];
  for (const [sel, k] of Object.entries(FIELDS)) $(sel).value = p[k] ?? '';
  $('#f-fade').checked = !!p.fade;
  $('#f-spares').checked = p.spares !== false;
}
for (const [sel, k] of Object.entries(FIELDS)) $(sel).addEventListener('input', (e) => {
  S.project[k] = e.target.type === 'number' ? +e.target.value : e.target.value; save();
  if (k === 'bags') S.bags = null;
});
$('#f-fade').onchange = (e) => { S.project.fade = e.target.checked; save(); };
$('#f-spares').onchange = (e) => { S.project.spares = e.target.checked; save(); renderParts(); };
$('#f-key').value = getSetting('openai');
$('#f-key').oninput = (e) => setSetting('openai', e.target.value.trim());
$('#f-imgmodel').value = getSetting('imgmodel') || 'gpt-image-1';
$('#f-imgmodel').oninput = (e) => setSetting('imgmodel', e.target.value.trim());
$('#f-quality').value = getSetting('quality') || 'medium';
$('#f-quality').onchange = (e) => setSetting('quality', e.target.value);

// ---------- ideas ----------
function imgOpts() {
  const key = $('#f-key').value.trim();
  if (!key) { toast('Add your OpenAI API key first, or use Copy image prompt instead'); $('#f-key').focus(); throw new Error('no key'); }
  return { key, model: $('#f-imgmodel').value.trim() || 'gpt-image-1', quality: $('#f-quality').value };
}
async function runGen(label, fn) {
  const st = $('#gen-status');
  st.textContent = label; document.body.classList.add('busy');
  try {
    const imgs = await fn();
    return imgs;
  } catch (e) { if (e.message !== 'no key') { st.textContent = 'Error: ' + e.message; } throw e; }
  finally { document.body.classList.remove('busy'); }
}
$('#gen').onclick = async () => {
  const p = S.project;
  if (!p.idea?.trim()) return toast('Describe the idea first');
  const prompt = buildPrompt(p.style, p.idea, p.pieces);
  const opts = imgOpts();
  const imgs = await runGen('Generating concepts…', () => generate({ ...opts, prompt, n: +$('#f-n').value }));
  p.concepts.unshift(...imgs.map((image) => ({ id: uid(), image, prompt, idea: p.idea, at: Date.now() })));
  $('#gen-status').textContent = '';
  save(); renderConcepts();
};
function renderConcepts() {
  const p = S.project;
  $('#concepts').innerHTML = p.concepts.length ? p.concepts.map((c) => `
    <figure class="concept ${c.id === p.coverConcept ? 'cover' : ''}" data-id="${c.id}">
      <img src="${c.image}" alt="">
      <figcaption>${esc(c.refine || c.idea)}</figcaption>
      <div class="actions">
        <button data-act="cover" class="ghost">${c.id === p.coverConcept ? '★ Cover' : '☆ Use as cover'}</button>
        <button data-act="refine" class="ghost">Refine</button>
        <button data-act="dl" class="ghost">Download</button>
        <button data-act="del" class="ghost danger">Remove</button>
      </div>
    </figure>`).join('') : '<p class="hint center">Your concept images appear here.</p>';
}
$('#concepts').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const p = S.project;
  const c = p.concepts.find((x) => x.id === b.closest('figure').dataset.id);
  if (b.dataset.act === 'cover') { p.coverConcept = p.coverConcept === c.id ? null : c.id; }
  if (b.dataset.act === 'del') { p.concepts = p.concepts.filter((x) => x !== c); if (p.coverConcept === c.id) p.coverConcept = null; }
  if (b.dataset.act === 'dl') { const a = document.createElement('a'); a.href = c.image; a.download = slug(p.name) + '-concept.png'; a.click(); return; }
  if (b.dataset.act === 'refine') {
    const ask = prompt('What should change?', 'Make it more colourful and add a small tree');
    if (!ask) return;
    const full = `Keep this custom LEGO set design but: ${ask}. Keep it realistic and buildable from real LEGO bricks.`;
    if (!$('#f-key').value.trim()) {
      copyText(full, 'Refine prompt copied. Paste it into your image tool along with this image, then bring the new one back.');
      return;
    }
    const opts = imgOpts();
    const imgs = await runGen('Refining concept…', () => refine({ ...opts, prompt: full, image: c.image, n: 2 }));
    p.concepts.unshift(...imgs.map((image) => ({ id: uid(), image, prompt: full, idea: c.idea, refine: ask, at: Date.now() })));
    $('#gen-status').textContent = '';
  }
  save(); renderConcepts();
};
// Bring-your-own concept images: copy a prompt, generate anywhere, paste or upload the result.
async function copyText(text, ok) {
  try { await navigator.clipboard.writeText(text); toast(ok); } catch { prompt('Copy this:', text); }
}
$('#copy-prompt').onclick = () => {
  const p = S.project;
  if (!p.idea?.trim()) { toast('Describe the idea first'); $('#f-idea').focus(); return; }
  copyText(buildPrompt(p.style, p.idea, p.pieces), 'Prompt copied. Paste it into your image tool.');
};
function shrink(file, max = 1600) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => rej(new Error('That file is not an image this browser can read'));
    img.src = URL.createObjectURL(file);
  });
}
async function addImages(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length || !S.project) return;
  const p = S.project;
  for (const f of imgs) {
    try { p.concepts.unshift({ id: uid(), image: await shrink(f), prompt: buildPrompt(p.style, p.idea || '', p.pieces), idea: p.idea || f.name, at: Date.now(), source: 'upload' }); }
    catch (e) { toast(e.message, 4000); }
  }
  p.coverConcept ||= p.concepts[0]?.id || null;
  save(); renderConcepts();
  toast(imgs.length === 1 ? 'Concept added' : `${imgs.length} concepts added`);
}
$('#f-img').onchange = (e) => { addImages(e.target.files); e.target.value = ''; };
document.addEventListener('paste', (e) => {
  if ($('#tab-idea').hidden) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addImages(files); }
});
const dz = $('#dropzone');
for (const t of ['dragenter', 'dragover']) dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); });
for (const t of ['dragleave', 'drop']) dz.addEventListener(t, () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => { e.preventDefault(); addImages(e.dataTransfer.files); });

$('#brief').onclick = async () => {
  const p = S.project;
  const cover = p.concepts.find((c) => c.id === p.coverConcept);
  const text = [`Design brief: ${p.name}`, p.recipient && `For: ${p.recipient}${p.occasion ? ' (' + p.occasion + ')' : ''}`,
    `Idea: ${p.idea || '(none yet)'}`, `Target size: about ${p.pieces || 150} pieces, ${p.bags || 2} bags`,
    cover ? `Chosen concept: ${cover.refine || cover.idea} (image attached separately)` : 'No concept chosen yet',
    'Please design it as an LDraw .mpd with 0 STEP lines, common in-production parts, and colours available on BrickLink.'].filter(Boolean).join('\n');
  copyText(text, 'Brief copied. Paste it in the project thread.');
};

// ---------- model ----------
async function loadModel(text, name, persist = true) {
  S.model = null; S.snap?.dispose(); S.snap = null; S.bags = null;
  $('#f-ldraw').value = text || '';
  if (!text?.trim()) { $('#model-stats').innerHTML = ''; $('#model-warn').innerHTML = ''; return; }
  try {
    S.model = parseLDraw(text, name || 'model.ldr');
  } catch (e) { $('#model-warn').innerHTML = `<p class="warn">${esc(e.message)}</p>`; return; }
  if (persist) { S.project.ldraw = text; S.project.ldrawName = name; if (S.project.name === 'Untitled set') { S.project.name = S.model.main.title; $('#f-name').value = S.project.name; } save(); }
  const m = S.model;
  $('#model-stats').innerHTML = `<div><b>${m.pieceCount}</b>pieces</div><div><b>${m.inventory.length}</b>part lots</div><div><b>${m.seq.length}</b>steps</div><div><b>${m.order.length - 1}</b>submodels</div>`;
  $('#model-warn').innerHTML = '<p class="hint">Checking parts against the LDraw library…</p>';
  S.loader = await makeLoader();
  S.snap = new Snapshotter(S.loader, m);
  S.viewer ||= new Viewer($('#viewer'));
  const msg = $('#viewer-msg');
  if (msg) { msg.hidden = false; msg.textContent = 'Loading 3D parts…'; }
  $('#builder').hidden = true;
  buildPieces(S.loader, m).then(({ root, pieces }) => {
    if (S.model !== m) return;
    S.pieces = pieces;
    S.viewer.show(root);
    $('#b-slider').max = pieces.length;
    setBuilt(pieces.length);
    $('#builder').hidden = false;
    if (msg) msg.hidden = true;
  }).catch((e) => { if (msg) msg.textContent = 'Could not draw the model: ' + e.message; });
  const descs = await Promise.all(m.inventory.map(async (p) => (p.desc = await partDescription(p.id))));
  const missing = m.inventory.filter((p, i) => !descs[i]);
  const noColor = m.inventory.filter((p) => BL_COLOR[p.color] === undefined);
  $('#model-warn').innerHTML = (missing.length ? `<p class="warn">Unknown parts: ${missing.map((p) => esc(p.id)).join(', ')}</p>` : '') +
    (noColor.length ? `<p class="warn">Colours with no BrickLink match: ${[...new Set(noColor.map((p) => p.color))].join(', ')}</p>` : '') +
    (!missing.length && !noColor.length ? '<p class="ok">All parts and colours check out.</p>' : '');
  if (!$('#tab-buy').hidden) renderParts();
}
// ---------- piece-by-piece builder ----------
let built = 0, playT = null;
function setBuilt(n, animate = false) {
  const ps = S.pieces || [];
  n = Math.max(0, Math.min(ps.length, n));
  S.viewer.setShown(ps, n, animate && n === built + 1);
  built = n;
  $('#b-slider').value = n;
  const st = n ? ps[n - 1].step : null;
  $('#b-count').textContent = `${n} of ${ps.length} pieces` + (st ? ` · step ${st.n}` + (st.file !== S.model.main ? ` (${st.file.title})` : '') : '');
}
function stopPlay() { clearInterval(playT); playT = null; $('#b-play').textContent = '▶ Play'; }
$('#b-slider').oninput = (e) => setBuilt(+e.target.value, true);
$('#b-fwd').onclick = () => setBuilt(built + 1, true);
$('#b-back').onclick = () => setBuilt(built - 1);
$('#b-play').onclick = () => {
  if (playT) return stopPlay();
  if (built >= S.pieces.length) setBuilt(0);
  $('#b-play').textContent = '❚❚ Pause';
  playT = setInterval(() => (built >= S.pieces.length ? stopPlay() : setBuilt(built + 1, true)), 450);
};

$('#f-file').onchange = async (e) => { const f = e.target.files[0]; if (f) loadModel(await f.text(), f.name); };
$('#apply-ldraw').onclick = () => loadModel($('#f-ldraw').value, S.project.ldrawName || 'model.ldr');
$('#sample').onchange = async (e) => {
  const f = e.target.value; e.target.value = '';
  if (f) loadModel(await (await fetch(import.meta.env.BASE_URL + 'samples/' + f)).text(), f);
};

// ---------- booklet & packaging ----------
function needModel() { if (!S.model || !S.snap) { toast('Load a model on the Model tab first'); return false; } return true; }
function setPageCSS(size) { $('#page-css').textContent = pageCSS(size); }
$('#gen-book').onclick = async () => {
  if (!needModel()) return;
  const btn = $('#gen-book'); btn.disabled = true;
  setPageCSS(S.project.pageSize);
  try {
    const { buildBooklet } = await printing();
    const { html, bags } = await buildBooklet({ project: S.project, model: S.model, snap: S.snap, colors: S.colors, onProgress: (m) => ($('#book-status').textContent = m + '…') });
    S.bags = bags;
    $('#book').innerHTML = html;
    $('#book-status').textContent = `${$('#book').children.length} pages`;
    $('#print-book').disabled = false;
  } catch (e) { $('#book-status').textContent = 'Error: ' + e.message; console.error(e); }
  btn.disabled = false;
};
$('#gen-pack').onclick = async () => {
  if (!needModel()) return;
  const btn = $('#gen-pack'); btn.disabled = true;
  $('#pack-status').textContent = 'Rendering…';
  try {
    S.bags ||= splitBags(S.model.seq, Math.max(1, S.project.bags | 0));
    const { buildPackaging } = await printing();
    $('#pack').innerHTML = await buildPackaging({ project: S.project, model: S.model, snap: S.snap, colors: S.colors, bags: S.bags });
    $('#pack-status').textContent = '';
    $('#print-pack').disabled = false;
  } catch (e) { $('#pack-status').textContent = 'Error: ' + e.message; console.error(e); }
  btn.disabled = false;
};
function printOnly(id, size) {
  setPageCSS(size);
  document.body.dataset.print = id;
  const title = document.title; document.title = `${S.project.name} - ${id === 'book' ? 'instructions' : 'packaging'}`;
  window.print();
  document.title = title; delete document.body.dataset.print;
}
$('#print-book').onclick = () => printOnly('book', S.project.pageSize);
$('#print-pack').onclick = () => printOnly('pack', S.project.packPageSize);
$('#f-page').addEventListener('change', () => setPageCSS(S.project.pageSize));

// ---------- buy ----------
let partImgs = new Map();
async function renderParts() {
  const body = $('#parts-body');
  if (!S.model) { body.innerHTML = '<tr><td colspan="7" class="hint center">Load a model first.</td></tr>'; $('#buy-sum').textContent = ''; return; }
  const rows = wantedRows(S.model.inventory, S.project.blOverrides, S.project.spares !== false);
  const lots = rows.length, pcs = rows.reduce((a, r) => a + r.buyQty, 0);
  $('#buy-sum').innerHTML = `<b>${lots}</b> lots · <b>${pcs}</b> pieces to buy`;
  body.innerHTML = rows.map((r) => {
    const c = S.colors.get(r.color);
    const bad = r.blColor === undefined || r.desc === null;
    const k = r.id + '|' + r.color;
    return `<tr class="${bad ? 'bad' : ''}"><td><img class="pimg" data-k="${k}" src="${partImgs.get(k) || ''}" alt=""></td>
      <td><b>${esc(r.id)}</b><br><small>${esc(r.desc || 'Unknown part')}</small></td>
      <td><i class="sw" style="background:${c?.hex || '#ccc'}"></i>${esc(c?.name || r.color)}</td>
      <td>${r.qty}</td><td>${r.buyQty}</td>
      <td><input class="blid" data-id="${esc(r.id)}" value="${esc(r.blId)}" size="9">${r.blColor === undefined ? '<br><small>no colour match</small>' : ''}</td>
      <td><a href="${blLink(r)}" target="_blank" rel="noopener">BrickLink ↗</a></td></tr>`;
  }).join('');
  for (const img of body.querySelectorAll('img.pimg')) if (!img.getAttribute('src')) {
    const [id, color] = img.dataset.k.split('|');
    S.snap?.part(id + '.dat', +color, 96).then((u) => { partImgs.set(img.dataset.k, u); img.src = u; });
  }
}
$('#parts-body').addEventListener('change', (e) => {
  if (!e.target.matches('.blid')) return;
  S.project.blOverrides[e.target.dataset.id] = e.target.value.trim(); save(); renderParts();
});
const xml = () => wantedXML(wantedRows(S.model.inventory, S.project.blOverrides, S.project.spares !== false), S.project.name);
$('#dl-xml').onclick = () => needModel() && download(slug(S.project.name) + '-bricklink.xml', xml(), 'application/xml');
$('#copy-xml').onclick = () => needModel() && navigator.clipboard.writeText(xml()).then(() => toast('XML copied. Paste it on BrickLink’s upload page.'));
$('#dl-csv').onclick = () => needModel() && download(slug(S.project.name) + '-parts.csv', partsCSV(wantedRows(S.model.inventory, S.project.blOverrides, S.project.spares !== false), S.colors), 'text/csv');

// ---------- boot ----------
(async () => {
  // Colours only matter for the parts table; don't hold up opening the project for them.
  loadColors().then((c) => { S.colors = c; if (!$('#tab-buy').hidden) renderParts(); })
    .catch(() => toast('Could not reach the LDraw parts library. Check your internet connection.', 6000));
  const ps = await listProjects();
  let p = ps.find((x) => x.id === getSetting('last')) || ps[0];
  if (!p) { p = newProject(); await saveProject(p); }
  openProject(p);
})();
