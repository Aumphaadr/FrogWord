#!/usr/bin/env node
// Собирает значки в один apps/desktop/src/icons.ts.
// Запуск: npm run icons (сам зовётся из npm run icons:sync и npm run frogs);
// проверка: node tools/build-icons.mjs --check
//
// Источники:
//  - apps/desktop/src/assets/icons/klaarheid/ — значки набора Klaarheid Icons (MIT-0), копии файлов
//    svg/fill набора байт в байт; кладёт и обновляет их только npm run icons:sync;
//  - apps/desktop/src/assets/icons/frogs/ — фоновые лягушки веб-версии, их рисует npm run frogs.
//
// Содержимое файла (пути) переносится как есть: контуры не пересчитываются, цвет — currentColor.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkIconFormat } from './icon-format.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ICON_DIRS = [
  { dir: 'apps/desktop/src/assets/icons/klaarheid', viewBox: '0 0 24 24' },
  { dir: 'apps/desktop/src/assets/icons/frogs', viewBox: '0 0 48 48' },
];
export const OUT = 'apps/desktop/src/icons.ts';

/** Текст icons.ts по текущим файлам значков: { text, count }. */
export function renderIconsModule() {
  const icons = [];
  const seen = new Map();
  for (const { dir, viewBox } of ICON_DIRS) {
    for (const file of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.svg')).sort()) {
      const name = file.slice(0, -4);
      if (seen.has(name)) throw new Error(`значок «${name}» лежит и в ${seen.get(name)}, и в ${dir}`);
      seen.set(name, dir);
      let body;
      try {
        body = checkIconFormat(readFileSync(join(ROOT, dir, file), 'utf8'), viewBox);
      } catch (err) {
        throw new Error(`${dir}/${file}: ${err.message}`);
      }
      icons.push({ name, viewBox, body: body.replace(/>\s+</gu, '><') });
    }
  }
  icons.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const text = [
    '// СГЕНЕРИРОВАНО tools/build-icons.mjs — не редактировать вручную.',
    '// Источники: assets/icons/klaarheid/*.svg (набор Klaarheid Icons, npm run icons:sync)',
    '// и assets/icons/frogs/*.svg (фоновые лягушки, npm run frogs); пересобрать: npm run icons',
    '',
    '/** [viewBox, содержимое] */',
    'export const ICONS = {',
    ...icons.map((i) => `  ${JSON.stringify(i.name)}: [${JSON.stringify(i.viewBox)}, ${JSON.stringify(i.body)}],`),
    '} as const;',
    '',
    'export type IconName = keyof typeof ICONS;',
    '',
  ].join('\n');
  return { text, count: icons.length };
}

/** Записать icons.ts; возвращает число значков. */
export function writeIconsModule() {
  const { text, count } = renderIconsModule();
  writeFileSync(join(ROOT, OUT), text);
  console.log(`значков: ${count}; ${OUT} — ${(Buffer.byteLength(text) / 1024).toFixed(0)} КБ`);
  return count;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const { text } = renderIconsModule();
    if (readFileSync(join(ROOT, OUT), 'utf8') !== text) {
      console.error(`${OUT} не совпадает с файлами значков — запустите npm run icons`);
      process.exit(1);
    }
    console.log(`${OUT} совпадает с файлами значков`);
  } else {
    writeIconsModule();
  }
}
