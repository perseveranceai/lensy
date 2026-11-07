// SPDX-License-Identifier: MIT
// What happens before any page is checked (Req 2, 3, 6; design "Order of work"):
// the project and its config, the pages, whether to save, the one question, and
// the write test. A usage error here never starts a request.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/main';
import { userConfigFile } from '../src/settings';
import { listFiles, makeIo, makeProject, replayFetch, useTempDirs, vitest } from './helpers';

const tmp = useTempDirs();
const QUESTION = 'Save Lensy results for this project in .lensy? Each run is compared with the last one, so you can see what changed. [Y/n] ';
const f = vitest();
const URL1 = f.expected.url;

/** A fetch that replays the fixture and records the URLs asked for, and what stderr held at the first request. */
function spy(errAtFirst: () => string) {
  const replay = replayFetch(f.entries);
  const calls: string[] = [];
  let stderrAtFirstRequest: string | null = null;
  const impl = (async (input: any, init?: RequestInit) => {
    if (stderrAtFirstRequest === null) stderrAtFirstRequest = errAtFirst();
    calls.push(String(input));
    return replay(input, init);
  }) as typeof fetch;
  return { impl, calls, stderrAtFirstRequest: () => stderrAtFirstRequest };
}

function setup(opts: { interactive?: boolean; answers?: string[]; env?: Record<string, string>; cwd?: (root: string) => string } = {}) {
  const { root, home } = makeProject(tmp);
  const cwd = opts.cwd ? opts.cwd(root) : root;
  fs.mkdirSync(cwd, { recursive: true });
  let t!: ReturnType<typeof makeIo>;
  const s = spy(() => t.err());
  t = makeIo({ cwd, home, fetchImpl: s.impl, interactive: opts.interactive, answers: opts.answers, env: opts.env });
  return { root, home, cwd, t, s, lensy: () => path.join(root, '.lensy') };
}

describe('the first-run question (Req 2)', () => {
  test('asked on stderr before any request; "y" creates .lensy/config.json with save:true', async () => {
    const x = setup({ interactive: true, answers: ['y'] });
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.ok);
    expect(x.t.err()).toContain(QUESTION);
    expect(x.t.out()).not.toContain('Save Lensy results'); // stderr only
    expect(x.s.stderrAtFirstRequest()).toBe(QUESTION); // asked, and answered, before the first request
    expect(JSON.parse(fs.readFileSync(path.join(x.lensy(), 'config.json'), 'utf8'))).toEqual({ configVersion: 1, save: true });
    expect(listFiles(x.lensy())).toEqual(['config.json']); // the write test left nothing behind
    expect(fs.existsSync(userConfigFile(x.home))).toBe(false); // a yes is remembered in the project, not in the user settings
  });

  test.each([[''], ['yes'], ['Y']])('%j is yes too', async (answer) => {
    const x = setup({ interactive: true, answers: [answer] });
    await run(['check', URL1], x.t.io);
    expect(JSON.parse(fs.readFileSync(path.join(x.lensy(), 'config.json'), 'utf8')).save).toBe(true);
  });

  test('"n" is remembered in ~/.lensy/config.json for this project root, and creates nothing in the project', async () => {
    const x = setup({ interactive: true, answers: ['n'] });
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.ok);
    expect(x.t.out()).toMatch(/Coding agents \d+\/100/); // checking went on
    expect(fs.existsSync(x.lensy())).toBe(false);
    expect(JSON.parse(fs.readFileSync(userConfigFile(x.home), 'utf8'))).toEqual({ configVersion: 1, projects: { [x.root]: { save: false } } });
    if (process.platform !== 'win32') {
      expect(fs.statSync(userConfigFile(x.home)).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(userConfigFile(x.home))).mode & 0o700).toBe(0o700);
    }
  });

  test('after a remembered no, the question is never asked again', async () => {
    const x = setup({ interactive: true, answers: ['n'] });
    await run(['check', URL1], x.t.io);
    const second = makeIo({ cwd: x.cwd, home: x.home, fetchImpl: replayFetch(f.entries), interactive: true, answers: ['y'] });
    expect(await run(['check', URL1], second.io)).toBe(EXIT.ok);
    expect(second.err()).toBe('');
    expect(fs.existsSync(x.lensy())).toBe(false);
  });

  test('a remembered no applies to that project only', async () => {
    const x = setup({ interactive: true, answers: ['n'] });
    await run(['check', URL1], x.t.io);
    const other = makeProject(tmp);
    const t = makeIo({ cwd: other.root, home: x.home, fetchImpl: replayFetch(f.entries), interactive: true, answers: ['y'] });
    await run(['check', URL1], t.io);
    expect(t.err()).toContain(QUESTION);
    expect(fs.existsSync(path.join(other.root, '.lensy', 'config.json'))).toBe(true);
  });

  test('a project config with save:true is read on the next run: no question', async () => {
    const x = setup({ interactive: true, answers: ['y'] });
    await run(['check', URL1], x.t.io);
    const second = makeIo({ cwd: x.cwd, home: x.home, fetchImpl: replayFetch(f.entries), interactive: true, answers: ['n'] });
    await run(['check', URL1], second.io);
    expect(second.err()).toBe('');
  });

  test('two invalid answers: no for this run only, nothing remembered, and checking goes on', async () => {
    const x = setup({ interactive: true, answers: ['maybe', 'later'] });
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.ok);
    expect(x.t.out()).toMatch(/Coding agents \d+\/100/);
    expect(fs.existsSync(x.lensy())).toBe(false);
    expect(fs.existsSync(userConfigFile(x.home))).toBe(false);
    // The next run asks again.
    const again = makeIo({ cwd: x.cwd, home: x.home, fetchImpl: replayFetch(f.entries), interactive: true, answers: ['n'] });
    await run(['check', URL1], again.io);
    expect(again.err()).toContain(QUESTION);
  });

  test('stdin closed at the question: no for this run, nothing remembered, checking goes on', async () => {
    const x = setup({ interactive: true, answers: [] });
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.ok);
    expect(x.t.out()).toMatch(/Coding agents \d+\/100/);
    expect(fs.existsSync(x.lensy())).toBe(false);
    expect(fs.existsSync(userConfigFile(x.home))).toBe(false);
  });

  test('a path in the question is relative to the current folder', async () => {
    const x = setup({ interactive: true, answers: ['n'], cwd: root => path.join(root, 'docs', 'guide') });
    await run(['check', URL1], x.t.io);
    expect(x.t.err()).toContain('in ../../.lensy?');
    expect(x.t.err()).not.toContain(x.root);
  });
});

