import { describe, it, expect } from 'vitest';
import { wantedRows, wantedXML, partsCSV, blPart, BL_COLOR } from '../src/bricklink.js';

const inv = [{ id: '3001', color: 4, qty: 2 }, { id: '3024', color: 15, qty: 3 }, { id: '6141', color: 14, qty: 1 }, { id: '3001', color: 9999, qty: 1 }];

describe('BrickLink export', () => {
  it('maps part ids, honouring overrides', () => {
    expect(blPart('6141')).toBe('4073');
    expect(blPart('4493c00')).toBe('4493c01');
    expect(blPart('3001', { 3001: '3001old' })).toBe('3001old');
  });
  it('maps common colours', () => {
    expect(BL_COLOR[4]).toBe(5);
    expect(BL_COLOR[71]).toBe(86);
    expect(BL_COLOR[72]).toBe(85);
  });
  it('adds spares only for small parts', () => {
    const r = wantedRows(inv, {}, true);
    expect(r.find((x) => x.id === '3001').buyQty).toBe(2);
    expect(r.find((x) => x.id === '3024').buyQty).toBe(4);
    expect(wantedRows(inv, {}, false).find((x) => x.id === '3024').buyQty).toBe(3);
  });
  it('writes valid wanted-list XML and skips unmapped colours', () => {
    const xml = wantedXML(wantedRows(inv), 'Tess & Co <3>');
    expect(xml.startsWith('<INVENTORY>')).toBe(true);
    expect(xml.match(/<ITEM>/g)).toHaveLength(3);
    expect(xml).toContain('<ITEMID>4073</ITEMID><COLOR>3</COLOR>');
    expect(xml).toContain('Tess &amp; Co &lt;3&gt;');
  });
  it('writes a CSV with a header row', () => {
    const csv = partsCSV(wantedRows(inv), new Map([[4, { name: 'Red' }]]));
    expect(csv.split('\n')[0]).toMatch(/^LDraw Part,BrickLink Part/);
    expect(csv.split('\n')).toHaveLength(inv.length + 1);
  });
});
