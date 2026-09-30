#!/usr/bin/env node
// Стражи FrogWord: npm run check.
//
//  1. Внешние адреса. Приложение и веб-версия ничего не грузят с других сайтов — ни с CDN, ни с
//     GitHub, в том числе с сайта и из репозитория набора Klaarheid: GitHub не хостинг для раздачи
//     файлов. Можно: ссылку для перехода (<a href>, window.open), комментарий в исходниках,
//     пространство имён XML, адрес этого компьютера (сервер разработки), API и чат Twitch — ради
//     них игра и работает, — и адрес из текста ошибки React в собранной веб-версии.
//  2. Значки. icons.ts собран из файлов; значки набора — в формате набора, раздел «Значки» в
//     THIRD-PARTY-NOTICES.md сходится с папкой; лишних значков нет.
//  3. Лягушки. Фоновые лягушки совпадают с рецептами tools/frogs.mjs.
//  4. Лицензии рядом. У файлов шрифта лежит лицензия шрифта, у маскота — лицензия Noto Emoji, и
//     THIRD-PARTY-NOTICES.md называет оба файла; собранная веб-версия несёт тексты лицензий в
//     docs/licenses/ (FrogWord, пакеты npm из сборки, маскот, шрифт).
//  5. Лицензии библиотек. Пакеты npm из приложения и крейты Rust из бинарника — только из белого
//     списка (tools/licenses.mjs), раздел «Библиотеки» свежий.
// Каждый страж проверен на обратном: самопроверки ниже должны его ронять.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_DIRS, OUT as ICONS_TS, renderIconsModule } from './build-icons.mjs';
import { checkIconFormat } from './icon-format.mjs';
import { klaarheidSection } from './sync-icons.mjs';
import { staleFrogs } from './frogs.mjs';
import { allowed, checkLicenses, collectNpm, parseLicense } from './licenses.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
let failures = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg, list = []) => {
  failures++;
  console.log(`✗ ${msg}${list.length ? `\n    ${list.join('\n    ')}` : ''}`);
};

function walk(dir, exts, out = []) {
  if (!existsSync(join(ROOT, dir))) return out;
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.has(extname(e.name))) out.push(rel);
  }
  return out;
}

// ─── 1. внешние адреса ──────────────────────────────────────────────────────

