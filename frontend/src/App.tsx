import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import ConsoleLayout from './ConsoleLayout';
import ConsoleDashboard from './ConsoleDashboard';
import LensyApp from './LensyApp';
import TermsOfUse from './TermsOfUse';
import PrivacyPolicy from './PrivacyPolicy';

/**
 * Cookie-based auth check (client-side).
 * CloudFront Function handles server-side enforcement;
 * this is just for SPA route protection and UX.
 */
const COOKIE_NAME = 'perseverance_console_token';
const EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

function isAuthenticated(): boolean {
    const cookies = document.cookie.split(';').reduce((acc, c) => {
        const [key, val] = c.trim().split('=');
        if (key && val) acc[key] = val;
        return acc;
    }, {} as Record<string, string>);

    const token = cookies[COOKIE_NAME];
    if (!token) return false;

    const parts = token.split(':');
    if (parts.length < 2) return false;

    const loginTime = parseInt(parts[parts.length - 1], 10);
    if (isNaN(loginTime)) return false;

    return (Date.now() - loginTime) < EXPIRY_MS;
}

/**
 * Protected route wrapper — redirects to /login if not authenticated
 */
function ProtectedRoute({ children }: { children: React.ReactElement }) {
    if (!isAuthenticated()) {
        return <Navigate to="/login" replace />;
    }
    return children;
}

function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Public: Login page */}
                <Route path="/login" element={<Login />} />

                {/* Public: Legal pages (accessible without auth) */}
                <Route path="/terms" element={<TermsOfUse />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />

                {/* Protected: Console shell with nested routes */}
                <Route
                    path="/console"
                    element={
                        <ProtectedRoute>
                            <ConsoleLayout />
                        </ProtectedRoute>
                    }
                >
                    {/* Console dashboard (index route) */}
                    <Route index element={<ConsoleDashboard />} />

                    {/* Lensy service */}
                    <Route path="lensy" element={<LensyApp />} />
                </Route>

                {/* Catch-all: redirect to console (or login if not authed) */}
                <Route path="*" element={<Navigate to="/console" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
