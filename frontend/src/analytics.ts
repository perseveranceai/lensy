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

export function trackPageView(path: string) {
    if (typeof window.gtag === 'function') {
        window.gtag('config', process.env.REACT_APP_GA_ID || 'G-65Y3PTRNWP', {
            page_path: path,
        });
    }
}
