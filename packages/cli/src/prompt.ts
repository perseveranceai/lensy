// SPDX-License-Identifier: MIT
// The first-run question (Req 2). Written to stderr, answered on stdin. Built on
// node:readline, with no extra dependency.
import { createInterface } from 'node:readline';

export interface PromptIo {
  stdin?: NodeJS.ReadableStream;
  stderr: { write(s: string): unknown };
}

/**
 * true = yes, false = no (both are remembered by the caller).
 * null = no for this run only, not remembered: stdin closed or no stdin, Ctrl-C,
 * or two answers that were neither yes nor no (Req 2.2-2.3).
 *
 * Empty, `y` and `yes` (any case) are yes; `n` and `no` are no. Anything else is
 * asked once more.
 */
export async function askYesNo(io: PromptIo, question: string): Promise<boolean | null> {
  if (!io.stdin) return null;
  const rl = createInterface({ input: io.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  // Ctrl-C at the question means "not now": keep going without saving. Only while the
  // question is open; the next Ctrl-C stops the run as usual.
  let interrupt!: () => void;
  const interrupted = new Promise<'interrupted'>(resolve => { interrupt = () => resolve('interrupted'); });
  process.once('SIGINT', interrupt);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      io.stderr.write(attempt === 0 ? `${question} ` : `Please answer y or n. ${question} `);
      const next = await Promise.race([lines.next(), interrupted]);
      if (next === 'interrupted' || next.done) {
        io.stderr.write('\n');
        return null;
      }
      const answer = String(next.value).trim().toLowerCase();
      if (answer === '' || answer === 'y' || answer === 'yes') return true;
      if (answer === 'n' || answer === 'no') return false;
    }
    return null;
  } finally {
    process.removeListener('SIGINT', interrupt);
    rl.close();
  }
}
