// SPDX-License-Identifier: MIT
import { run } from './main';

declare const __LENSY_CLI_VERSION__: string;
const version = typeof __LENSY_CLI_VERSION__ === 'string' ? __LENSY_CLI_VERSION__ : '0.0.0';

run(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, env: process.env, version })
  .then(code => { process.exitCode = code; })
  .catch(e => {
    process.stderr.write(`lensy: ${(e as Error).message}\n`);
    if (process.env.LENSY_DEBUG === '1') process.stderr.write(`${(e as Error).stack}\n`);
    process.exitCode = 1;
  });
