import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Extend window object to include gtag
declare global {
    interface Window {
        gtag?: (...args: any[]) => void;
        dataLayer?: any[];
    }
}

/**
 * Sends a custom event to Google Analytics (GA4).
 * @param eventName The name of the event (e.g., 'generate_report_started')
 * @param params Optional key-value pairs with extra info
 */
export const trackEvent = (eventName: string, params?: Record<string, any>) => {
    if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', eventName, params);
    } else {
        // Fallback for development/testing if gtag isn't loaded
        console.log(`[GA Event Tracked]: ${eventName}`, params || '');
    }
};

/**
 * A React Router hook that tracks page views across a Single Page Application.
 * Call this inside a component that is wrapped by <BrowserRouter>.
 */
export const usePageTracking = () => {
    const location = useLocation();

    useEffect(() => {
        if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', 'page_view', {
                page_path: location.pathname + location.search + location.hash,
                page_location: window.location.href,
                page_title: document.title,
            });
        }
    }, [location]);
};

// Component that simply calls usePageTracking so it can be nested in Routes
export const AnalyticsTracker = () => {
    usePageTracking();
    return null;
};
