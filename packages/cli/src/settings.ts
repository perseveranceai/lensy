// SPDX-License-Identifier: MIT
// Project settings (<results>/config.json, Req 6) and the user settings that
// remember a "no" (~/.lensy/config.json, Req 2.4-2.5), plus the rules for whether
// a run saves (Req 3.1). Lensy only ever adds or changes the `save` key of an
// existing project config, keeping every other key and its order (Req 6.5).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeAtomic } from './store';

export const DEFAULT_KEEP = 52;

export interface ProjectConfig {
  configVersion?: number;
  save?: boolean;
  keep?: number;
  pages?: string[];
}

/** The message is final and names the file: the CLI exits 2 with it, before checking anything. */
export class ConfigError extends Error {}

const KNOWN_KEYS = ['configVersion', 'save', 'keep', 'pages'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const wholeNumber = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Reads and validates a project config (Req 6.1, 6.4). A missing file is fine
 * (null). `display` is the path as shown to the user, relative to the current folder.
 */
export function readProjectConfig(file: string, display: string): { config: ProjectConfig | null; unknownKeys: string[] } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    // ENOTDIR: the results folder is a file, so there is no config in it. Saving then says so (Req 3.3).
    if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return { config: null, unknownKeys: [] };
    throw new ConfigError(`${display}: can't read it (${(e as NodeJS.ErrnoException).code === 'EISDIR' ? 'it is a folder' : 'permission or disk problem'}).`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${display}: not valid JSON (${(e as Error).message}).`);
  }
  if (!isObject(raw)) throw new ConfigError(`${display}: must be a JSON object.`);
  const bad = (what: string) => new ConfigError(`${display}: ${what}`);
  if ('configVersion' in raw && !wholeNumber(raw.configVersion, 1, Number.MAX_SAFE_INTEGER)) throw bad('"configVersion" must be a whole number, 1 or more.');
  if ('save' in raw && typeof raw.save !== 'boolean') throw bad('"save" must be true or false.');
  if ('keep' in raw && !wholeNumber(raw.keep, 1, 1000)) throw bad('"keep" must be a whole number from 1 to 1000.');
  if ('pages' in raw && !(Array.isArray(raw.pages) && raw.pages.every(p => typeof p === 'string'))) throw bad('"pages" must be a list of page URLs, each in quotes.');
  return {
    config: {
      ...('configVersion' in raw ? { configVersion: raw.configVersion as number } : {}),
      ...('save' in raw ? { save: raw.save as boolean } : {}),
      ...('keep' in raw ? { keep: raw.keep as number } : {}),
      ...('pages' in raw ? { pages: raw.pages as string[] } : {}),
    },
    unknownKeys: Object.keys(raw).filter(k => !KNOWN_KEYS.includes(k)),
  };
}

/**
 * Req 6.5: adds or changes only the `save` key. Other keys keep their values and
 * their order; a new `save` goes last. A new file is { configVersion: 1, save }.
 * 2-space indentation and a trailing newline.
 */
export function writeSaveKey(file: string, value: boolean): void {
  let obj: Record<string, unknown> = { configVersion: 1 };
  if (existsSync(file)) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isObject(parsed)) throw new Error('the config file is not a JSON object');
    obj = parsed;
  }
  obj.save = value;
  writeAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

// ---- user settings: ~/.lensy/config.json -------------------------------------

export interface UserConfig {
  /** every key in the file, kept when it is rewritten */
  raw: Record<string, unknown>;
  /** the file exists but isn't a JSON object: ignored, and backed up before an answer is written */
  invalid: boolean;
}

export const userConfigFile = (home: string) => join(home, '.lensy', 'config.json');

export function readUserConfig(home: string): UserConfig {
  let text: string;
  try { text = readFileSync(userConfigFile(home), 'utf8'); } catch { return { raw: {}, invalid: false }; }
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? { raw: parsed, invalid: false } : { raw: {}, invalid: true };
  } catch {
    return { raw: {}, invalid: true };
  }
}

/** What the user settings remember about this project root: `false` for a saved "no", else undefined (Req 3.1e). */
export function rememberedSave(user: UserConfig, root: string): boolean | undefined {
  const projects = user.raw.projects;
  if (!isObject(projects)) return undefined;
  const entry = projects[root];
  return isObject(entry) && entry.save === false ? false : undefined;
}

/**
 * Req 2.4-2.5: remember "no" for this project root. Keeps every other key, writes
 * the file with mode 0600 and a new folder with mode 0700, atomically. An invalid
 * file is copied to config.json.bak first, so nothing the user wrote is lost.
 */
export function rememberNoSave(home: string, root: string): void {
  const file = userConfigFile(home);
  const user = readUserConfig(home);
  if (user.invalid) copyFileSync(file, `${file}.bak`);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const next: Record<string, unknown> = { ...user.raw };
  if (next.configVersion === undefined) next.configVersion = 1;
  const projects = isObject(next.projects) ? { ...next.projects } : {};
  projects[root] = { ...(isObject(projects[root]) ? (projects[root] as Record<string, unknown>) : {}), save: false };
  next.projects = projects;
  writeAtomic(file, JSON.stringify(next, null, 2) + '\n', 0o600);
}

// ---- whether this run saves (Req 3.1) ----------------------------------------

export type SaveDecision = 'save' | 'skip' | 'ask';

/**
 * The rules of Req 3.1, in order. `ask` only when interactive and the JSON isn't
 * going to stdout; a run that can't ask doesn't save.
 */
export function decideSave(
  flags: { save?: boolean; saveDir?: string; noSave?: boolean },
  project: ProjectConfig | null,
  user: UserConfig,
  root: string,
  interactive: boolean,
  jsonToStdout: boolean,
): SaveDecision {
  if (flags.noSave) return 'skip'; // a: beats everything below
  if (flags.save || flags.saveDir !== undefined) return 'save'; // b
  if (project?.save === false) return 'skip'; // c
  if (project?.save === true) return 'save'; // d
  if (rememberedSave(user, root) === false) return 'skip'; // e
  if (interactive && !jsonToStdout) return 'ask'; // f
  return 'skip'; // g
}
