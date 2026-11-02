// SPDX-License-Identifier: MIT
declare const __LENSY_CLI_VERSION__: string;

// Commands land in task 7.1. Until then the binary only reports its version.
const version = typeof __LENSY_CLI_VERSION__ === 'string' ? __LENSY_CLI_VERSION__ : '0.0.0';
const args = process.argv.slice(2);
if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${version}\n`);
} else {
  process.stdout.write(`lensy ${version}: commands are not available yet.\n`);
  process.exitCode = 2;
}
