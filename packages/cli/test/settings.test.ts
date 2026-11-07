// SPDX-License-Identifier: MIT
// Settings (Req 2.4-2.5, 3.1, 6): the project config, the user settings that
// remember a "no", and the rules for whether a run saves, in order.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  ConfigError, decideSave, readProjectConfig, readUserConfig, rememberedSave, rememberNoSave, userConfigFile, writeSaveKey,
} from '../src/settings';
import type { ProjectConfig, SaveDecision, UserConfig } from '../src/settings';
import { listFiles, useTempDirs } from './helpers';

const tmp = useTempDirs();
const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
const modeOf = (p: string) => fs.statSync(p).mode & 0o777;

describe('decideSave: Req 3.1, rule by rule and in order', () => {
  const ROOT = '/work/project';
  const none: UserConfig = { raw: {}, invalid: false };
  const rememberedNo: UserConfig = { raw: { projects: { [ROOT]: { save: false } } }, invalid: false };
  type Flags = { save?: boolean; saveDir?: string; noSave?: boolean };
  const decide = (flags: Flags, project: ProjectConfig | null, user: UserConfig, interactive: boolean, jsonToStdout = false): SaveDecision =>
    decideSave(flags, project, user, ROOT, interactive, jsonToStdout);

  test.each<[string, Flags, ProjectConfig | null, UserConfig, boolean, boolean, SaveDecision]>([
    // a. --no-save beats everything below
    ['a: --no-save', { noSave: true }, null, none, false, false, 'skip'],
    ['a: --no-save beats project save:true', { noSave: true }, { save: true }, none, true, false, 'skip'],
    ['a: --no-save beats a question', { noSave: true }, null, none, true, false, 'skip'],
    // b. --save or --save-dir
    ['b: --save', { save: true }, null, none, false, false, 'save'],
    ['b: --save-dir', { saveDir: 'out' }, null, none, false, false, 'save'],
    ['b: --save beats project save:false', { save: true }, { save: false }, none, true, false, 'save'],
    ['b: --save-dir beats a remembered no', { saveDir: 'out' }, null, rememberedNo, true, false, 'save'],
    ['b: --save with --json - still saves', { save: true }, null, none, false, true, 'save'],
    // c. project config says false
    ['c: project save:false', {}, { save: false }, none, false, false, 'skip'],
    ['c: project save:false beats the question', {}, { save: false }, none, true, false, 'skip'],
    // d. project config says true
    ['d: project save:true', {}, { save: true }, none, false, false, 'save'],
    ['d: project save:true beats a remembered no', {}, { save: true }, rememberedNo, true, false, 'save'],
    ['d: project save:true works without a terminal', {}, { save: true }, none, false, false, 'save'],
    // e. the user settings remember false for this root
    ['e: remembered no', {}, null, rememberedNo, true, false, 'skip'],
    ['e: remembered no, project config without save', {}, { pages: ['https://x.com/'] }, rememberedNo, true, false, 'skip'],
    // f. interactive: ask
    ['f: interactive', {}, null, none, true, false, 'ask'],
    ['f: interactive, project config without save', {}, { keep: 5 }, none, true, false, 'ask'],
    ['f: but never with --json -', {}, null, none, true, true, 'skip'],
    // g. otherwise: don't save
    ['g: not interactive', {}, null, none, false, false, 'skip'],
    ['g: not interactive with --json -', {}, null, none, false, true, 'skip'],
  ])('%s', (_name, flags, project, user, interactive, jsonToStdout, expected) => {
    expect(decide(flags, project, user, interactive, jsonToStdout)).toBe(expected);
  });

  test('a remembered answer for a different project root does not apply', () => {
    const other: UserConfig = { raw: { projects: { '/work/other': { save: false } } }, invalid: false };
    expect(decide({}, null, other, true)).toBe('ask');
  });

  test('only a remembered false counts; anything else in the user settings is ignored', () => {
    for (const entry of [{ save: true }, { save: 'no' }, {}, 'x', null, []]) {
      expect(rememberedSave({ raw: { projects: { [ROOT]: entry } }, invalid: false }, ROOT)).toBeUndefined();
    }
    expect(rememberedSave({ raw: { projects: 'x' }, invalid: false }, ROOT)).toBeUndefined();
    expect(rememberedSave({ raw: {}, invalid: false }, ROOT)).toBeUndefined();
  });
});

