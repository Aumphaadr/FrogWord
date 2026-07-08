#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const inputPath = process.argv[2];

if (!inputPath || inputPath === '--help' || inputPath === '-h') {
  console.error('Usage: npm run theme-bank:preview -- <theme-bank.json>');
  process.exit(inputPath ? 0 : 1);
}

const coreModuleUrl = pathToFileURL(resolve('packages/core/dist/themeBank.js')).href;

try {
  const [{ parseThemeBank }, rawJson] = await Promise.all([
    import(coreModuleUrl),
    readFile(inputPath, 'utf8'),
  ]);
  const result = parseThemeBank(JSON.parse(rawJson));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