describe('never asked (Req 2.6, 3.1)', () => {
  test('not interactive', async () => {
    const x = setup({ interactive: false, answers: ['y'] });
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.ok);
    expect(x.t.err()).toBe('');
    expect(fs.existsSync(x.lensy())).toBe(false);
    expect(fs.existsSync(userConfigFile(x.home))).toBe(false);
  });

  test.each([['1'], ['true'], ['yes']])('CI=%s', async (ci) => {
    const x = setup({ interactive: true, answers: ['y'], env: { CI: ci } });
    await run(['check', URL1], x.t.io);
    expect(x.t.err()).toBe('');
    expect(fs.existsSync(x.lensy())).toBe(false);
  });

  test('an empty CI variable counts as unset', async () => {
    const x = setup({ interactive: true, answers: ['n'], env: { CI: '' } });
    await run(['check', URL1], x.t.io);
    expect(x.t.err()).toContain(QUESTION);
  });

  test('--json - : JSON only on stdout, no question', async () => {
    const x = setup({ interactive: true, answers: ['y'] });
    expect(await run(['check', URL1, '--json', '-'], x.t.io)).toBe(EXIT.ok);
    expect(x.t.err()).toBe('');
    expect(JSON.parse(x.t.out()).pages[0].url).toBe(URL1);
    expect(fs.existsSync(x.lensy())).toBe(false);
  });

  test.each([[['--no-save']], [['--save']], [['--save-dir', 'results']]])('%j', async (flags) => {
    const x = setup({ interactive: true, answers: ['y'] });
    await run(['check', URL1, ...flags], x.t.io);
    expect(x.t.err()).toBe('');
  });

  test('--no-save remembers nothing and creates nothing', async () => {
    const x = setup({ interactive: true, answers: ['y'] });
    await run(['check', URL1, '--no-save'], x.t.io);
    expect(fs.existsSync(x.lensy())).toBe(false);
    expect(fs.existsSync(userConfigFile(x.home))).toBe(false);
  });

  test('project config with save:false or save:true', async () => {
    for (const save of [false, true]) {
      const x = setup({ interactive: true, answers: ['y'] });
      fs.mkdirSync(x.lensy());
      fs.writeFileSync(path.join(x.lensy(), 'config.json'), JSON.stringify({ save }));
      await run(['check', URL1], x.t.io);
      expect(x.t.err()).toBe('');
    }
  });

  test('a remembered no in the user settings', async () => {
    const x = setup({ interactive: true, answers: ['y'] });
    fs.mkdirSync(path.dirname(userConfigFile(x.home)), { recursive: true });
    fs.writeFileSync(userConfigFile(x.home), JSON.stringify({ projects: { [x.root]: { save: false } } }));
    await run(['check', URL1], x.t.io);
    expect(x.t.err()).toBe('');
  });
});

