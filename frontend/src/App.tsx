import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ConsoleLayout from './ConsoleLayout';
import LensyApp from './LensyApp';
import TermsOfUse from './TermsOfUse';
import PrivacyPolicy from './PrivacyPolicy';
import ContactPage from './pages/ContactPage';
import EducationPage from './pages/EducationPage';
import ArticlePage from './pages/ArticlePage';
import { trackPageView } from './analytics';

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
        </BrowserRouter>
    );
}

export default App;
