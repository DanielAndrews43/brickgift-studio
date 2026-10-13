import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { parseLDraw, callout, splitBags, modelText, partId } from '../src/ldraw.js';

const paddock = fs.readFileSync(new URL('../public/samples/riding-paddock.mpd', import.meta.url), 'utf8');
const giftBox = fs.readFileSync(new URL('../public/samples/gift-box.mpd', import.meta.url), 'utf8');
const slide = fs.readFileSync(new URL('../public/samples/playground-slide.mpd', import.meta.url), 'utf8');

describe('parseLDraw', () => {
  it('reads a single-file .ldr with steps', () => {
    const m = parseLDraw('0 Tiny\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n0 STEP\n1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat\n0 STEP\n');
    expect(m.order).toHaveLength(1);
    expect(m.seq).toHaveLength(2);
    expect(m.pieceCount).toBe(2);
    expect(m.inventory).toEqual([{ id: '3001', color: 4, qty: 2 }]);
  });

  it('handles CRLF line endings and backslash paths', () => {
    const m = parseLDraw('0 Win\r\n1 15 0 0 0 1 0 0 0 1 0 0 0 1 S\\3001s01.dat\r\n');
    expect(m.inventory[0].id).toBe('s/3001s01');
  });

  it('flattens submodels with colour inheritance and multipliers', () => {
    const text = [
      '0 FILE main.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 wheel.ldr', '1 1 40 0 0 1 0 0 0 1 0 0 0 1 wheel.ldr', '0 NOFILE',
      '0 FILE wheel.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3023.dat', '1 0 0 -8 0 1 0 0 0 1 0 0 0 1 3024.dat', '0 NOFILE',
    ].join('\n');
    const m = parseLDraw(text);
    expect(m.pieceCount).toBe(4);
    const by = Object.fromEntries(m.inventory.map((p) => [p.id + '|' + p.color, p.qty]));
    expect(by).toEqual({ '3023|4': 1, '3023|1': 1, '3024|0': 2 });
    // submodel steps come before the parent step that uses it, built twice
    expect(m.seq[0].file.name).toBe('wheel.ldr');
    expect(m.seq[0].mult).toBe(2);
  });

  it('parses the bundled samples', () => {
    const p = parseLDraw(paddock);
    expect(p.main.title).toBe("Tess's Riding Paddock");
    expect(p.pieceCount).toBe(71);
    expect(p.seq).toHaveLength(17);
    const g = parseLDraw(giftBox);
    expect(g.pieceCount).toBe(50);
    const s = parseLDraw(slide);
    expect(s.main.title).toBe('Playground Slide');
    expect(s.pieceCount).toBe(134);
    expect(s.seq).toHaveLength(23);
  });

  it('rejects empty input', () => {
    expect(() => parseLDraw('   \n')).toThrow();
  });
});

describe('helpers', () => {
  it('normalises part ids', () => {
    expect(partId('PARTS\\3001.DAT')).toBe('3001');
  });
  it('groups callouts by part and colour', () => {
    const m = parseLDraw(paddock);
    const c = callout(m.seq.find((s) => s.items.length > 3).items);
    expect(c.reduce((a, e) => a + e.qty, 0)).toBeGreaterThan(3);
  });
  it('splits bags covering every step once', () => {
    const m = parseLDraw(paddock);
    for (const n of [1, 2, 3, 5]) {
      const bags = splitBags(m.seq, n);
      expect(bags.length).toBeLessThanOrEqual(n);
      expect(bags.flat()).toEqual(m.seq);
    }
  });
  it('builds step model text that keeps submodels', () => {
    const m = parseLDraw(paddock);
    const t = modelText(m, ['1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat'], 7);
    expect(t).toContain('0 FILE __step7.ldr');
    expect(t).toContain('0 FILE horse.ldr');
    expect(parseLDraw(t).order.length).toBe(m.order.length);
  });
});
