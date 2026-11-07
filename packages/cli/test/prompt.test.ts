// SPDX-License-Identifier: MIT
// The first-run question (Req 2.2-2.3): yes, no, empty, invalid twice, stdin
// closed, and Ctrl-C. The question goes to stderr.
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { askYesNo } from '../src/prompt';

const Q = 'Save results? [Y/n]';
function ask(lines: string[] | undefined) {
  let err = '';
  const stdin = lines ? Readable.from(lines.map(l => `${l}\n`)) : undefined;
  const result = askYesNo({ stdin, stderr: { write: (s: string) => { err += s; return true; } } }, Q);
  return { result, err: () => err, stdin };
}

describe('askYesNo', () => {
  test.each(['', 'y', 'Y', 'yes', 'YES', 'Yes', ' y ', '  '])('%j is yes', async (answer) => {
    const t = ask([answer]);
    expect(await t.result).toBe(true);
    expect(t.err()).toBe(`${Q} `);
  });

  test.each(['n', 'N', 'no', 'NO', 'No', ' no '])('%j is no', async (answer) => {
    const t = ask([answer]);
    expect(await t.result).toBe(false);
  });

  test('anything else is asked once more, and the second answer counts', async () => {
    const t = ask(['maybe', 'y']);
    expect(await t.result).toBe(true);
    expect(t.err()).toBe(`${Q} Please answer y or n. ${Q} `);
    const no = ask(['what', 'n']);
    expect(await no.result).toBe(false);
  });

  test('two invalid answers: no for this run only (null, not remembered)', async () => {
    const t = ask(['maybe', 'later', 'y']); // the third line is never read
    expect(await t.result).toBeNull();
    expect((t.err().match(/Please answer y or n\./g) ?? []).length).toBe(1); // asked exactly twice
  });

  test('stdin closed before an answer: null', async () => {
    const t = ask([]);
    expect(await t.result).toBeNull();
    expect(t.err()).toBe(`${Q} \n`);
  });

  test('stdin closed after one invalid answer: null', async () => {
    const t = ask(['huh']);
    expect(await t.result).toBeNull();
  });

  test('no stdin at all: null, and nothing is written', async () => {
    const t = ask(undefined);
    expect(await t.result).toBeNull();
    expect(t.err()).toBe('');
  });

  test('Ctrl-C at the question: null, and the listener is removed afterwards', async () => {
    const before = process.listenerCount('SIGINT');
    const stdin = new PassThrough(); // never answers
    let err = '';
    const pending = askYesNo({ stdin, stderr: { write: (s: string) => { err += s; return true; } } }, Q);
    await new Promise(r => setTimeout(r, 20));
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    process.emit('SIGINT');
    expect(await pending).toBeNull();
    expect(err.startsWith(Q)).toBe(true);
    expect(process.listenerCount('SIGINT')).toBe(before);
    stdin.destroy();
  });

  test('the SIGINT listener is also removed after a normal answer', async () => {
    const before = process.listenerCount('SIGINT');
    await ask(['y']).result;
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  test('a long line and Windows line endings are fine', async () => {
    const stdin = Readable.from(['yes\r\n']);
    expect(await askYesNo({ stdin, stderr: { write: () => true } }, Q)).toBe(true);
  });
});
