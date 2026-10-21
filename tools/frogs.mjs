#!/usr/bin/env node
// Фоновые лягушки веб-версии: силуэты из отрезков и дуг окружностей, построенные тем же способом,
// что и значки набора Klaarheid Icons. Геометрическое ядро набора лежит копией в
// tools/klaarheid/geom.mjs (MIT-0; файл не правится — при нужде заменяется новой копией).
//
//   npm run frogs                  — пересобрать apps/desktop/src/assets/icons/frogs/*.svg и icons.ts
//   node tools/frogs.mjs --check   — сверить файлы с рецептами (то же делает npm run check)
//
// Сетка 48 × 48. Силуэт — объединение деталей:
//   { hull: [[центр, r], …] } — выпуклая оболочка кругов, перечисленных по часовой: дуги и общие
//                               внешние касательные (тело);
//   { disk: [центр, r] }      — залитый круг (глазной бугор);
//   { limb: [точки, h] }      — толстая ломаная полутолщиной h со скруглёнными стыками и торцами (лапа);
//   { toe: [от, до, h, R] }   — палец: толстый отрезок и подушечка радиусом R на конце.
// Из объединения вырезаются отверстие { hole: [центр, r] } и прорезь { slit: [осевая, h] } — не ближе
// единицы к краю силуэта; в отверстие ставится зрачок { pupil: [центр, r] } с просветом не меньше 0,5.
// Контур пишется каноническими кубиками ядра: дуга режется на экстремумах, рычаги 4/3·tg(θ/4)·r.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_DIRS, writeIconsModule } from './build-icons.mjs';
import { A, L, add, arc, diskPiece, dist, fillPiece, line, loopArea, loopsToD, mul, path as geomPath, pointAt, polyline, reverseLoop, strokeLoops, strokePiece, sub, union } from './klaarheid/geom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROG_DIR = ICON_DIRS[1].dir;
const SIZE = 48;
const DP = 4;

const mirror = (p) => [SIZE - p[0], p[1]];
const ang = (v) => Math.atan2(v[1], v[0]);

