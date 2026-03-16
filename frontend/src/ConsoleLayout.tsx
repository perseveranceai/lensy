import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import FeedbackWidget from './components/FeedbackWidget';

type ThemeMode = 'dark' | 'light' | 'system';

function ConsoleLayout() {
    const navigate = useNavigate();
    const location = useLocation();

    // Determine breadcrumb based on current path
    const isLensy = location.pathname.startsWith('/console/lensy');

    // Theme dropdown state
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
        return (localStorage.getItem('lensy-theme') as ThemeMode) || 'system';
    });
    const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
    const themeDropdownRef = useRef<HTMLDivElement>(null);

    const applyTheme = useCallback((mode: ThemeMode) => {
        document.documentElement.setAttribute('data-theme', mode);
    }, []);

    useEffect(() => {
        applyTheme(themeMode);
        localStorage.setItem('lensy-theme', themeMode);
    }, [themeMode, applyTheme]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
                setThemeDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const themeOptions: { mode: ThemeMode; icon: string; label: string }[] = [
        { mode: 'system', icon: '\u{1F4BB}', label: 'System' },
        { mode: 'light', icon: '\u2600\uFE0F', label: 'Light' },
        { mode: 'dark', icon: '\u{1F319}', label: 'Dark' },
    ];
    const currentTheme = themeOptions.find(t => t.mode === themeMode) || themeOptions[0];

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-primary)',
        }}>
            {/* Console Header — frosted glass, matches perseveranceai.com nav */}
            <header style={{
                background: 'var(--header-bg)',
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
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    height: '56px',
                }}>
                    {/* Left: Logo + Context */}
                    <a
                        href="/console"
                        onClick={(e) => { e.preventDefault(); navigate('/console'); }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.125rem',
                            textDecoration: 'none',
                            transition: 'opacity 0.2s ease',
                            flexShrink: 0,
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
                            whiteSpace: 'nowrap',
                        }}>
                            {isLensy ? 'Lensy' : 'Console'}
                        </span>
                    </a>

                    {/* Environment Badge — only shown in non-prod */}
                    {process.env.REACT_APP_ENV && process.env.REACT_APP_ENV !== 'prod' && (
                        <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            color: '#fff',
                            background: process.env.REACT_APP_ENV === 'gamma' ? '#d97706' : '#6366f1',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                        }}>
                            {process.env.REACT_APP_ENV}
                        </span>
                    )}

                    {/* Right: Theme toggle + Free tier badge */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        minWidth: 0,
                    }}>
                        <div ref={themeDropdownRef} style={{ position: 'relative' }}>
                            <button
                                onClick={() => setThemeDropdownOpen(prev => !prev)}
                                style={{
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-default)',
                                    borderRadius: '8px',
                                    padding: '0.3rem 0.6rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    transition: 'all 0.2s ease',
                                    fontSize: '0.75rem',
                                    color: 'var(--text-muted)',
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                    fontWeight: 600,
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                            >
                                <span style={{ fontSize: '0.85rem' }}>{currentTheme.icon}</span>
                                <span>{currentTheme.label}</span>
                                <span style={{ fontSize: '0.6rem', marginLeft: '0.15rem', opacity: 0.6 }}>{themeDropdownOpen ? '\u25B2' : '\u25BC'}</span>
                            </button>
                            {themeDropdownOpen && (
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 4px)',
                                    right: 0,
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-default)',
                                    borderRadius: '8px',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                                    zIndex: 200,
                                    minWidth: '140px',
                                    overflow: 'hidden',
                                }}>
                                    {themeOptions.map(opt => (
                                        <button
                                            key={opt.mode}
                                            onClick={() => { setThemeMode(opt.mode); setThemeDropdownOpen(false); }}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.5rem',
                                                width: '100%',
                                                padding: '0.5rem 0.75rem',
                                                border: 'none',
                                                background: themeMode === opt.mode ? 'var(--bg-tertiary)' : 'transparent',
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                fontWeight: themeMode === opt.mode ? 700 : 500,
                                                color: themeMode === opt.mode ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                                transition: 'background 0.15s ease',
                                                textAlign: 'left',
                                            }}
                                            onMouseEnter={(e) => { if (themeMode !== opt.mode) e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                                            onMouseLeave={(e) => { if (themeMode !== opt.mode) e.currentTarget.style.background = 'transparent'; }}
                                        >
                                            <span style={{ fontSize: '1rem' }}>{opt.icon}</span>
                                            <span>{opt.label}</span>
                                            {themeMode === opt.mode && <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{'\u2713'}</span>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <span style={{
                            fontFamily: 'var(--font-sans, var(--font-ui))',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-default)',
                            borderRadius: '12px',
                            padding: '0.25rem 0.75rem',
                            whiteSpace: 'nowrap',
                        }}>
                            Free Tier — 3 audits/day
                        </span>
                    </div>
                </nav>
            </header>

            {/* Main Content — below fixed header */}
            <main style={{
                flex: 1,
                paddingTop: '72px',  /* Header height + buffer for mobile wrapping */
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
                    color: 'var(--text-secondary)',
                    margin: '0 0 0.5rem 0',
                }}>
                    &copy; {new Date().getFullYear()} Perseverance AI. All rights reserved.
                </p>
                <p style={{
                    fontFamily: 'var(--font-sans, var(--font-ui))',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    margin: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '1rem',
                }}>
                    <a
                        href="/terms"
                        onClick={(e) => { e.preventDefault(); navigate('/terms'); }}
                        style={{ color: 'var(--text-secondary)', textDecoration: 'none', transition: 'color 0.2s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                    >
                        Terms of Use
                    </a>
                    <span style={{ color: 'var(--border-default)' }}>|</span>
                    <a
                        href="/privacy"
                        onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}
                        style={{ color: 'var(--text-secondary)', textDecoration: 'none', transition: 'color 0.2s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                    >
                        Privacy Policy
                    </a>
                </p>
            </footer>

            {/* Feedback Widget — floating bottom-right */}
            <FeedbackWidget />
        </div>
    );
}

export default ConsoleLayout;
