// Мерка файла значка — общая для tools/sync-icons.mjs, tools/build-icons.mjs и стража
// tools/check.mjs, чтобы страж проверял файлы той же меркой, какой их берут.
//
// Значок — один или несколько <path> цвета currentColor на своей сетке: у набора Klaarheid
// (вариант svg/fill) это 24 × 24, у фоновых лягушек — 48 × 48. Тогда значок красится цветом
// текста, и чужого цвета в интерфейс не попадёт.

export function checkIconFormat(svg, viewBox = '0 0 24 24') {
  const root = /<svg\b[^>]*>/u.exec(svg);
  if (!root) throw new Error('нет корневого <svg>');
  if (!root[0].includes(` viewBox="${viewBox}"`)) throw new Error(`viewBox не «${viewBox}»`);
  const end = svg.lastIndexOf('</svg>');
  if (end < 0) throw new Error('нет закрывающего </svg>');
  const body = svg.slice(root.index + root[0].length, end).trim();
  const tags = [...body.matchAll(/<\/?([a-zA-Z][\w:-]*)\b/gu)].map((m) => m[1]);
  const foreign = tags.find((t) => t !== 'path');
  if (foreign) throw new Error(`кроме <path> есть <${foreign}> — значок рисуется только путями`);
  if (!tags.length) throw new Error('ни одного <path>');
  for (const m of body.matchAll(/\s(fill|stroke)="([^"]*)"/gu)) {
    if (m[2] !== 'currentColor' && m[2] !== 'none') throw new Error(`зашитый цвет ${m[1]}="${m[2]}"`);
  }
  return body;
}
