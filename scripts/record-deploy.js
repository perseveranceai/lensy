#!/usr/bin/env node
/**
 * Writes a deploy record to the LensyDeploymentDecisions table.
 *
 * The full record is stored as one JSON string attribute, with a handful of
 * scalars promoted to top level for filtering. At the volume this table sees
 * (~150 rows/year) a scan-and-parse is entirely adequate, and keeping the body
 * opaque means the record schema can evolve without a migration.
 *
 * Shells out to the AWS CLI rather than taking an SDK dependency — scripts/ has
 * no package.json, and the CLI is present on GitHub runners.
 *
 * Usage:
 *   node scripts/record-deploy.js --phase features --file record.json
 *   node scripts/record-deploy.js --phase decision --deploy-id <id> \
 *        --mode manual --approved-by drpasupuleti
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

const TABLE = process.env.DECISIONS_TABLE || 'LensyDeploymentDecisions';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function aws(args) {
  return execFileSync('aws', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function writeFeatures() {
  const record = JSON.parse(fs.readFileSync(arg('file'), 'utf8'));

  const item = {
    deployId: { S: record.deployId },
    createdAt: { S: new Date().toISOString() },
    env: { S: record.env || 'unknown' },
    commitSha: { S: record.commitSha || '' },
    verdict: { S: (record.classifier && record.classifier.verdict) || 'unknown' },
    wouldAutoPromote: { BOOL: Boolean(record.classifier && record.classifier.wouldAutoPromote) },
    outcomeLabel: { S: 'pending' },
    record: { S: JSON.stringify(record) },
  };

  aws(['dynamodb', 'put-item', '--table-name', TABLE, '--item', JSON.stringify(item)]);
  console.log(`recorded features for ${record.deployId} (verdict: ${item.verdict.S})`);
}

function writeDecision() {
  const deployId = arg('deploy-id');
  if (!deployId) throw new Error('--deploy-id is required for phase=decision');

  const decision = {
    mode: arg('mode', 'manual'),
    approvedBy: arg('approved-by', 'unknown'),
    approvalLatencySec: Number(arg('latency', '0')) || 0,
    rejected: arg('rejected', 'false') === 'true',
    recordedAt: new Date().toISOString(),
  };

  aws([
    'dynamodb', 'update-item',
    '--table-name', TABLE,
    '--key', JSON.stringify({ deployId: { S: deployId } }),
    '--update-expression', 'SET decision = :d',
    '--expression-attribute-values', JSON.stringify({ ':d': { S: JSON.stringify(decision) } }),
  ]);
  console.log(`recorded decision for ${deployId} (${decision.mode} by ${decision.approvedBy})`);
}

try {
  const phase = arg('phase', 'features');
  if (phase === 'features') writeFeatures();
  else if (phase === 'decision') writeDecision();
  else throw new Error(`unknown phase: ${phase}`);
} catch (err) {
  // A logging failure must never fail a deploy that otherwise succeeded.
  console.error(`record-deploy: ${err.message}`);
  process.exit(0);
}
