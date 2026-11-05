// SPDX-License-Identifier: MIT
// Boundary (Req 6.2): the core bundle pulls in only the allowlisted engine
// files from outside packages/, and none of them uses AWS, LangChain, S3 or
// progress helpers, React or process.env.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const REPO = path.resolve(__dirname, '../../..');
const ALLOWED = [
  'backend/lambda/agent-handler/shared/fetch-page.ts',
  'backend/lambda/agent-handler/shared/html-content.ts',
  'backend/lambda/agent-handler/shared/markdown-source.ts',
  'backend/lambda/agent-handler/tools/collect-signals-v2.ts',
  'backend/lambda/agent-handler/tools/source-signals.ts',
  'backend/lambda/agent-handler/tools/scoring-v2.ts',
  'backend/lambda/agent-handler/tools/report-v2.ts',
  'backend/lambda/agent-handler/tools/check-registry.ts',
  'backend/lambda/agent-handler/tools/scoring-afdocs.ts',
  'backend/lambda/agent-handler/tools/afdocs-page.ts',
  'frontend/src/report/report-view.ts',
];
const FORBIDDEN = /@aws-sdk\/|@langchain\/|aws-lambda|s3-helpers|progress-publisher|publish-progress|from ['"]react['"]|process\.env/;

test('every input outside packages/ is an allowlisted engine file, with no forbidden imports', async () => {
  const result = await build({
    entryPoints: [path.join(__dirname, '../src/index.ts')],
    bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', logLevel: 'silent',
  });
  const outside = Object.keys(result.metafile.inputs)
    .map(p => path.relative(REPO, path.resolve(process.cwd(), p)).replace(/\\/g, '/'))
    .filter(p => !p.startsWith('packages/'));
  expect(outside.length).toBeGreaterThan(0);
  for (const file of outside) {
    expect(ALLOWED, `${file} is not an allowlisted engine file`).toContain(file);
    const src = fs.readFileSync(path.join(REPO, file), 'utf8');
    expect(src.startsWith('// SPDX-License-Identifier: MIT'), `${file} needs the MIT header`).toBe(true);
    expect(FORBIDDEN.test(src), `${file} imports something website-only`).toBe(false);
  }
});
