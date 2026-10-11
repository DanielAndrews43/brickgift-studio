// Projects persist in this browser's IndexedDB.
import { get, set, del, keys } from 'idb-keyval';

const P = 'project:';
export const uid = () => Math.random().toString(36).slice(2, 10);

export function newProject(name = 'Untitled set') {
  return {
    id: uid(), name, recipient: '', occasion: '', notes: '', ages: '8+', setNumber: String(Math.floor(10000 + Math.random() * 89999)),
    pieces: 150, concepts: [], coverConcept: null, ldraw: '', ldrawName: '', bags: 2, fade: false, pageSize: 'A5 landscape',
    blOverrides: {}, spares: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
}
export async function listProjects() {
  const ks = (await keys()).filter((k) => String(k).startsWith(P));
  const ps = await Promise.all(ks.map((k) => get(k)));
  return ps.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}
export const loadProject = (id) => get(P + id);
export const saveProject = (p) => { p.updatedAt = Date.now(); return set(P + p.id, p); };
export const deleteProject = (id) => del(P + id);

export const getSetting = (k) => { try { return localStorage.getItem('bg:' + k) || ''; } catch { return ''; } };
export const setSetting = (k, v) => { try { localStorage.setItem('bg:' + k, v); } catch {} };
