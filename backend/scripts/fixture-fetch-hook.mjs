// Preload hook that records or replays every fetch() a script makes.
// Used by capture-fixtures.mjs to save what the scoring prototype saw, and to
// re-run the prototype offline against those saved responses.
//
//   FIXTURE_MODE=record FIXTURE_FILE=<path>.json.gz node --import ./fixture-fetch-hook.mjs <script> ...
//   FIXTURE_MODE=replay FIXTURE_FILE=<path>.json.gz node --import ./fixture-fetch-hook.mjs <script> ...
//
// A fixture file is gzipped JSON: { capturedAt, entries: [{ method, url, accept, ua,
// status, finalUrl, headers, body, error? }] }. Replay looks an entry up by
// method + URL + Accept, then by method + URL; a request with no entry fails
// like a network error and is listed on stderr, so a divergence is visible.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fixtureKey, findEntry, entryToResponse } from './fixture-replay.mjs';

const mode = process.env.FIXTURE_MODE;
const file = process.env.FIXTURE_FILE;

if (mode === 'record') {
  const realFetch = globalThis.fetch;
  const entries = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers || {});
    const method = (init.method || 'GET').toUpperCase();
    const base = { method, url, accept: headers.get('accept') || '', ua: headers.get('user-agent') || '' };
    try {
      const res = await realFetch(input, init);
      const body = method === 'HEAD' ? '' : await res.text();
      const h = {};
      res.headers.forEach((v, k) => { h[k] = v; });
      entries.push({ ...base, status: res.status, finalUrl: res.url || url, headers: h, body });
      return entryToResponse({ status: res.status, finalUrl: res.url || url, headers: h, body }, method);
    } catch (e) {
      entries.push({ ...base, error: String(e && e.message || e) });
      throw e;
    }
  };
  process.on('exit', () => {
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ capturedAt: new Date().toISOString(), entries })));
  });
} else if (mode === 'replay') {
  const { entries } = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers || {});
    const method = (init.method || 'GET').toUpperCase();
    const entry = findEntry(entries, method, url, headers.get('accept') || '', headers.get('user-agent') || '');
    if (!entry) {
      process.stderr.write(`fixture miss: ${fixtureKey(method, url, headers.get('accept') || '')}\n`);
      throw new TypeError('fetch failed (no fixture)');
    }
    if (entry.error) throw new TypeError(entry.error);
    return entryToResponse(entry, method);
  };
}
