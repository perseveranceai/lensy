import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ConsoleLayout from './ConsoleLayout';
import ConsoleDashboard from './ConsoleDashboard';
import LensyApp from './LensyApp';
import TermsOfUse from './TermsOfUse';
import PrivacyPolicy from './PrivacyPolicy';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Public: Legal pages */}
                <Route path="/terms" element={<TermsOfUse />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />

                {/* Console shell with nested routes (public — no auth gate) */}
                <Route path="/console" element={<ConsoleLayout />}>
                    {/* Console dashboard (index route) */}
                    <Route index element={<ConsoleDashboard />} />

                    {/* Lensy service */}
                    <Route path="lensy" element={<LensyApp />} />
                </Route>

                {/* Catch-all: redirect to Lensy (primary product) */}
                <Route path="*" element={<Navigate to="/console/lensy" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
