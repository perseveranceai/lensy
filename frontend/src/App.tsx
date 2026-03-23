import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ConsoleLayout from './ConsoleLayout';
import { trackPageView } from './analytics';

/* ── Code-split heavy routes ── */
const LensyApp = lazy(() => import('./LensyApp'));
const TermsOfUse = lazy(() => import('./TermsOfUse'));
const PrivacyPolicy = lazy(() => import('./PrivacyPolicy'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const EducationPage = lazy(() => import('./pages/EducationPage'));
const ArticlePage = lazy(() => import('./pages/ArticlePage'));

/** Hero shell — renders instantly as LCP element while LensyApp chunk loads */
const PageLoader = () => (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '3rem 1.5rem', textAlign: 'center' }}>
        <h1 style={{
            fontSize: 'clamp(1.75rem, 4vw, 2.75rem)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans, system-ui)',
            margin: '0 0 1rem',
        }}>
            Is your documentation ready for AI search?
        </h1>
        <p style={{
            fontSize: '1.0625rem',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-sans, system-ui)',
            maxWidth: '640px',
            margin: '0 auto 2rem',
        }}>
            Developers are finding documentation through ChatGPT, Perplexity, Claude, and other AI tools. Lensy checks if they can find yours.
        </p>
        <div style={{
            maxWidth: '640px', margin: '0 auto', height: '56px',
            background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
            borderRadius: '12px', animation: 'pulse 1.5s ease-in-out infinite',
        }} />
        <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }`}</style>
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

function App() {
    return (
        <BrowserRouter>
            <PageTracker />
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    {/* Website shell with header + footer */}
                    <Route element={<ConsoleLayout />}>
                        {/* Homepage = Lensy scanner */}
                        <Route path="/" element={<LensyApp />} />

                        {/* Education hub */}
                        <Route path="/education" element={<EducationPage />} />
                        <Route path="/education/:slug" element={<ArticlePage />} />

                        {/* Contact */}
                        <Route path="/contact" element={<ContactPage />} />

                        {/* Legal pages */}
                        <Route path="/terms" element={<TermsOfUse />} />
                        <Route path="/privacy" element={<PrivacyPolicy />} />
                    </Route>

                    {/* Legacy console routes — redirect to new paths */}
                    <Route path="/console/lensy" element={<Navigate to="/" replace />} />
                    <Route path="/console" element={<Navigate to="/" replace />} />

                    {/* Catch-all */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>
        </BrowserRouter>
    );
}

export default App;