describe('readProjectConfig: Req 6.1 and 6.4', () => {
  const DISPLAY = '.lensy/config.json';
  const read = (text: string) => readProjectConfig(write(path.join(tmp(), 'config.json'), text), DISPLAY);
  const fails = (text: string) => { try { read(text); } catch (e) { expect(e).toBeInstanceOf(ConfigError); return (e as Error).message; } throw new Error('expected a ConfigError'); };

  test('a missing file is fine', () => {
    expect(readProjectConfig(path.join(tmp(), 'nope.json'), DISPLAY)).toEqual({ config: null, unknownKeys: [] });
  });

  test('every key is optional', () => {
    expect(read('{}')).toEqual({ config: {}, unknownKeys: [] });
  });

  test('a full file', () => {
    const full = { configVersion: 1, save: true, keep: 52, pages: ['https://docs.example.com/guide/start', 'docs.example.com/api'] };
    expect(read(JSON.stringify(full))).toEqual({ config: full, unknownKeys: [] });
  });

  test.each([[1], [1000], [52]])('keep: %s is valid', (keep) => {
    expect(read(`{"keep":${keep}}`).config?.keep).toBe(keep);
  });

  test.each([['0'], ['1001'], ['-1'], ['1.5'], ['"5"'], ['null'], ['true'], ['[]']])('keep: %s names the file and the rule', (keep) => {
    expect(fails(`{"keep":${keep}}`)).toBe('.lensy/config.json: "keep" must be a whole number from 1 to 1000.');
  });

  test.each([['"yes"'], ['1'], ['null']])('save: %s is not a boolean', (save) => {
    expect(fails(`{"save":${save}}`)).toBe('.lensy/config.json: "save" must be true or false.');
  });

  test.each([['"https://x.com/"'], ['[1]'], ['[null]'], ['{"a":1}'], ['[["x"]]']])('pages: %s is not a list of strings', (pages) => {
    expect(fails(`{"pages":${pages}}`)).toBe('.lensy/config.json: "pages" must be a list of page URLs, each in quotes.');
  });

  test('an empty pages list is valid (and means "no pages")', () => {
    expect(read('{"pages":[]}').config?.pages).toEqual([]);
  });

  test.each([['0'], ['"1"'], ['1.5'], ['null']])('configVersion: %s', (v) => {
    expect(fails(`{"configVersion":${v}}`)).toContain('"configVersion" must be a whole number');
  });

  test.each([
    ['', 'not valid JSON'],
    ['{', 'not valid JSON'],
    ['{"keep": 5,}', 'not valid JSON'],
    ['// comment\n{}', 'not valid JSON'],
    ['[]', 'must be a JSON object'],
    ['null', 'must be a JSON object'],
    ['42', 'must be a JSON object'],
    ['"text"', 'must be a JSON object'],
  ])('%j', (text, message) => {
    const m = fails(text);
    expect(m.startsWith('.lensy/config.json: ')).toBe(true);
    expect(m).toContain(message);
  });

  test('unknown keys are reported, not rejected, and left out of the config', () => {
    expect(read('{"keep":3,"colour":"red","extra":1}')).toEqual({ config: { keep: 3 }, unknownKeys: ['colour', 'extra'] });
  });

  test('a folder where the file should be is a ConfigError, not a crash', () => {
    const dir = path.join(tmp(), 'config.json');
    fs.mkdirSync(dir);
    expect(() => readProjectConfig(dir, DISPLAY)).toThrow(ConfigError);
  });
});