const SOURCE_DIRS = ['apps/desktop/src', 'apps/desktop/public', 'packages/core/src', 'packages/storage/src'];
const BUILT_DIRS = ['docs'];
const SERVED_EXT = new Set(['.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.svg', '.json']);
const NAMESPACE = /^http:\/\/(?:www\.w3\.org\/(?:2000\/svg|1999\/xlink|1999\/xhtml|1998\/Math\/MathML|XML\/1998\/namespace)|www\.inkscape\.org\/namespaces\/inkscape|sodipodi\.sourceforge\.net\/DTD\/sodipodi-0\.dtd|creativecommons\.org\/ns#|purl\.org\/dc\/elements\/1\.1\/|www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#)$/u;
const LOOPBACK = /^(?:[a-z]+:)?\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?:[:/?#]|$)/iu;
// Twitch: авторизация (Device Code), API и чат IRC по WebSocket. Страницы и сценарии Twitch
// (embed.twitch.tv и другие) сюда не входят — это уже загрузка чужого кода.
const TWITCH = /^(?:https|wss):\/\/(?:id\.twitch\.tv|api\.twitch\.tv|irc-ws\.chat\.twitch\.tv)(?::443)?(?:[/?#]|$)/u;
// Собранный React пишет в тексте ошибки адрес её описания; страница его не загружает.
const REACT_ERROR_TEXT = /^https:\/\/react\.dev\/errors\/$/u;
// Полный адрес или адрес без протокола: «//cdn.example.com/…».
const ADDRESS = /(?:\b[a-z][a-z0-9+.-]*:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?[^\s"'`)<>]*|(?:\b[a-z][a-z0-9+.-]*:)?\/\/(?:localhost|\[::1\])(?::\d+)?[^\s"'`)<>]*/giu;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|<!--|\{\/\*)/u;
const TRAILING_COMMENT = /(?:^|[\s,;{}()[\]])\/\/\s/u;

/** Адрес стоит в href ссылки: от последнего «<» до адреса — открытый тег <a с href. */
function inAnchorHref(text, index) {
  const open = text.lastIndexOf('<', index);
  if (open < 0) return false;
  return /^<a\s[^<>]*\bhref\s*=\s*\{?\s*["'`]?$/iu.test(text.slice(open, index));
}
/** Адрес открывается в браузере пользователя, а не грузится страницей. */
const inNavigation = (text, index) => /(?:openUrl|window\.open)\(\s*["'`]$/u.test(text.slice(Math.max(0, index - 40), index));

/**
 * Внешние адреса в тексте. comments: false — для собранных файлов: в сжатом коде нет строк-комментариев,
 * а «// » внутри строки иначе спрятало бы всё, что стоит за ним в той же длинной строке.
 */
export function externalAddresses(text, { comments = true } = {}) {
  const found = [];
  for (const m of text.matchAll(ADDRESS)) {
    const addr = m[0];
    if (NAMESPACE.test(addr) || LOOPBACK.test(addr) || TWITCH.test(addr) || REACT_ERROR_TEXT.test(addr)
      || inAnchorHref(text, m.index) || inNavigation(text, m.index)) continue;
    if (comments) {
      const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
      const lineEnd = text.indexOf('\n', m.index);
      const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
      if (COMMENT_LINE.test(line) || TRAILING_COMMENT.test(text.slice(lineStart, m.index))) continue;
    }
    found.push({ line: text.slice(0, m.index).split('\n').length, address: addr });
  }
  return found;
}

function checkLocalOnly() {
  const sources = ['apps/desktop/index.html', ...SOURCE_DIRS.flatMap((d) => walk(d, SERVED_EXT))]
    .filter((f) => !/\.test\.tsx?$/u.test(f)).sort();
  const built = BUILT_DIRS.flatMap((d) => walk(d, SERVED_EXT)).sort();
  const hits = [];
  for (const rel of sources) for (const h of externalAddresses(read(rel))) hits.push(`${rel}:${h.line} — ${h.address}`);
  for (const rel of built) for (const h of externalAddresses(read(rel), { comments: false })) hits.push(`${rel}:${h.line} — ${h.address}`);
  if (hits.length) bad('внешние адреса — всё, что нужно странице, кладётся в репозиторий, значки Klaarheid копируются через npm run icons:sync', hits);
  else ok(`внешних загрузок нет (исходников: ${sources.length}, файлов сборки: ${built.length})`);
  // Проверка не пустая: в обходе интерфейс, ядро игры, значки и собранная веб-версия.
  const must = ['apps/desktop/index.html', 'apps/desktop/src/App.tsx', ICONS_TS, 'apps/desktop/src/twitchChatService.ts',
    'packages/core/src/engine.ts', 'apps/desktop/public/favicon.svg', 'docs/index.html'];
  const missing = must.filter((m) => !sources.includes(m) && !built.includes(m));
  if (missing.length) bad('страж внешних адресов не видит файлов', missing);
  if (!built.some((f) => /^docs\/assets\/index-[\w-]+\.js$/u.test(f))) bad('страж внешних адресов не видит сборку веб-версии в docs/assets');

  // самопроверка на обратном
  const caught = (text, opts) => externalAddresses(text, opts).map((h) => h.address);
  const set = 'https://aumphaadr.github.io/Klaarheid-Icons/svg/fill/eye.svg';
  const raw = 'https://raw.githubusercontent.com/Aumphaadr/Klaarheid-Icons/main/svg/fill/eye.svg';
  const cases = [
    [caught(`<img src="${set}" alt="">`), [set], 'картинка с сайта набора'],
    [caught(`const svg = await (await fetch('${raw}')).text();`), [raw], 'файл из репозитория набора'],
    [caught('<script src="https://cdn.jsdelivr.net/gh/Aumphaadr/Klaarheid-Icons/svg/fill/x.svg"></script>'), ['https://cdn.jsdelivr.net/gh/Aumphaadr/Klaarheid-Icons/svg/fill/x.svg'], 'jsDelivr gh/'],
    [caught('.x { background: url(//cdn.example.com/a.png) }'), ['//cdn.example.com/a.png'], 'адрес без протокола в CSS'],
    [caught('@import url("https://fonts.googleapis.com/css2?family=Onest");'), ['https://fonts.googleapis.com/css2?family=Onest'], 'шрифт с чужого сервера'],
    [caught('<script src="https://embed.twitch.tv/embed/v1.js"></script>'), ['https://embed.twitch.tv/embed/v1.js'], 'сценарий Twitch — загрузка, а не API'],
    [caught('<img src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0">'), ['https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0'], 'картинка с CDN Twitch'],
    [caught("const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';"), [], 'авторизация Twitch'],
    [caught("new WebSocket('wss://irc-ws.chat.twitch.tv:443')"), [], 'чат Twitch'],
    [caught("fetch('https://api.twitch.tv/helix/users')"), [], 'API Twitch'],
    [caught('<a href="https://github.com/Aumphaadr/FrogWord">исходники</a>'), [], 'ссылка для перехода'],
    [caught('<a className="x" href={"https://www.twitch.tv/x"}>канал</a>'), [], 'ссылка в JSX'],
    [caught('window.open("https://www.twitch.tv/activate");'), [], 'открыть в браузере'],
    [caught('// https://example.com/doc'), [], 'строка комментария'],
    [caught('{/* https://example.com/doc */}'), [], 'комментарий JSX'],
    [caught('<code>http://127.0.0.1:1420/</code> http://localhost:4173/'), [], 'адрес этого компьютера'],
    [caught('<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">'), [], 'пространства имён'],
    [caught('"Minified React error #"+e+"; visit https://react.dev/errors/"+e', { comments: false }), [], 'текст ошибки React в сборке'],
    [caught('var a="x // y",b="https://cdn.example.com/lib.js";', { comments: false }), ['https://cdn.example.com/lib.js'], '«// » в строке сжатого кода не прячет адрес'],
  ];
  const wrong = cases.filter(([got, want]) => JSON.stringify(got) !== JSON.stringify(want)).map(([got, want, what]) => `${what}: ждали ${JSON.stringify(want)}, получили ${JSON.stringify(got)}`);
  if (wrong.length) bad('самопроверка стража внешних адресов', wrong);
}

// ─── 2. значки ──────────────────────────────────────────────────────────────

function checkIcons() {
  const names = (d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));
  const [kl, frogs] = ICON_DIRS.map(({ dir }) => names(dir));
  const formatErr = [];
  for (const [{ dir, viewBox }, list] of [[ICON_DIRS[0], kl], [ICON_DIRS[1], frogs]]) {
    for (const n of list) {
      try { checkIconFormat(read(`${dir}/${n}.svg`), viewBox); } catch (e) { formatErr.push(`${dir}/${n}.svg: ${e.message}`); }
    }
  }
  if (formatErr.length) bad('значки не в своём формате (одни <path> цвета currentColor на сетке 24, у лягушек — 48)', formatErr);
  let text;
  try { text = renderIconsModule().text; } catch (e) { bad(`значки не собираются: ${e.message}`); return; }
  if (read(ICONS_TS) !== text) bad(`${ICONS_TS} не совпадает с файлами значков — npm run icons`);
  else ok(`${ICONS_TS} собран из файлов (набор: ${kl.length}, лягушки: ${frogs.length})`);

  const notices = read('THIRD-PARTY-NOTICES.md');
  const m = /<!-- klaarheid:start[^>]*-->\n([\s\S]*?)\n<!-- klaarheid:end -->/u.exec(notices);
  if (!m) bad('в THIRD-PARTY-NOTICES.md нет раздела между klaarheid:start и klaarheid:end');
  else if (m[1] !== klaarheidSection(kl.length)) bad('раздел «Значки» в THIRD-PARTY-NOTICES.md расходится с папкой — npm run icons:sync');
  else ok(`раздел «Значки» сходится с папкой (${kl.length})`);

  // Каждый значок где-то нужен: имя встречается строкой в коде интерфейса.
  const code = walk('apps/desktop/src', new Set(['.ts', '.tsx'])).filter((f) => f !== ICONS_TS).map(read).join('\n');
  const unused = [...kl, ...frogs].filter((n) => !code.includes(`"${n}"`) && !code.includes(`'${n}'`));
  if (unused.length) bad('значки лежат, но нигде не используются — удалите файл и запустите npm run icons', unused);
  else ok('лишних значков нет');
}

// ─── 3. лягушки ─────────────────────────────────────────────────────────────

function checkFrogs() {
  let stale;
  try { stale = staleFrogs(); } catch (e) { bad(`лягушки не строятся: ${e.message}`); return; }
  if (stale.length) bad('фоновые лягушки расходятся с рецептами tools/frogs.mjs — npm run frogs', stale);
  else ok('фоновые лягушки собраны из рецептов');
}

// ─── 4. лицензии рядом с файлами ────────────────────────────────────────────

function checkLicenseFiles() {
  const notices = read('THIRD-PARTY-NOTICES.md');
  const errors = [];
  let fonts = 0;
  const fontDirs = [...new Set(walk('apps/desktop/src/assets/fonts', new Set(['.ttf', '.otf', '.woff', '.woff2'])).map((f) => f.slice(0, f.lastIndexOf('/'))))];
  for (const d of fontDirs) {
    const files = readdirSync(join(ROOT, d));
    for (const f of files.filter((x) => /\.(ttf|otf|woff2?)$/u.test(x))) {
      fonts++;
      const family = f.split(/[-.]/u)[0];
      const license = files.find((x) => [`${family}-OFL.txt`, `${family}-LICENSE.txt`, `${family}-EULA.pdf`].includes(x));
      if (!license) { errors.push(`${d}/${f}: рядом нет лицензии (${family}-OFL.txt, ${family}-LICENSE.txt или ${family}-EULA.pdf)`); continue; }
      if (!notices.includes(`${d}/${license}`)) errors.push(`${d}/${license}: THIRD-PARTY-NOTICES.md о нём молчит`);
    }
  }
  const mascot = 'apps/desktop/src/mascot/NotoEmoji-LICENSE.txt';
  if (!existsSync(join(ROOT, mascot))) errors.push(`${mascot}: нет файла — у маскота из Noto Emoji рядом лежит текст Apache License 2.0`);
  else if (!read(mascot).includes('Apache License') || !notices.includes(mascot)) errors.push(`${mascot}: не текст Apache License или THIRD-PARTY-NOTICES.md о нём молчит`);
  if (!fonts) errors.push('страж не видит файлов шрифта в apps/desktop/src/assets/fonts');
  if (errors.length) bad('лицензии рядом с чужими файлами', errors);
  else ok(`у всех ${fonts} файлов шрифта и у маскота лицензия рядом и строка в notices`);

  // Веб-версия несёт тексты лицензий с собой (apps/desktop/vite.config.ts): копии файлов проекта
  // байт в байт и лицензии всех пакетов npm, которые уходят в сборку.
  const shipped = [
    ['LICENSE', 'docs/licenses/FrogWord-LICENSE.txt'],
    [mascot, 'docs/licenses/NotoEmoji-LICENSE.txt'],
    ['apps/desktop/src/assets/fonts/cygre/Cygre-EULA.pdf', 'docs/licenses/Cygre-EULA.pdf'],
  ];
  const inBuild = [];
  for (const [from, to] of shipped) {
    if (!existsSync(join(ROOT, to))) inBuild.push(`${to}: нет файла`);
    else if (!readFileSync(join(ROOT, from)).equals(readFileSync(join(ROOT, to)))) inBuild.push(`${to}: расходится с ${from}`);
  }
  const npmList = 'docs/licenses/npm-packages.md';
  if (!existsSync(join(ROOT, npmList))) inBuild.push(`${npmList}: нет файла`);
  else {
    const text = read(npmList);
    for (const p of collectNpm()) if (!text.includes(`## ${p.name} - ${p.version} `)) inBuild.push(`${npmList}: нет ${p.name} ${p.version}`);
  }
  if (inBuild.length) bad('тексты лицензий в собранной веб-версии — npm run build:pages', inBuild);
  else ok('веб-версия несёт тексты лицензий: FrogWord, пакеты npm, маскот, шрифт');
}

// ─── 5. лицензии библиотек ──────────────────────────────────────────────────

function checkDeps() {
  const self = [
    ['MIT', 'x', true], ['MIT/Apache-2.0', 'x', true], ['Apache-2.0 WITH LLVM-exception', 'x', true],
    ['MIT OR GPL-3.0', 'x', true], ['GPL-3.0', 'x', false], ['MIT AND GPL-3.0', 'x', false],
    ['LGPL-2.1-or-later', 'x', false], ['MPL-2.0', 'option-ext', true], ['MPL-2.0', 'cssparser', false],
    ['(MIT OR Apache-2.0) AND Unicode-3.0', 'x', true], ['AGPL-3.0-only OR SSPL-1.0', 'x', false],
  ];
  const wrong = self.filter(([e, c, want]) => allowed(parseLicense(e), c) !== want).map(([e, c, want]) => `${e} (${c}): ждали ${want}`);
  if (wrong.length) bad('самопроверка белого списка лицензий', wrong);
  const r = checkLicenses();
  if (r.skipped) console.log(`- ${r.skipped}`);
  if (r.errors.length) bad('лицензии библиотек', r.errors);
  else if (!r.skipped) ok(`лицензии: пакетов npm — ${r.npm}, крейтов Rust — ${r.crates}; все из белого списка, раздел «Библиотеки» свежий`);
}

checkLocalOnly();
checkIcons();
checkFrogs();
checkLicenseFiles();
checkDeps();
console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
process.exit(failures ? 1 : 0);
