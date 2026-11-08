// SPDX-License-Identifier: MIT
// `--all` on a local preview: the pages listed in the preview's sitemap.xml
// (one level of sitemap index followed), each mapped to the local server by
// path. Sitemaps of docs builds list the published domain, so the path is
// what matters here. Lensy never crawls; this reads one file the build wrote.

const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

const locs = (xml: string) => [...xml.matchAll(LOC)].map(m => m[1].replace(/&amp;/g, '&'));

export interface SitemapPages { pages: string[]; otherOrigin?: string }

/**
 * Pages from `<localOrigin><basePath>sitemap.xml`, as local URLs. `otherOrigin`
 * is set when the sitemap lists another domain (the published one), so the
 * caller can suggest --site-url.
 */
export async function sitemapPages(localOrigin: string, basePath: string, fetchImpl: typeof fetch): Promise<SitemapPages> {
  const get = async (url: string): Promise<string | null> => {
    try {
      const r = await fetchImpl(url);
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  };
  const toLocal = (loc: string): string | null => {
    try {
      const u = new URL(loc, localOrigin);
      return `${localOrigin}${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  };
  const root = await get(`${localOrigin}${basePath}sitemap.xml`);
  if (!root) return { pages: [] };
  let entries = locs(root);
  if (/<sitemapindex[\s>]/i.test(root)) {
    const children = await Promise.all(entries.map(loc => (toLocal(loc) ? get(toLocal(loc)!) : Promise.resolve(null))));
    entries = children.flatMap(x => (x ? locs(x) : []));
  }
  const origins = new Set(entries.map(e => { try { return new URL(e).origin; } catch { return ''; } }));
  origins.delete(new URL(localOrigin).origin);
  origins.delete('');
  const pages = [...new Set(entries.map(toLocal).filter((x): x is string => !!x))];
  return { pages, ...(origins.size ? { otherOrigin: [...origins][0] } : {}) };
}