describe('--save and --save-dir create the results folder, and only it', () => {
  test('--save: .lensy is created, empty (the write test leaves nothing), and nothing is asked or remembered', async () => {
    const x = setup({ interactive: false });
    expect(await run(['check', URL1, '--save'], x.t.io)).toBe(EXIT.ok);
    expect(fs.statSync(x.lensy()).isDirectory()).toBe(true);
    expect(listFiles(x.lensy())).toEqual([]);
    expect(fs.existsSync(userConfigFile(x.home))).toBe(false);
  });

  test('--save-dir is relative to the current folder and is the results folder itself', async () => {
    const x = setup({ cwd: root => path.join(root, 'docs') });
    expect(await run(['check', URL1, '--save-dir', 'out/lensy'], x.t.io)).toBe(EXIT.ok);
    expect(fs.statSync(path.join(x.cwd, 'out', 'lensy')).isDirectory()).toBe(true);
    expect(fs.existsSync(x.lensy())).toBe(false);
  });

  test('the project config is read from the --save-dir folder', async () => {
    const x = setup();
    const dir = path.join(x.root, 'out');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ pages: [URL1] }));
    expect(await run(['check', '--save-dir', 'out'], x.t.io)).toBe(EXIT.ok);
    expect(x.s.calls.some(u => u.startsWith(new URL(URL1).origin))).toBe(true);
  });
});

describe("can't save: exit 2 before any request (Req 3.3)", () => {
  test.each([[['--save']], [['--save-dir', '.lensy']]])('a file where the results folder should be: %j', async (flags) => {
    const x = setup();
    fs.writeFileSync(x.lensy(), 'a file');
    expect(await run(['check', URL1, ...flags], x.t.io)).toBe(EXIT.usage);
    expect(x.t.err()).toBe("Can't save results in .lensy: a file is in the way.\n");
    expect(x.s.calls).toEqual([]);
    expect(fs.readFileSync(x.lensy(), 'utf8')).toBe('a file');
  });

  test('also after a "y" at the question: nothing is remembered', async () => {
    const x = setup({ interactive: true, answers: ['y'] });
    fs.writeFileSync(x.lensy(), 'a file');
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.usage);
    expect(x.t.err()).toContain("Can't save results in .lensy: a file is in the way.");
    expect(x.s.calls).toEqual([]);
    expect(fs.existsSync(userConfigFile(x.home))).toBe(false);
  });

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a read-only parent: permission denied, with no absolute path in the message', async () => {
    const x = setup();
    fs.chmodSync(x.root, 0o555);
    try {
      expect(await run(['check', URL1, '--save'], x.t.io)).toBe(EXIT.usage);
    } finally {
      fs.chmodSync(x.root, 0o755);
    }
    expect(x.t.err()).toBe("Can't save results in .lensy: permission denied.\n");
    expect(x.t.err()).not.toContain(x.root);
    expect(x.s.calls).toEqual([]);
  });

  test('--no-save never touches the folder, so it works even when saving would fail', async () => {
    const x = setup();
    fs.writeFileSync(x.lensy(), 'a file');
    expect(await run(['check', URL1, '--no-save'], x.t.io)).toBe(EXIT.ok);
  });
});

