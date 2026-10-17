/**
 * Google Analytics 4 event tracking utility for Lensy.
 *
 * Events are defined in GA_implementation_plan.md.
 * The GA4 snippet is loaded in index.html; this module
 * provides a typed helper so components don't call gtag() directly.
 */

declare global {
    interface Window {
        gtag?: (...args: any[]) => void;
    }
}

export function trackEvent(eventName: string, params?: Record<string, any>) {
    if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, params);
    }
}

/**
 * The only source of page_view events: index.html turns off gtag's automatic
 * one, so each route (including the first) is counted exactly once.
 */
export function trackPageView(path: string) {
    if (typeof window.gtag === 'function') {
        window.gtag('event', 'page_view', {
            page_path: path,
            page_location: window.location.origin + path,
            page_title: document.title,
        });
    }
}
