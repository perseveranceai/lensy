// The site's page list. site-pages.json is the one place a public page is named:
// the router, header, footer, page metadata, sitemap.xml and llms.txt all read it,
// so they can't drift apart. scripts/prerender.js reads the same JSON.
import pages from "./site-pages.json";

export type PageKind = "page" | "app" | "redirect";
export type PageGroup = "product" | "learn" | "company" | "legal";

export interface SitePage {
  path: string;
  label: string;
  title: string;
  description?: string;
  group?: PageGroup;
  header?: boolean;
  /** "page" is indexable content; "app" is a scanner screen; "redirect" sends you home. */
  kind: PageKind;
  schema?: string;
  /** Date the page's content last changed, YYYY-MM-DD. Feeds dateModified and the sitemap. */
  updated?: string;
}

export const SITE_PAGES = pages as SitePage[];

export const BASE_URL = (process.env.REACT_APP_BASE_URL || "https://perseveranceai.com").replace(/\/$/, "");

export const SITE_NAME = "Lensy by Perseverance AI";

export function pageFor(pathname: string): SitePage | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return SITE_PAGES.find((p) => p.path === path);
}

export const HEADER_PAGES = SITE_PAGES.filter((p) => p.header);

export function pagesInGroup(group: PageGroup): SitePage[] {
  return SITE_PAGES.filter((p) => p.kind === "page" && p.group === group);
}

/** URL of the Markdown copy scripts/prerender.js writes for a page. */
export function markdownPath(path: string): string {
  return path === "/" ? "/index.md" : `${path.replace(/\/+$/, "")}.md`;
}
