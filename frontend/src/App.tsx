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

/** Minimal loading fallback */
const PageLoader = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border-default)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
