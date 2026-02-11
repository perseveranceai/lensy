import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const COOKIE_NAME = 'perseverance_console_token';

function clearCookie(name: string) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict; Secure`;
}

function ConsoleLayout() {
    const navigate = useNavigate();
    const location = useLocation();

    const handleSignOut = () => {
        clearCookie(COOKIE_NAME);
        navigate('/login');
    };

    // Determine breadcrumb based on current path
    const isLensy = location.pathname.startsWith('/console/lensy');
    const isDashboard = location.pathname === '/console' || location.pathname === '/console/';

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-primary)',
        }}>
            {/* Console Header — frosted glass, matches perseveranceai.com nav */}
            <header style={{
                background: 'rgba(10, 10, 10, 0.8)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderBottom: '1px solid var(--border-subtle)',
                position: 'fixed',
                width: '100%',
                top: 0,
                zIndex: 100,
                padding: '0 1.5rem',
            }}>
                <nav style={{
                    maxWidth: '1400px',
                    margin: '0 auto',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    height: '56px',
                }}>
                    {/* Left: Logo + Console label */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                    }}>
                        {/* {P} Logo */}
                        <a
                            href="/console"
                            onClick={(e) => { e.preventDefault(); navigate('/console'); }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.125rem',
                                textDecoration: 'none',
                                transition: 'opacity 0.2s ease',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                        >
                            <span style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '1.25rem',
                                fontWeight: 300,
                                color: 'var(--text-code)',
                            }}>{'{'}</span>
                            <span style={{
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                fontSize: '1.5rem',
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                            }}>P</span>
                            <span style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '1.25rem',
                                fontWeight: 300,
                                color: 'var(--text-code)',
                            }}>{'}'}</span>
                            <span style={{
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                fontSize: '1rem',
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                marginLeft: '0.5rem',
                            }}>Perseverance AI</span>
                        </a>

                        {/* Separator */}
                        <span style={{
                            color: 'var(--border-strong)',
                            fontSize: '1.25rem',
                            fontWeight: 200,
                            userSelect: 'none',
                        }}>|</span>

                        {/* Console label */}
                        <span style={{
                            fontFamily: 'var(--font-sans, var(--font-ui))',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            color: 'var(--text-muted)',
                        }}>Console</span>

                        {/* Breadcrumb for active service */}
                        {isLensy && (
                            <>
                                <span style={{
                                    color: 'var(--text-muted)',
                                    fontSize: '0.875rem',
                                    userSelect: 'none',
                                }}>/</span>
                                <span style={{
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                    fontSize: '0.875rem',
                                    fontWeight: 500,
                                    color: 'var(--text-secondary)',
                                }}>Lensy</span>
                            </>
                        )}
                    </div>

                    {/* Right: Sign Out — white text, ghost button style matching website .btn-secondary */}
                    <button
                        onClick={handleSignOut}
                        style={{
                            fontFamily: 'var(--font-sans, var(--font-ui))',
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            background: 'transparent',
                            border: '1px solid var(--border-default)',
                            borderRadius: '6px',
                            padding: '0.4rem 0.875rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                            (e.target as HTMLElement).style.color = 'var(--text-primary)';
                            (e.target as HTMLElement).style.borderColor = 'var(--border-strong)';
                            (e.target as HTMLElement).style.background = 'var(--bg-tertiary)';
                        }}
                        onMouseLeave={(e) => {
                            (e.target as HTMLElement).style.color = 'var(--text-secondary)';
                            (e.target as HTMLElement).style.borderColor = 'var(--border-default)';
                            (e.target as HTMLElement).style.background = 'transparent';
                        }}
                    >
                        Sign Out
                    </button>
                </nav>
            </header>

            {/* Main Content — below fixed header */}
            <main style={{
                flex: 1,
                paddingTop: '56px',  /* Header height */
            }}>
                <Outlet />
            </main>

            {/* Console Footer */}
            <footer style={{
                borderTop: '1px solid var(--border-subtle)',
                padding: '1.5rem',
                textAlign: 'center',
            }}>
                <p style={{
                    fontFamily: 'var(--font-sans, var(--font-ui))',
                    fontSize: '0.8125rem',
                    color: 'var(--text-muted)',
                    margin: '0 0 0.5rem 0',
                }}>
                    &copy; {new Date().getFullYear()} Perseverance AI. All rights reserved. Confidential &amp; Proprietary.
                </p>
                <p style={{
                    fontFamily: 'var(--font-sans, var(--font-ui))',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    margin: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '1rem',
                }}>
                    <a
                        href="/terms"
                        onClick={(e) => { e.preventDefault(); navigate('/terms'); }}
                        style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.2s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                        Terms of Use
                    </a>
                    <span style={{ color: 'var(--border-default)' }}>|</span>
                    <a
                        href="/privacy"
                        onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}
                        style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.2s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                        Privacy Policy
                    </a>
                </p>
            </footer>
        </div>
    );
}

export default ConsoleLayout;
