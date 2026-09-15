import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { trackPageView } from './analytics';
import { ShellContent, AuditAllowanceProvider } from './AppRoutes';
import { HowItWorks, Education, ArticlePage, Contact, Terms, Privacy, NotFound } from './AppRoutes';
/* ── Code-split heavy routes ── */
const LensyApp = lazy(() => import('./LensyApp'));

/** Minimal, theme-correct loading fallback shown while a lazy route chunk loads. */
const PageLoader = () => (
    <div
        role="status"
        aria-label="Loading"
        style={{
            minHeight: '100vh',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg)',
        }}
    >
        <div
            style={{
                width: '28px',
                height: '28px',
                border: '2px solid var(--line)',
                borderTopColor: 'var(--ink-soft)',
                borderRadius: '50%',
                animation: 'lensy-spin 0.7s linear infinite',
            }}
        />
        <style>{`@keyframes lensy-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
);

/** Sends a page_view event to GA4 on every SPA route change */
function PageTracker() {
    const location = useLocation();
    useEffect(() => {
        trackPageView(location.pathname + location.search);
    }, [location]);
    return null;
}

/** Resets scroll to the top on route (pathname) change. */
function ScrollToTop() {
    const { pathname, hash } = useLocation();
    React.useLayoutEffect(() => {
        if (hash) return;
        window.scrollTo(0, 0);
    }, [pathname, hash]);
    return null;
}

function App() {
    return (
        <BrowserRouter>
            <PageTracker />
            <ScrollToTop />
            <Suspense fallback={<PageLoader />}>
                <AuditAllowanceProvider>
                    <Routes>
                        {/* Website shell with header + footer */}
                        <Route element={<ShellContent />}>
                            {/* Homepage = Lensy scanner */}
                            <Route path="/" element={<LensyApp />} />
                            <Route path="/results" element={<LensyApp />} />
                            <Route path="/scan" element={<LensyApp />} />

                            {/* Static & Education Hub */}
                            <Route path="/how-it-works" element={<HowItWorks />} />
                            <Route path="/education" element={<Education />} />
                            <Route path="/education/:slug" element={<ArticlePage />} />

                            {/* Contact */}
                            <Route path="/contact" element={<Contact />} />

                            {/* Legal pages */}
                            <Route path="/terms" element={<Terms />} />
                            <Route path="/privacy" element={<Privacy />} />
                        </Route>

                        {/* Legacy routes — redirect to Lensy */}
                        <Route path="/about" element={<Navigate to="/" replace />} />
                        <Route path="/console/lensy" element={<Navigate to="/" replace />} />
                        <Route path="/console" element={<Navigate to="/" replace />} />

                        {/* Catch-all */}
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                </AuditAllowanceProvider>
            </Suspense>
        </BrowserRouter>
    );
}

export default App;
