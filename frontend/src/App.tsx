import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ConsoleLayout from './ConsoleLayout';
import LensyApp from './LensyApp';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Main: Doc Audit directly */}
                <Route path="/" element={<ConsoleLayout />}>
                    <Route index element={<LensyApp />} />
                </Route>

                {/* Catch-all: redirect to root */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
