// SPDX-License-Identifier: MIT
// Writing results to disk (Req 4, 8). Every file is written atomically; Lensy only
// ever writes inside the results folder and to ~/.lensy/config.json (Req 8.1).
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Req 8.2: write <name>.tmp-<pid> in the same folder, then rename it over the real
 * file. A crash or Ctrl-C leaves the file either complete or untouched, never half
 * written. `mode` is applied to the new file (0600 for the user settings).
 */
export function writeAtomic(file: string, text: string, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    rmSync(tmp, { force: true }); // a leftover from a killed run: start fresh so `mode` applies
    writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
    throw e;
  }
}

const REASONS: Record<string, string> = {
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  ENOSPC: 'no space left on the disk',
  EDQUOT: 'the disk quota is used up',
  EROFS: 'the disk is read-only',
  ENOTDIR: 'a file is in the way',
  EEXIST: 'a file is in the way',
  EISDIR: 'a folder is in the way',
  EMFILE: 'too many files are open',
  ENAMETOOLONG: 'the path is too long',
};

/** A short reason for an error, without the absolute paths that Node puts in its messages (Req 4.10). */
export function friendlyReason(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (code && REASONS[code]) return REASONS[code];
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/'[^']*'/g, '').replace(/\s{2,}/g, ' ').replace(/[\s,:]+$/, '').trim() || 'unknown error';
}
