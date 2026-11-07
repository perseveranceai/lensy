// SPDX-License-Identifier: MIT
// Where results are saved (Req 1): the project root is found by walking up from
// the current folder. Pure path logic plus existence checks; it never writes.
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** The real path when the folder exists (so a symlinked temp or home folder compares equal), else the resolved path. */
function canon(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

const isFilesystemRoot = (dir: string) => dirname(dir) === dir;

/**
 * Where the walk starts. A folder inside node_modules is never the project root
 * (Req 1.3), so when the current folder is inside one, the walk starts above the
 * outermost node_modules.
 */
function walkStart(dir: string): string {
  let start = dir;
  for (let d = dir; !isFilesystemRoot(d); d = dirname(d)) {
    if (basename(d) === 'node_modules') start = dirname(d);
  }
  return start;
}

/**
 * Req 1.1: the nearest folder with a .lensy folder; else the nearest with .git
 * (a folder or a file, so git worktrees count); else where the walk started.
 * Req 1.2: the home folder and the filesystem root are never chosen by the first
 * two rules (a home folder can hold a dotfiles .git, and ~/.lensy is Lensy's own
 * settings folder, not a project's results).
 */
export function findProjectRoot(cwd: string, home: string): string {
  const start = walkStart(resolve(cwd));
  const homeReal = canon(home);
  const usable = (dir: string) => !isFilesystemRoot(dir) && canon(dir) !== homeReal;
  const nearest = (has: (dir: string) => boolean): string | null => {
    for (let dir = start; ; dir = dirname(dir)) {
      if (usable(dir) && has(dir)) return dir;
      if (isFilesystemRoot(dir)) return null;
    }
  };
  return nearest(d => isDir(join(d, '.lensy'))) ?? nearest(d => existsSync(join(d, '.git'))) ?? start;
}

/** Req 1.4: --save-dir is the results folder itself, relative to the current folder. Otherwise <root>/.lensy. */
export function resultsFolder(root: string, saveDir: string | undefined, cwd: string): string {
  return saveDir !== undefined ? resolve(cwd, saveDir) : join(root, '.lensy');
}
