import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * Password validation happens ONLY in the CloudFront Function (server-side).
 * Login.tsx simply sets the cookie and lets the user through.
 * If the password is invalid, CloudFront will redirect back to /login?error=auth.
 *
 * This means passwords are managed in ONE place only:
 *   backend/lib/lensy-stack.ts → CloudFront Function → validPasswords object
 *
 * To add/change/extend passwords, an IDE agent just needs to:
 *   1. Edit the validPasswords object in lensy-stack.ts
 *   2. Run: cd backend && cdk deploy
 *   No frontend redeployment needed.
 */

const COOKIE_NAME = 'perseverance_console_token';
const EXPIRY_HOURS = 48;

function setCookie(name: string, value: string, hours: number) {
    const expires = new Date(Date.now() + hours * 60 * 60 * 1000).toUTCString();
    document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Strict; Secure`;
}

function Login() {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [searchParams] = useSearchParams();
    const authError = searchParams.get('error') === 'auth';
    const [error, setError] = useState(authError ? 'Invalid or expired access code. Please try again.' : '');
    const navigate = useNavigate();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        // Set cookie with password:timestamp — CloudFront Function validates server-side
        const token = `${password}:${Date.now()}`;
        setCookie(COOKIE_NAME, token, EXPIRY_HOURS);

        // Brief delay for UX, then redirect to console
        setTimeout(() => {
            navigate('/console');
        }, 300);
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--bg-primary)',
            backgroundImage: `
                linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
            padding: '1rem',
        }}>
            <div style={{
                width: '100%',
                maxWidth: '420px',
                textAlign: 'center',
            }}>
                {/* Logo */}
                <div style={{ marginBottom: '2rem' }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.125rem',
                        marginBottom: '1rem',
                    }}>
                        <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '2rem',
                            fontWeight: 300,
                            color: 'var(--text-code)',
                        }}>{'{'}</span>
                        <span style={{
                            fontFamily: 'var(--font-sans, var(--font-ui))',
                            fontSize: '2.25rem',
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                        }}>P</span>
                        <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '2rem',
                            fontWeight: 300,
                            color: 'var(--text-code)',
                        }}>{'}'}</span>
                    </div>
                    <h1 style={{
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                        fontSize: '1.5rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        margin: '0 0 0.5rem 0',
                        letterSpacing: '-0.01em',
                    }}>
                        Perseverance AI Console
                    </h1>
                    <p style={{
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                        fontSize: '0.875rem',
                        color: 'var(--text-muted)',
                        margin: 0,
                    }}>
                        Enter your access code to continue
                    </p>
                </div>

                {/* Login Card */}
                <div style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    padding: '2rem',
                }}>
                    <form onSubmit={handleSubmit}>
                        <div style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                            <label style={{
                                display: 'block',
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                color: 'var(--text-secondary)',
                                marginBottom: '0.5rem',
                            }}>
                                Access Code
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                                placeholder="Enter your access code"
                                autoFocus
                                style={{
                                    width: '100%',
                                    padding: '0.875rem 1rem',
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                    fontSize: '1rem',
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    border: error
                                        ? '1px solid var(--accent-error)'
                                        : '1px solid var(--border-default)',
                                    borderRadius: '8px',
                                    outline: 'none',
                                    transition: 'all 0.2s ease',
                                    boxSizing: 'border-box' as const,
                                }}
                                onFocus={(e) => {
                                    if (!error) {
                                        e.target.style.borderColor = 'var(--accent-primary)';
                                        e.target.style.boxShadow = '0 0 0 4px rgba(59,130,246,0.1)';
                                    }
                                }}
                                onBlur={(e) => {
                                    if (!error) {
                                        e.target.style.borderColor = 'var(--border-default)';
                                        e.target.style.boxShadow = 'none';
                                    }
                                }}
                            />
                            {error && (
                                <p style={{
                                    color: 'var(--accent-error)',
                                    fontSize: '0.8125rem',
                                    fontWeight: 500,
                                    marginTop: '0.5rem',
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                }}>
                                    {error}
                                </p>
                            )}
                        </div>

                        {/* Confidentiality & Terms Agreement */}
                        <div style={{
                            marginBottom: '1.5rem',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.625rem',
                            textAlign: 'left',
                        }}>
                            <input
                                type="checkbox"
                                id="agree-terms"
                                checked={agreedToTerms}
                                onChange={(e) => setAgreedToTerms(e.target.checked)}
                                style={{
                                    marginTop: '3px',
                                    width: '16px',
                                    height: '16px',
                                    accentColor: 'var(--accent-primary, #3b82f6)',
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                }}
                            />
                            <label
                                htmlFor="agree-terms"
                                style={{
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                    fontSize: '0.8125rem',
                                    color: 'var(--text-muted)',
                                    lineHeight: 1.5,
                                    cursor: 'pointer',
                                }}
                            >
                                I acknowledge this is {' '}
                                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                                    confidential beta software
                                </span>
                                {' '} and I agree to the{' '}
                                <a
                                    href="/terms"
                                    onClick={(e) => { e.preventDefault(); navigate('/terms'); }}
                                    style={{ color: 'var(--accent-primary, #3b82f6)', textDecoration: 'underline' }}
                                >
                                    Terms of Use
                                </a>
                                {' '}and{' '}
                                <a
                                    href="/privacy"
                                    onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}
                                    style={{ color: 'var(--accent-primary, #3b82f6)', textDecoration: 'underline' }}
                                >
                                    Privacy Policy
                                </a>
                                .
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={!password || !agreedToTerms || loading}
                            style={{
                                width: '100%',
                                padding: '0.75rem 1.5rem',
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                fontSize: '0.9375rem',
                                fontWeight: 600,
                                background: password && agreedToTerms && !loading ? 'var(--text-primary)' : 'var(--border-strong)',
                                color: password && agreedToTerms && !loading ? 'var(--bg-primary)' : 'var(--text-muted)',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: password && agreedToTerms && !loading ? 'pointer' : 'not-allowed',
                                transition: 'all 0.2s ease',
                            }}
                        >
                            {loading ? 'Verifying...' : 'Access Console'}
                        </button>
                    </form>
                </div>

                {/* Footer info */}
                <div style={{ marginTop: '1.5rem' }}>
                    <p style={{
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                        fontSize: '0.8125rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.75rem',
                    }}>
                        Access expires after 48 hours
                    </p>
                    <p style={{
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                        fontSize: '0.8125rem',
                    }}>
                        <a
                            href="mailto:hello@perseveranceai.com?subject=Console Access Request"
                            style={{
                                color: 'var(--text-secondary)',
                                textDecoration: 'none',
                                fontWeight: 500,
                                transition: 'color 0.2s ease',
                            }}
                            onMouseEnter={(e) => (e.target as HTMLElement).style.color = 'var(--text-primary)'}
                            onMouseLeave={(e) => (e.target as HTMLElement).style.color = 'var(--text-secondary)'}
                        >
                            Request Access
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default Login;
