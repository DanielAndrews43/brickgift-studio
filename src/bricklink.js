// LDraw -> BrickLink mapping and Wanted List XML export.

// LDraw color code -> BrickLink color id. Covers current and common colors; unknown ones are flagged in the UI.
export const BL_COLOR = {
  0: 11, 1: 7, 2: 6, 3: 39, 4: 5, 5: 47, 6: 8, 7: 9, 8: 10, 9: 62, 10: 36, 11: 40, 12: 25, 13: 23, 14: 3, 15: 1,
  17: 38, 18: 33, 19: 2, 20: 44, 22: 24, 23: 109, 25: 4, 26: 71, 27: 34, 28: 69, 29: 104, 30: 157, 31: 154,
  33: 14, 34: 20, 35: 108, 36: 17, 37: 50, 40: 13, 41: 15, 42: 16, 46: 19, 47: 12, 52: 51, 54: 121, 57: 18,
  68: 96, 69: 93, 70: 88, 71: 86, 72: 85, 73: 42, 74: 37, 77: 56, 78: 90, 80: 67, 82: 65, 84: 150, 85: 89,
  92: 28, 100: 26, 110: 43, 115: 76, 118: 41, 120: 35, 125: 32, 135: 66, 148: 77, 151: 99, 179: 95, 182: 98,
  191: 110, 212: 105, 226: 103, 232: 87, 272: 63, 288: 80, 297: 115, 308: 120, 313: 72, 320: 59, 321: 153,
  322: 156, 323: 152, 326: 158, 330: 155, 334: 21, 335: 58, 351: 94, 366: 29, 373: 54, 378: 48, 379: 55,
  383: 22, 462: 31, 484: 68, 503: 49,
};

// LDraw part ids whose BrickLink catalog id differs.
export const BL_PART = {
  '3794b': '15573', '6141': '4073', '3794a': '3794',
};

export const blPart = (id, overrides = {}) => overrides[id] || BL_PART[id] || id.replace(/\.dat$/, '');

// Small parts get a spare, like retail sets.
const SMALL = /^(3024|3023|3070b|3069b|6141|4073|3005|98138|3062b|4589|85861|3794b|15573|2412b|54200|3040|3623|3710)$/;

export function wantedRows(inventory, overrides = {}, spares = true) {
  return inventory.map((p) => ({
    ...p,
    blId: blPart(p.id, overrides),
    blColor: BL_COLOR[p.color],
    buyQty: p.qty + (spares && SMALL.test(p.id) ? 1 : 0),
  }));
}

export function wantedXML(rows, remarks = '') {
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const items = rows.filter((r) => r.blColor !== undefined).map((r) =>
    `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${esc(r.blId)}</ITEMID><COLOR>${r.blColor}</COLOR><MINQTY>${r.buyQty}</MINQTY><CONDITION>X</CONDITION>${remarks ? `<REMARKS>${esc(remarks)}</REMARKS>` : ''}<NOTIFY>N</NOTIFY></ITEM>`);
  return `<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`;
}

export function partsCSV(rows, colors) {
  const head = 'LDraw Part,BrickLink Part,LDraw Color,Color Name,BrickLink Color,Quantity,Buy Quantity';
  return [head, ...rows.map((r) => [r.id, r.blId, r.color, `"${colors.get(r.color)?.name || ''}"`, r.blColor ?? '', r.qty, r.buyQty].join(','))].join('\n');
}

export const blLink = (r) => `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(r.blId)}${r.blColor ? '&idColor=' + r.blColor : ''}`;
export const BL_UPLOAD = 'https://www.bricklink.com/v2/wanted/upload.page';
