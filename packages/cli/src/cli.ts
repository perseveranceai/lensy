// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { run } from './main';

declare const __LENSY_CLI_VERSION__: string;
const version = typeof __LENSY_CLI_VERSION__ === 'string' ? __LENSY_CLI_VERSION__ : '0.0.0';

// Interactive: stdin and stdout are both terminals. Only then is stdin handed over,
// so a run in a pipe or a CI job never touches it.
const isInteractive = !!process.stdin.isTTY && !!process.stdout.isTTY;

run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  version,
  cwd: process.cwd(),
  home: homedir(),
  isInteractive,
  stdin: isInteractive ? process.stdin : undefined,
})
  .then(code => { process.exitCode = code; })
  .catch(e => {
    process.stderr.write(`lensy: ${(e as Error).message}\n`);
    if (process.env.LENSY_DEBUG === '1') process.stderr.write(`${(e as Error).stack}\n`);
    process.exitCode = 1;
  });