describe('writeSaveKey: Req 6.5, only the save key changes', () => {
  test('a new file is { configVersion: 1, save } with 2-space indentation and a trailing newline', () => {
    const file = path.join(tmp(), '.lensy', 'config.json');
    writeSaveKey(file, true);
    expect(fs.readFileSync(file, 'utf8')).toBe('{\n  "configVersion": 1,\n  "save": true\n}\n');
  });

  test('every other key, its value and its order are kept; a new save goes last', () => {
    const file = write(path.join(tmp(), 'config.json'), '{"pages":["https://x.com/a"],"mine":{"n":[1,2]},"keep":7}');
    writeSaveKey(file, true);
    const text = fs.readFileSync(file, 'utf8');
    expect(JSON.parse(text)).toEqual({ pages: ['https://x.com/a'], mine: { n: [1, 2] }, keep: 7, save: true });
    expect(Object.keys(JSON.parse(text))).toEqual(['pages', 'mine', 'keep', 'save']);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "pages": [');
  });

  test('an existing save is changed in place', () => {
    const file = write(path.join(tmp(), 'config.json'), '{"save":false,"keep":3,"pages":[]}');
    writeSaveKey(file, true);
    expect(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))).toEqual([['save', true], ['keep', 3], ['pages', []]]);
  });

  test('unknown keys survive', () => {
    const file = write(path.join(tmp(), 'config.json'), '{"configVersion":1,"future":{"a":1}}');
    writeSaveKey(file, false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ configVersion: 1, future: { a: 1 }, save: false });
  });

  test('no temporary file is left behind, and the folder is created', () => {
    const dir = path.join(tmp(), 'deep', '.lensy');
    writeSaveKey(path.join(dir, 'config.json'), true);
    expect(listFiles(dir)).toEqual(['config.json']);
  });

  test('a file that is not a JSON object is refused, and left alone', () => {
    const file = write(path.join(tmp(), 'config.json'), '[1,2]');
    expect(() => writeSaveKey(file, true)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('[1,2]');
  });
});

describe('user settings: ~/.lensy/config.json (Req 2.4, 2.5)', () => {
  test('remembering a no creates the folder with mode 0700 and the file with mode 0600', () => {
    const home = tmp();
    rememberNoSave(home, '/work/a');
    const file = userConfigFile(home);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ configVersion: 1, projects: { '/work/a': { save: false } } });
    expect(fs.readFileSync(file, 'utf8').endsWith('}\n')).toBe(true);
    if (process.platform !== 'win32') {
      expect(modeOf(file)).toBe(0o600);
      expect(modeOf(path.dirname(file))).toBe(0o700);
    }
    expect(listFiles(path.dirname(file))).toEqual(['config.json']); // no .tmp- file
  });

  test('every other key is kept, including other projects and unknown keys', () => {
    const home = tmp();
    write(userConfigFile(home), JSON.stringify({ usage: 'off', installId: 'abc', projects: { '/work/a': { save: false, note: 'x' } }, configVersion: 1 }));
    rememberNoSave(home, '/work/b');
    const out = JSON.parse(fs.readFileSync(userConfigFile(home), 'utf8'));
    expect(out).toEqual({ usage: 'off', installId: 'abc', configVersion: 1, projects: { '/work/a': { save: false, note: 'x' }, '/work/b': { save: false } } });
    expect(Object.keys(out)).toEqual(['usage', 'installId', 'projects', 'configVersion']);
  });

  test('an existing entry for the same root keeps its other keys', () => {
    const home = tmp();
    write(userConfigFile(home), JSON.stringify({ projects: { '/work/a': { note: 'kept' } } }));
    rememberNoSave(home, '/work/a');
    expect(JSON.parse(fs.readFileSync(userConfigFile(home), 'utf8')).projects['/work/a']).toEqual({ note: 'kept', save: false });
  });

  test('an existing file keeps its mode (the atomic write replaces it with a 0600 file)', () => {
    if (process.platform === 'win32') return;
    const home = tmp();
    write(userConfigFile(home), '{}');
    fs.chmodSync(userConfigFile(home), 0o644);
    rememberNoSave(home, '/work/a');
    expect(modeOf(userConfigFile(home))).toBe(0o600);
  });

  test('invalid JSON is ignored on reading, and backed up as config.json.bak before an answer is written', () => {
    const home = tmp();
    write(userConfigFile(home), '{ not json');
    expect(readUserConfig(home)).toEqual({ raw: {}, invalid: true });
    rememberNoSave(home, '/work/a');
    expect(fs.readFileSync(`${userConfigFile(home)}.bak`, 'utf8')).toBe('{ not json');
    expect(JSON.parse(fs.readFileSync(userConfigFile(home), 'utf8')).projects['/work/a']).toEqual({ save: false });
  });

  test('reading never rewrites or backs up an invalid file', () => {
    const home = tmp();
    write(userConfigFile(home), '[1]');
    expect(readUserConfig(home).invalid).toBe(true);
    expect(fs.readFileSync(userConfigFile(home), 'utf8')).toBe('[1]');
    expect(fs.existsSync(`${userConfigFile(home)}.bak`)).toBe(false);
  });

  test('a missing file reads as empty', () => {
    expect(readUserConfig(tmp())).toEqual({ raw: {}, invalid: false });
  });
});
