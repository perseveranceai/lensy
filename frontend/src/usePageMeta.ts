// Sets the <head> for the current page: title, description, canonical, Open Graph,
// robots, the Markdown alternate and the page's JSON-LD. scripts/prerender.js
// saves the result into each page's static HTML, so crawlers that don't run
// JavaScript get the same head as a browser.
import { useEffect } from "react";
import { BASE_URL, SITE_NAME, markdownPath } from "./site";

export interface Crumb { name: string; path: string }

export interface PageMeta {
  path: string;
  title: string;
  description?: string;
  noindex?: boolean;
  /** schema.org type of the page: WebPage, CollectionPage, ContactPage, TechArticle, or SoftwareApplication (a WebPage about Lensy). */
  schema?: string;
  updated?: string;
  published?: string;
  breadcrumb?: Crumb[];
  /** Whether scripts/prerender.js writes a Markdown copy of this page. */
  markdown?: boolean;
}

const ORG = { "@type": "Organization", name: "Perseverance AI", url: "https://perseveranceai.com" };

function absolute(path: string) {
  return path === "/" ? `${BASE_URL}/` : `${BASE_URL}${path}`;
}

function setMeta(attr: "name" | "property", key: string, content: string | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content === undefined) { el?.remove(); return; }
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute("content", content);
}

function setLink(selector: string, attrs: Record<string, string> | null) {
  let el = document.head.querySelector<HTMLLinkElement>(selector);
  if (!attrs) { el?.remove(); return; }
  if (!el) { el = document.createElement("link"); document.head.appendChild(el); }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

function jsonLd(meta: PageMeta, url: string) {
  const crumbs = meta.breadcrumb ?? [];
  const page: Record<string, unknown> = {
    "@type": meta.schema === "SoftwareApplication" ? "WebPage" : meta.schema || "WebPage",
    "@id": `${url}#page`,
    url,
    name: meta.title,
    description: meta.description,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${BASE_URL}/` },
    publisher: ORG,
  };
  if (meta.updated) page.dateModified = meta.updated;
  if (meta.published) page.datePublished = meta.published;
  if (meta.schema === "TechArticle") {
    page.headline = meta.title;
    page.author = ORG;
  }
  if (meta.schema === "SoftwareApplication") {
    page.about = {
      "@type": "SoftwareApplication",
      name: meta.path === "/docs/cli" ? "Lensy command line tool" : "Lensy",
      applicationCategory: "DeveloperApplication",
      operatingSystem: meta.path === "/docs/cli" ? "Linux, macOS, Windows (Node 22 or newer)" : "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      provider: ORG,
    };
  }
  const graph: unknown[] = [page];
  if (crumbs.length) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absolute(c.path) })),
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

/** Writes the head tags for `meta`. Pass null to leave the head to a child route. */
export function usePageMeta(meta: PageMeta | null) {
  const key = meta ? JSON.stringify(meta) : "";
  useEffect(() => {
    if (!meta) return;
    const url = absolute(meta.path);
    const fullTitle = /\bLensy\b/.test(meta.title) ? meta.title : `${meta.title} - Lensy`;
    document.title = fullTitle;
    setMeta("name", "description", meta.description);
    setMeta("name", "robots", meta.noindex ? "noindex" : "index, follow");
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", meta.description);
    setMeta("property", "og:url", meta.noindex ? undefined : url);
    setMeta("property", "og:type", meta.schema === "TechArticle" ? "article" : "website");
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", meta.description);
    setMeta("name", "twitter:url", meta.noindex ? undefined : url);
    setLink('link[rel="canonical"]', meta.noindex ? null : { rel: "canonical", href: url });
    setLink('link[rel="alternate"][type="text/markdown"]',
      meta.markdown && !meta.noindex ? { rel: "alternate", type: "text/markdown", href: absolute(markdownPath(meta.path)) } : null);

    let script = document.head.querySelector<HTMLScriptElement>("script#page-jsonld");
    if (meta.noindex) { script?.remove(); return; }
    if (!script) {
      script = document.createElement("script");
      script.id = "page-jsonld";
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }
    script.textContent = jsonLd(meta, url);
    // `key` captures every field of meta, so the effect reruns only when the page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