/** Выпуклая оболочка кругов [[центр, r], …], перечисленных по часовой стрелке на экране. */
function circleHull(circles) {
  const n = circles.length;
  // нормаль общей внешней касательной круга i и следующего за ним
  const normals = circles.map(([c1, r1], i) => {
    const [c2, r2] = circles[(i + 1) % n];
    const d = dist(c1, c2);
    const u = mul(sub(c2, c1), 1 / d);
    const out = [u[1], -u[0]]; // наружу при обходе по часовой (ось y смотрит вниз)
    const cos = (r1 - r2) / d;
    if (Math.abs(cos) >= 1) throw new Error(`круг ${i} лежит внутри соседнего`);
    return add(mul(u, cos), mul(out, Math.sqrt(1 - cos * cos)));
  });
  const edges = [];
  circles.forEach(([c, r], i) => {
    const a0 = ang(normals[(i - 1 + n) % n]);
    const da = (((ang(normals[i]) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (da > 1e-9) edges.push(A(c, r, a0, da));
    const [c2, r2] = circles[(i + 1) % n];
    edges.push(L(add(c, mul(normals[i], r)), add(c2, mul(normals[i], r2))));
  });
  return geomPath(edges, true);
}

const diskLoop = (c, r) => diskPiece(c, r).loops[0];

/** Силуэт по деталям: d для <path>. */
export function renderFrog(parts) {
  const pieces = [];
  for (const p of parts) {
    if (p.hull) pieces.push(fillPiece(circleHull(p.hull)));
    else if (p.disk) pieces.push(diskPiece(p.disk[0], p.disk[1]));
    else if (p.limb) pieces.push(strokePiece(polyline(p.limb[0]), p.limb[1]));
    else if (p.toe) {
      const [a, b, h, R] = p.toe;
      pieces.push(strokePiece(line(a, b), h), diskPiece(b, R));
    }
  }
  const loops = union(pieces);
  // Внешний контур (самый большой) обходится в одну сторону, отверстия — в другую, зрачки — снова
  // как внешний: так заливка по правилу nonzero оставляет отверстия пустыми.
  const outer = loops.reduce((a, b) => (Math.abs(loopArea(b)) > Math.abs(loopArea(a)) ? b : a));
  const sign = Math.sign(loopArea(outer));
  const along = (lp, s) => (Math.sign(loopArea(lp)) === s ? lp : reverseLoop(lp));
  const inside = (q) => pieces.some((pc) => pc.bd(q) < 0);
  const mustBeInside = (points, what) => {
    if (points.some((q) => !inside(q))) throw new Error(`${what} подходит к краю силуэта ближе единицы`);
  };
  for (const p of parts) {
    if (p.hole) {
      const [c, r] = p.hole;
      const ring = Array.from({ length: 96 }, (_, k) => add(c, mul([Math.cos((k * Math.PI) / 48), Math.sin((k * Math.PI) / 48)], r + 1)));
      mustBeInside(ring, `отверстие у (${c.join('; ')})`);
      loops.push(along(diskLoop(c, r), -sign));
    } else if (p.slit) {
      const [axis, h] = p.slit;
      mustBeInside(strokeLoops(axis, h + 1).flat().flatMap((e) => [0, 0.25, 0.5, 0.75].map((t) => pointAt(e, t))), 'прорезь');
      for (const lp of strokeLoops(axis, h)) loops.push(along(lp, -sign));
    } else if (p.pupil) {
      const [c, r] = p.pupil;
      if (!parts.some((q) => q.hole && dist(q.hole[0], c) + r <= q.hole[1] - 0.5 + 1e-9)) {
        throw new Error(`зрачок у (${c.join('; ')}) не лежит в отверстии с просветом 0,5`);
      }
      loops.push(along(diskLoop(c, r), sign));
    }
  }
  return loopsToD(loops, DP);
}

// ─── рецепты ────────────────────────────────────────────────────────────────

const toesFrom = (wrist, tips, h, R) => tips.map((tip) => ({ toe: [wrist, tip, h, R] }));
// детали левой половины и их отражение относительно x = 24
const both = (parts) => [...parts, ...parts.map((p) => {
  if (p.disk) return { disk: [mirror(p.disk[0]), p.disk[1]] };
  if (p.limb) return { limb: [p.limb[0].map(mirror), p.limb[1]] };
  if (p.toe) return { toe: [mirror(p.toe[0]), mirror(p.toe[1]), p.toe[2], p.toe[3]] };
  if (p.hole) return { hole: [mirror(p.hole[0]), p.hole[1]] };
  if (p.pupil) return { pupil: [mirror(p.pupil[0]), p.pupil[1]] };
  throw new Error('отражаются только диск, лапа, палец, отверстие и зрачок');
})];

// Сидит в профиль, смотрит влево. Тело — оболочка головы, спины, крупа и живота; глаз — бугор
// с кольцом и зрачком; рот — прорезь по дуге; передняя лапа — прямая с тремя пальцами вперёд,
// задняя сложена под крупом, стопа с четырьмя пальцами лежит на земле.
const FROG_SITTING = [
  { hull: [[[10, 12], 7], [[23, 17], 9.5], [[36, 29], 10.5], [[19, 26], 5.5]] },
  { disk: [[11.5, 5.5], 4.25] },
  { hole: [[11.5, 5.5], 2.25] },
  { pupil: [[10.9, 5.5], 1.1] },
  { slit: [geomPath([arc([11, 1], 12.5, 118, -46)]), 0.6] },
  { limb: [[[14.5, 20], [10, 32]], 1.9] },
  ...toesFrom([10, 32], [[3.5, 31.5], [4.25, 34.5], [7, 36.5]], 0.9, 1.35),
  { limb: [[[42, 36], [30, 39.5]], 2.25] },
  ...toesFrom([30, 39.5], [[21, 37.5], [21.25, 40.25], [23.5, 42.25], [27, 42.75]], 0.9, 1.35),
];

// Вид сверху, лапы врастопырку (как на стекле). Симметрична относительно x = 24: тело — оболочка
// головы и туловища, глаза — бугры с отверстием и зрачком, лапы — ломаные с растопыренными
// пальцами.
const FROG_TOP = [
  { hull: [[[24, 15.5], 8.5], [[24, 28.5], 10.5]] },
  ...both([
    { disk: [[17.5, 11], 4.25] },
    { hole: [[17.5, 11], 2.25] },
    { pupil: [[17.5, 10.5], 1.25] },
    { limb: [[[18.5, 21.5], [10.5, 23.5], [7, 15.5]], 1.75] },
    ...toesFrom([7, 15.5], [[1.75, 13.25], [3.75, 9.75], [8, 9.25]], 0.9, 1.35),
    { limb: [[[18, 34], [7.5, 30.5], [9.5, 40.5]], 2.25] },
    ...toesFrom([9.5, 40.5], [[3, 38.5], [3.25, 42.5], [6, 45.25], [10.5, 45.75]], 0.9, 1.35),
  ]),
];

export const FROGS = [
  { name: 'frog-sitting', parts: FROG_SITTING },
  { name: 'frog-top', parts: FROG_TOP },
];

const frogSvg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">\n  <path fill="currentColor" d="${d}"/>\n</svg>\n`;

/** Текст файлов по рецептам: Map имя → svg. */
export function renderFrogFiles() {
  return new Map(FROGS.map((f) => [f.name, frogSvg(renderFrog(f.parts))]));
}

/** Расхождения файлов с рецептами: имена устаревших и лишних файлов (пусто — всё свежее). */
export function staleFrogs() {
  const files = renderFrogFiles();
  const dir = path.join(ROOT, FROG_DIR);
  const stale = [...files].filter(([name, svg]) => {
    const file = path.join(dir, `${name}.svg`);
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== svg;
  }).map(([name]) => name);
  const extra = fs.readdirSync(dir).filter((f) => f.endsWith('.svg') && !files.has(f.slice(0, -4))).map((f) => f.slice(0, -4));
  return [...stale, ...extra];
}

function main() {
  if (process.argv.includes('--check')) {
    const stale = staleFrogs();
    if (stale.length) {
      console.error(`лягушки расходятся с рецептами (${stale.join(', ')}) — npm run frogs`);
      process.exit(1);
    }
    console.log(`лягушки собраны из рецептов (${FROGS.length})`);
    return;
  }
  const files = renderFrogFiles();
  const dir = path.join(ROOT, FROG_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.svg') && !files.has(f.slice(0, -4))) fs.rmSync(path.join(dir, f));
  for (const [name, svg] of files) fs.writeFileSync(path.join(dir, `${name}.svg`), svg);
  console.log(`лягушек: ${files.size} → ${FROG_DIR}`);
  writeIconsModule();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
