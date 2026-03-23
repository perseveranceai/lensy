import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import FeedbackWidget from './components/FeedbackWidget';
import { trackEvent } from './hooks/useAnalytics';
const logoImg = `${process.env.PUBLIC_URL}/logo.png`;

type ThemeMode = 'dark' | 'light' | 'system';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';

function ConsoleLayout() {
    const navigate = useNavigate();
    const location = useLocation();

    // Mobile menu state
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Usage tracking (skip when REACT_APP_SKIP_RATE_LIMIT=true)
    const skipRateLimit = process.env.REACT_APP_SKIP_RATE_LIMIT === 'true';
    const [usage, setUsage] = useState<{ used: number; limit: number; remaining: number } | null>(null);

    const fetchUsage = useCallback(async () => {
        if (skipRateLimit) return;
        try {
            const res = await fetch(`${API_BASE_URL}/usage`);
            if (res.ok) {
                const data = await res.json();
                setUsage(data);
            }
        } catch { /* silent */ }
    }, [skipRateLimit]);

    // Fetch usage on mount and listen for refresh events (after each scan)
    useEffect(() => {
        if (skipRateLimit) return;
        fetchUsage();
        const handler = () => fetchUsage();
        window.addEventListener('lensy:usage-changed', handler);
        return () => window.removeEventListener('lensy:usage-changed', handler);
    }, [fetchUsage, skipRateLimit]);

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

    // Close mobile menu on navigation
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);

    const themeOptions: { mode: ThemeMode; icon: string; label: string }[] = [
        { mode: 'system', icon: '\u{1F4BB}', label: 'System' },
        { mode: 'light', icon: '\u2600\uFE0F', label: 'Light' },
        { mode: 'dark', icon: '\u{1F319}', label: 'Dark' },
    ];
    const currentTheme = themeOptions.find(t => t.mode === themeMode) || themeOptions[0];

    const navLinks: Array<{ path: string; label: string; beta?: boolean }> = [
        { path: '/', label: 'Lensy', beta: true },
        { path: '/education', label: 'Education' },
        { path: '/contact', label: 'Contact' },
    ];

    const isActive = (path: string) => {
        if (path === '/') return location.pathname === '/';
        return location.pathname.startsWith(path);
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-primary)',
        }}>
            {/* Header */}
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
                    {/* Left: Logo */}
                    <a
                        href="/"
                        onClick={(e) => { e.preventDefault(); navigate('/'); }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            textDecoration: 'none',
                            transition: 'opacity 0.2s ease',
                            flexShrink: 0,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                    >
                        <img src={logoImg} alt="Perseverance AI" style={{ height: '32px', width: '32px', objectFit: 'contain' }} />
                        <span className="perseverance-text" style={{
                            fontFamily: 'var(--font-sans, var(--font-ui))',
                            fontSize: '1rem',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                        }}>
                            Perseverance AI
                        </span>
                    </a>

                    {/* Center: Nav Links (desktop) */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                    }} className="nav-links-desktop">
                        {navLinks.map((link) => (
                            <a
                                key={link.path}
                                href={link.path}
                                onClick={(e) => { e.preventDefault(); trackEvent('contact_link_clicked', { ref: link.path, label: link.label, source: 'navbar' }); navigate(link.path); }}
                                style={{
                                    fontSize: '0.8125rem',
                                    fontWeight: isActive(link.path) ? 600 : 500,
                                    color: isActive(link.path) ? 'var(--text-primary)' : 'var(--text-secondary)',
                                    textDecoration: 'none',
                                    padding: '0.375rem 0.75rem',
                                    borderRadius: '6px',
                                    transition: 'all 0.15s ease',
                                    background: isActive(link.path) ? 'var(--bg-tertiary)' : 'transparent',
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                }}
                                onMouseEnter={(e) => {
                                    if (!isActive(link.path)) e.currentTarget.style.color = 'var(--text-primary)';
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive(link.path)) e.currentTarget.style.color = 'var(--text-secondary)';
                                }}
                            >
                                {link.label}{link.beta && <sup style={{ fontSize: '0.5rem', fontWeight: 700, color: '#6366f1', marginLeft: '2px', verticalAlign: 'super', letterSpacing: '0.03em' }}>BETA</sup>}
                            </a>
                        ))}
                    </div>

                    {/* Right: Env badge + Theme + Free tier + Hamburger */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        minWidth: 0,
                    }}>
                        {/* Environment Badge */}
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

                        {/* Theme toggle */}
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
                                <span className="theme-toggle-label">{currentTheme.label}</span>
                                <span className="theme-toggle-arrow" style={{ fontSize: '0.6rem', marginLeft: '0.15rem', opacity: 0.6 }}>{themeDropdownOpen ? '\u25B2' : '\u25BC'}</span>
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

                        {/* Free tier badge (desktop only, hidden when rate limit skipped) */}
                        {!skipRateLimit && (
                            <span style={{
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: usage && usage.remaining === 0 ? '#ef4444' : 'var(--text-secondary)',
                                background: 'var(--bg-tertiary)',
                                border: `1px solid ${usage && usage.remaining === 0 ? 'rgba(239,68,68,0.3)' : 'var(--border-default)'}`,
                                borderRadius: '12px',
                                padding: '0.25rem 0.75rem',
                                whiteSpace: 'nowrap',
                            }} className="free-tier-badge">
                                {usage
                                    ? `Free Tier \u2014 ${usage.remaining} audit${usage.remaining !== 1 ? 's' : ''} left`
                                    : 'Free Tier'}
                            </span>
                        )}

                        {/* Hamburger (mobile) */}
                        <button
                            onClick={() => setMobileMenuOpen(prev => !prev)}
                            className="hamburger-btn"
                            aria-label="Toggle menu"
                            style={{
                                display: 'none', // shown via CSS media query
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '0.5rem',
                                flexDirection: 'column',
                                gap: '4px',
                            }}
                        >
                            <span style={{ display: 'block', width: '20px', height: '2px', background: 'var(--text-secondary)', borderRadius: '1px', transition: 'all 0.2s' }} />
                            <span style={{ display: 'block', width: '20px', height: '2px', background: 'var(--text-secondary)', borderRadius: '1px', transition: 'all 0.2s' }} />
                            <span style={{ display: 'block', width: '20px', height: '2px', background: 'var(--text-secondary)', borderRadius: '1px', transition: 'all 0.2s' }} />
                        </button>
                    </div>
                </nav>

                {/* Mobile Menu */}
                {mobileMenuOpen && (
                    <div style={{
                        borderTop: '1px solid var(--border-subtle)',
                        padding: '0.75rem 0',
                    }}>
                        {navLinks.map((link) => (
                            <a
                                key={link.path}
                                href={link.path}
                                onClick={(e) => { e.preventDefault(); trackEvent('contact_link_clicked', { ref: link.path, label: link.label, source: 'mobile_menu' }); navigate(link.path); setMobileMenuOpen(false); }}
                                style={{
                                    display: 'block',
                                    fontSize: '0.875rem',
                                    fontWeight: isActive(link.path) ? 600 : 500,
                                    color: isActive(link.path) ? 'var(--text-primary)' : 'var(--text-secondary)',
                                    textDecoration: 'none',
                                    padding: '0.625rem 0.75rem',
                                    borderRadius: '6px',
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                }}
                            >
                                {link.label}{link.beta && <sup style={{ fontSize: '0.5rem', fontWeight: 700, color: '#6366f1', marginLeft: '2px', verticalAlign: 'super', letterSpacing: '0.03em' }}>BETA</sup>}
                            </a>
                        ))}
                        {!skipRateLimit && usage && (
                            <div style={{
                                padding: '0.5rem 0.75rem',
                                marginTop: '0.25rem',
                                borderTop: '1px solid var(--border-subtle)',
                            }}>
                                <span style={{
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    color: usage.remaining === 0 ? '#ef4444' : 'var(--text-muted)',
                                }}>
                                    Free Tier &mdash; {usage.remaining} audit{usage.remaining !== 1 ? 's' : ''} left
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </header>

            <main style={{
                flex: 1,
                paddingTop: '64px',
                paddingBottom: '60px',
            }}>
                <Outlet />
            </main>

            {/* Feedback Widget — visible on all pages */}
            <FeedbackWidget />

            {/* Footer */}
            <footer style={{
                borderTop: '1px solid var(--border-subtle)',
                padding: '1.5rem 1rem',
            }}>
                <div style={{
                    maxWidth: '1400px',
                    margin: '0 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '1rem',
                }}>
                    {/* Logo */}
                    <a
                        href="/"
                        onClick={(e) => { e.preventDefault(); navigate('/'); }}
                        style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                    >
                        <img src={logoImg} alt="Perseverance AI" style={{ height: '28px', width: '28px', objectFit: 'contain' }} />
                    </a>

                    {/* Social Links */}
                    <div style={{
                        display: 'flex',
                        gap: '1.5rem',
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                    }}>
                        <a href="https://www.linkedin.com/in/pasupdr/" target="_blank" rel="noopener noreferrer"
                            onClick={() => trackEvent('contact_link_clicked', { ref: 'linkedin', source: 'footer' })}
                            style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', textDecoration: 'none', fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
                            LinkedIn
                        </a>
                        <a href="https://x.com/getperseverance" target="_blank" rel="noopener noreferrer"
                            onClick={() => trackEvent('contact_link_clicked', { ref: 'x_twitter', source: 'footer' })}
                            style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', textDecoration: 'none', fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
                            X
                        </a>
                        <a href="https://calendly.com/getperseverance" target="_blank" rel="noopener noreferrer"
                            onClick={() => trackEvent('contact_link_clicked', { ref: 'calendly', source: 'footer' })}
                            style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', textDecoration: 'none', fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
                            Schedule a conversation
                        </a>
                    </div>

                    {/* Legal + Copyright */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                    }}>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            &copy; {new Date().getFullYear()} Perseverance AI. All rights reserved.
                        </span>
                        <a href="/terms" onClick={(e) => { e.preventDefault(); navigate('/terms'); }}
                            style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
                            Terms
                        </a>
                        <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}
                            style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
                            Privacy
                        </a>
                    </div>
                </div>
            </footer>

            {/* CSS for responsive nav */}
            <style>{`
                @media (max-width: 768px) {
                    .nav-links-desktop { display: none !important; }
                    .hamburger-btn { display: flex !important; }
                    .free-tier-badge { display: none !important; }
                    .theme-toggle-label { display: none !important; }
                    .theme-toggle-arrow { display: none !important; }
                    .perseverance-text { display: none !important; }
                }
            `}</style>
        </div>
    );
}

export default ConsoleLayout;
