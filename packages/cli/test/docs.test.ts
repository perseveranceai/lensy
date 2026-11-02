// SPDX-License-Identifier: MIT
// packages/docs/checks.md is generated from the check registry and must stay
// up to date (Req 6.4). `npm run docs:checks` rewrites it.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { checksDoc } from '../src/explain';

const FILE = path.join(__dirname, '..', '..', 'docs', 'checks.md');

test('docs/checks.md matches the check registry', () => {
  if (process.env.LENSY_UPDATE_DOCS === '1') {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, checksDoc());
  }
  expect(fs.existsSync(FILE), 'run npm run docs:checks').toBe(true);
  expect(fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'), 'docs/checks.md is out of date: run npm run docs:checks').toBe(checksDoc());
});
