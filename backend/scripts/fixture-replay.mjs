// Shared by fixture-fetch-hook.mjs: how a saved fixture entry is found and
// turned back into a Response. The Jest tests use the same rules
// (lambda/agent-handler/tools/__tests__/replay.ts).
export const fixtureKey = (method, url, accept) => `${method} ${url} [${accept}]`;

const HONEST = /^Lensy\//;

export function findEntry(entries, method, url, accept, ua) {
  const same = entries.filter(e => e.method === method && e.url === url);
  const exact = same.filter(e => e.accept === accept);
  const pool = exact.length ? exact : same;
  if (!pool.length) return null;
  // The same request can be saved twice: honest user agent, then the browser
  // fallback. Prefer the one sent with the same kind of user agent.
  return pool.find(e => HONEST.test(e.ua) === HONEST.test(ua)) || pool[0];
}

export function entryToResponse(entry, method) {
  const nullBody = method === 'HEAD' || [101, 204, 205, 304].includes(entry.status);
  const res = new Response(nullBody ? null : entry.body, { status: entry.status, headers: entry.headers });
  Object.defineProperty(res, 'url', { value: entry.finalUrl });
  return res;
}
