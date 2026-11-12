import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { trackPageView } from './analytics';
import { ShellContent, AuditAllowanceProvider } from './AppRoutes';
import { DocsScores, Education, ArticlePage, Contact, Terms, Privacy, BotInfo, NotFound } from './AppRoutes';
import { DocsHome, DocsChecks, CheckPage } from './Docs';
import { CliGuide } from './CliGuide';
import { About } from './About';
import { Changelog } from './Changelog';
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

/** /education/<slug> moved to /learn/<slug>. The edge answers old URLs with a 301; this covers links followed inside the app. */
function LearnRedirect() {
    const { slug } = useParams();
    return <Navigate to={`/learn/${slug}`} replace />;
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

                            {/* Docs */}
                            <Route path="/docs" element={<DocsHome />} />
                            <Route path="/docs/scores" element={<DocsScores />} />
                            <Route path="/docs/checks" element={<DocsChecks />} />
                            <Route path="/docs/checks/:slug" element={<CheckPage />} />
                            <Route path="/docs/cli" element={<CliGuide />} />
                            {/* What the Lensy checker is (its user agent links to /bot, which redirects here) */}
                            <Route path="/docs/bot" element={<BotInfo />} />

                            {/* Learn */}
                            <Route path="/learn" element={<Education />} />
                            <Route path="/learn/:slug" element={<ArticlePage />} />
                            <Route path="/changelog" element={<Changelog />} />

                            {/* Company */}
                            <Route path="/about" element={<About />} />
                            <Route path="/contact" element={<Contact />} />

                            {/* Legal pages */}
                            <Route path="/legal/terms" element={<Terms />} />
                            <Route path="/legal/privacy" element={<Privacy />} />

                            {/* N-08: this used to sit outside ShellContent, so the 404 page
                                rendered with no header/footer, unlike every other route. */}
                            <Route path="*" element={<NotFound />} />
                        </Route>

                        {/* Moved pages. backend/cloudfront/site-router.js answers these with a 301
                            at the edge; these cover links followed inside the app. */}
                        <Route path="/cli" element={<Navigate to="/docs/cli" replace />} />
                        <Route path="/bot" element={<Navigate to="/docs/bot" replace />} />
                        <Route path="/how-it-works" element={<Navigate to="/docs/scores" replace />} />
                        <Route path="/education" element={<Navigate to="/learn" replace />} />
                        <Route path="/education/:slug" element={<LearnRedirect />} />
                        <Route path="/terms" element={<Navigate to="/legal/terms" replace />} />
                        <Route path="/privacy" element={<Navigate to="/legal/privacy" replace />} />
                        <Route path="/console/lensy" element={<Navigate to="/" replace />} />
                        <Route path="/console" element={<Navigate to="/" replace />} />
                    </Routes>
                </AuditAllowanceProvider>
            </Suspense>
        </BrowserRouter>
    );
}

export default App;