describe('pages in .lensy/config.json (Req 6.2-6.4)', () => {
  const withConfig = (config: unknown, opts: Parameters<typeof setup>[0] = {}) => {
    const x = setup(opts);
    fs.mkdirSync(x.lensy(), { recursive: true });
    fs.writeFileSync(path.join(x.lensy(), 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
    return x;
  };

  test('with no URLs and no --urls-file, the pages from the config are checked', async () => {
    const x = withConfig({ pages: [URL1] });
    expect(await run(['check'], x.t.io)).toBe(EXIT.ok);
    expect(x.t.out()).toContain(URL1);
    expect(x.s.calls.length).toBeGreaterThan(0);
  });

  test('a bare hostname in the list works like one on the command line', async () => {
    const x = withConfig({ pages: ['docs.example.com/guide'] });
    await run(['check'], x.t.io);
    expect(x.s.calls[0]).toMatch(/^https:\/\/docs\.example\.com\//);
  });

  test('URLs on the command line replace the list, and the config file is not changed', async () => {
    const config = '{\n  "pages": ["https://other.example.com/a"],\n  "keep": 9\n}\n';
    const x = withConfig(config);
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.ok);
    expect(x.s.calls.every(u => !u.includes('other.example.com'))).toBe(true);
    expect(fs.readFileSync(path.join(x.lensy(), 'config.json'), 'utf8')).toBe(config);
  });

  test('--urls-file replaces the list too', async () => {
    const x = withConfig({ pages: ['https://other.example.com/a'] });
    const file = path.join(x.root, 'urls.txt');
    fs.writeFileSync(file, `${URL1}\n`);
    await run(['check', '--urls-file', file], x.t.io);
    expect(x.s.calls.every(u => !u.includes('other.example.com'))).toBe(true);
    expect(x.t.out()).toContain(URL1);
  });

  test('the config is found from a subfolder, and its path in a message is relative to where you are', async () => {
    const x = withConfig({ keep: 0 }, { cwd: root => path.join(root, 'docs', 'guide') });
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.usage);
    expect(x.t.err()).toBe('../../.lensy/config.json: "keep" must be a whole number from 1 to 1000.\n');
  });

  test('no URLs and no pages: exit 2 with the existing message and the hint', async () => {
    for (const config of [null, { keep: 3 }, { pages: [] }]) {
      const x = config ? withConfig(config) : setup();
      expect(await run(['check'], x.t.io)).toBe(EXIT.usage);
      expect(x.t.err()).toBe('Give at least one URL, for example: lensy check https://docs.example.com/guide\nOr list pages in .lensy/config.json under "pages".\n');
      expect(x.s.calls).toEqual([]);
    }
  });

  test.each([
    ['not json', '.lensy/config.json: not valid JSON'],
    ['{"keep": 1001}', '.lensy/config.json: "keep" must be a whole number from 1 to 1000.'],
    ['{"save": "yes"}', '.lensy/config.json: "save" must be true or false.'],
    ['{"pages": "https://x.com/"}', '.lensy/config.json: "pages" must be a list of page URLs, each in quotes.'],
    ['[]', '.lensy/config.json: must be a JSON object.'],
  ])('%s: exit 2 naming the file, before any request', async (config, message) => {
    const x = withConfig(config);
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.usage);
    expect(x.t.err()).toContain(message);
    expect(x.s.calls).toEqual([]);
  });

  test('an invalid config stops the run even with --no-save', async () => {
    const x = withConfig('{"keep": 0}');
    expect(await run(['check', URL1, '--no-save'], x.t.io)).toBe(EXIT.usage);
    expect(x.s.calls).toEqual([]);
  });

  test('a bad entry in pages names the entry; nothing is requested', async () => {
    const x = withConfig({ pages: [URL1, 'ftp://files.example.com/x'] });
    expect(await run(['check'], x.t.io)).toBe(EXIT.usage);
    expect(x.t.err()).toBe('.lensy/config.json: in "pages", "ftp://files.example.com/x" isn\'t an http or https URL.\n');
    expect(x.s.calls).toEqual([]);
  });

  test('a local address in pages is refused like one on the command line', async () => {
    const x = withConfig({ pages: ['http://localhost:3000/'] });
    expect(await run(['check'], x.t.io)).toBe(EXIT.usage);
    expect(x.t.err()).toContain('is a local address');
  });

  test('unknown keys: one warning on stderr, then the run goes on', async () => {
    const x = withConfig({ pages: [URL1], colour: 'red', extra: 1 });
    expect(await run(['check'], x.t.io)).toBe(EXIT.ok);
    expect(x.t.err()).toBe('.lensy/config.json: ignoring unknown keys: colour, extra.\n');
    const one = withConfig({ pages: [URL1], colour: 'red' });
    await run(['check'], one.t.io);
    expect(one.t.err()).toBe('.lensy/config.json: ignoring unknown key: colour.\n');
  });
});

describe('the user settings file', () => {
  test("invalid JSON is ignored with one warning, and the run goes on", async () => {
    const x = setup();
    fs.mkdirSync(path.dirname(userConfigFile(x.home)), { recursive: true });
    fs.writeFileSync(userConfigFile(x.home), '{ nope');
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.ok);
    expect(x.t.err()).toBe("~/.lensy/config.json isn't valid JSON, so Lensy ignores it.\n");
  });

  test('a "n" answer with an invalid file backs it up first', async () => {
    const x = setup({ interactive: true, answers: ['n'] });
    fs.mkdirSync(path.dirname(userConfigFile(x.home)), { recursive: true });
    fs.writeFileSync(userConfigFile(x.home), '{ nope');
    await run(['check', URL1], x.t.io);
    expect(fs.readFileSync(`${userConfigFile(x.home)}.bak`, 'utf8')).toBe('{ nope');
    expect(JSON.parse(fs.readFileSync(userConfigFile(x.home), 'utf8')).projects[x.root]).toEqual({ save: false });
  });

  test("if the answer can't be remembered, the run says so and goes on", async () => {
    const x = setup({ interactive: true, answers: ['n'] });
    fs.writeFileSync(path.join(x.home, '.lensy'), 'a file'); // ~/.lensy can't be created
    expect(await run(['check', URL1], x.t.io)).toBe(EXIT.ok);
    expect(x.t.err()).toContain("Couldn't remember your answer: ");
    expect(x.t.out()).toMatch(/Coding agents \d+\/100/);
  });
});
