// Run with: node --test scripts/site-content.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { render, checksFromDocs } from '../frontend/scripts/checks-from-docs.mjs';

test('the How it works check list matches the engine registry (packages/docs/checks.md)', () => {
  const current = fs.readFileSync(new URL('../frontend/src/checks.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(current, render(), 'run: node frontend/scripts/checks-from-docs.mjs');
});

test('AI search points add up to 100, and every Coding agents check has a weight', () => {
  const c = checksFromDocs(fs.readFileSync(new URL('../packages/docs/checks.md', import.meta.url), 'utf8'));
  assert.equal(c.aiSearch.reduce((s, x) => s + x.points, 0), 100);
  assert.ok(c.codingAgents.length > 10);
  for (const x of c.codingAgents) assert.ok(x.weight > 0, x.id);
});
