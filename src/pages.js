// Printable page sizes (mm) and the @page CSS for them.
export const PAGE_SIZES = {
  'A5 landscape': [210, 148], 'Half letter landscape': [216, 140], 'A4 portrait': [210, 297], 'Letter portrait': [216, 279], 'A4 landscape': [297, 210],
};
export function pageCSS(size) {
  const [w, h] = PAGE_SIZES[size] || PAGE_SIZES['A5 landscape'];
  return `@page{size:${w}mm ${h}mm;margin:0}.pg{width:${w}mm;height:${h}mm}`;
}
