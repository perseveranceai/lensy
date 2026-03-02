import React from 'react';
import { Outlet } from 'react-router-dom';

function ConsoleLayout() {
    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-primary)',
        }}>
            {/* Minimal header — no branding, no sign out */}
            <header style={{
                background: 'rgba(10, 10, 10, 0.8)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderBottom: '1px solid var(--border-subtle)',
                position: 'fixed',
                width: '100%',
                top: 0,
                zIndex: 100,
                padding: '0 1rem',
                boxSizing: 'border-box',
            }}>
                <nav style={{
                    maxWidth: '1400px',
                    margin: '0 auto',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '56px',
                }}>
                    <span style={{
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                        fontSize: '1rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                    }}>
                        Documentation Quality Auditor
                    </span>
                </nav>
            </header>

            {/* Main Content */}
            <main style={{
                flex: 1,
                paddingTop: '72px',
            }}>
                <Outlet />
            </main>

            {/* No footer */}
        </div>
    );
}

export default ConsoleLayout;
