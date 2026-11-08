// SPDX-License-Identifier: MIT
// Finding the project root (Req 1): .lensy beats .git, the home folder and the
// filesystem root are never chosen by rules 1a/1b, node_modules is skipped, the
// current folder is the fallback, and --save-dir skips discovery.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { findProjectRoot, resultsFolder } from '../src/workspace';
import { useTempDirs } from './helpers';

// Windows has no Unix file modes and needs admin rights for symlinks: tests of those run on macOS and Linux.
const ON_WINDOWS = process.platform === 'win32';

const tmp = useTempDirs();
const mk = (...p: string[]) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };

describe('findProjectRoot', () => {
  test('1a: the nearest folder with a .lensy folder', () => {
    const root = tmp(); const home = tmp();
    mk(root, '.git'); mk(root, 'docs', '.lensy');
    const cwd = mk(root, 'docs', 'guide');
    expect(findProjectRoot(cwd, home)).toBe(path.join(root, 'docs')); // not root, which only has .git
  });

  test('1a beats a nearer .git', () => {
    const root = tmp(); const home = tmp();
    mk(root, '.lensy'); mk(root, 'pkg', '.git');
    expect(findProjectRoot(mk(root, 'pkg', 'src'), home)).toBe(root);
  });

  test('1a needs a folder: a file named .lensy does not count', () => {
    const root = tmp(); const home = tmp();
    mk(root, '.git'); const sub = mk(root, 'sub');
    fs.writeFileSync(path.join(sub, '.lensy'), 'not a folder');
    expect(findProjectRoot(sub, home)).toBe(root);
  });

  test('1b: a .git folder', () => {
    const root = tmp(); const home = tmp();
    mk(root, '.git');
    expect(findProjectRoot(mk(root, 'a', 'b'), home)).toBe(root);
  });

  test('1b: a .git file counts, so git worktrees work', () => {
    const root = tmp(); const home = tmp();
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: /somewhere/else/.git/worktrees/x\n');
    expect(findProjectRoot(mk(root, 'docs'), home)).toBe(root);
  });

  test('1b: the nearest .git wins', () => {
    const root = tmp(); const home = tmp();
    mk(root, '.git'); mk(root, 'sub', '.git');
    expect(findProjectRoot(mk(root, 'sub', 'x'), home)).toBe(path.join(root, 'sub'));
  });

  test('1c: with no marker anywhere, the current folder', () => {
    const home = tmp();
    const cwd = mk(tmp(), 'a', 'b');
    expect(findProjectRoot(cwd, home)).toBe(cwd);
  });

  test('the current folder itself can be the root', () => {
    const root = tmp(); const home = tmp();
    mk(root, '.lensy');
    expect(findProjectRoot(root, home)).toBe(root);
  });

  describe('1.2: never the home folder or the filesystem root', () => {
    test('a .git in the home folder (dotfiles) is skipped: the current folder is used', () => {
      const home = tmp();
      mk(home, '.git');
      const cwd = mk(home, 'work', 'notes');
      expect(findProjectRoot(cwd, home)).toBe(cwd);
    });

    test('~/.lensy (Lensy\'s own settings folder) is not a project\'s results folder', () => {
      const home = tmp();
      mk(home, '.lensy');
      const cwd = mk(home, 'work');
      expect(findProjectRoot(cwd, home)).toBe(cwd);
    });

    test('a project below the home folder is still found', () => {
      const home = tmp();
      mk(home, '.git'); mk(home, 'work', 'proj', '.git');
      expect(findProjectRoot(mk(home, 'work', 'proj', 'docs'), home)).toBe(path.join(home, 'work', 'proj'));
    });

    test('running in the home folder itself uses it (rule 1c)', () => {
      const home = tmp();
      mk(home, '.git');
      expect(findProjectRoot(home, home)).toBe(home);
    });

    test.skipIf(ON_WINDOWS)('the filesystem root is never chosen', () => {
      expect(findProjectRoot(path.parse(process.cwd()).root, tmp())).toBe(path.parse(process.cwd()).root);
      // From a normal folder, the walk reaches the root, finds no marker there, and falls back to the start.
      const cwd = mk(tmp(), 'x');
      expect(findProjectRoot(cwd, tmp())).toBe(cwd);
    });

    test.skipIf(process.platform === 'win32')('a home folder given as a symlink is recognised', () => {
      const real = tmp();
      mk(real, '.git');
      const link = path.join(tmp(), 'home-link');
      fs.symlinkSync(real, link);
      const cwd = mk(real, 'work');
      expect(findProjectRoot(cwd, link)).toBe(cwd);
    });
  });

  describe('1.3: never a folder inside node_modules', () => {
    test('a package with its own .git inside node_modules is skipped', () => {
      const root = tmp(); const home = tmp();
      mk(root, '.git'); mk(root, 'node_modules', 'pkg', '.git');
      expect(findProjectRoot(mk(root, 'node_modules', 'pkg', 'lib'), home)).toBe(root);
    });

    test('a .lensy inside node_modules is skipped too', () => {
      const root = tmp(); const home = tmp();
      mk(root, '.git'); mk(root, 'node_modules', 'pkg', '.lensy');
      expect(findProjectRoot(mk(root, 'node_modules', 'pkg'), home)).toBe(root);
    });

    test('nested node_modules: the walk starts above the outermost one', () => {
      const root = tmp(); const home = tmp();
      mk(root, '.git'); mk(root, 'node_modules', 'a', 'node_modules', 'b', '.git');
      expect(findProjectRoot(mk(root, 'node_modules', 'a', 'node_modules', 'b', 'src'), home)).toBe(root);
    });

    test('with no marker above, the folder above node_modules (never one inside it)', () => {
      const base = mk(tmp(), 'app'); const home = tmp();
      const cwd = mk(base, 'node_modules', 'pkg');
      expect(findProjectRoot(cwd, home)).toBe(base);
    });
  });
});

describe('resultsFolder', () => {
  test('by default <root>/.lensy', () => {
    expect(resultsFolder('/p/root', undefined, '/p/root/docs')).toBe(path.join('/p/root', '.lensy'));
  });
  test('1.4: --save-dir is the folder itself, relative to the current folder', () => {
    expect(resultsFolder('/p/root', 'out/lensy', '/p/root/docs')).toBe(path.join('/p/root/docs', 'out', 'lensy'));
  });
  test('1.4: an absolute --save-dir is used as it is', () => {
    expect(resultsFolder('/p/root', '/elsewhere/results', '/p/root/docs')).toBe(path.resolve('/elsewhere/results'));
  });
});
