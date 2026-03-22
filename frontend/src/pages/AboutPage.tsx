import React from 'react';

function AboutPage() {
    return (
        <div style={{
            maxWidth: '680px',
            margin: '0 auto',
            padding: '3rem 1.5rem',
            fontFamily: 'var(--font-sans, var(--font-ui))',
        }}>
            {/* Hero */}
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                <h1 style={{
                    fontSize: '2rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: '0.75rem',
                }}>
                    Fixing broken documentation
                </h1>
                <p style={{
                    fontSize: '1.0625rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7,
                    maxWidth: '500px',
                    margin: '0 auto',
                }}>
                    Most teams find out their docs are broken when users complain. Lensy finds the problems first.
                </p>
            </div>

            {/* Founder */}
            <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '16px',
                padding: '2.5rem 2rem',
                textAlign: 'center',
                marginBottom: '2.5rem',
            }}>
                <img
                    src="/founder-photo.jpg"
                    alt="Rakesh Pasupuleti"
                    style={{
                        width: '140px',
                        height: '140px',
                        objectFit: 'cover',
                        objectPosition: 'center 20%',
                        borderRadius: '50%',
                        border: '2px solid var(--border-default)',
                        marginBottom: '1.25rem',
                    }}
                />

                <h2 style={{
                    fontSize: '1.375rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    margin: '0 0 0.25rem 0',
                }}>
                    Rakesh Pasupuleti
                </h2>
                <p style={{
                    fontSize: '0.9375rem',
                    color: 'var(--text-muted)',
                    margin: '0 0 1.25rem 0',
                }}>
                    Founder & CEO
                </p>

                <p style={{
                    fontSize: '0.9375rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7,
                    marginBottom: '1.5rem',
                }}>
                    Product Manager-Technical with engineering experience building developer tools,
                    content management systems, and documentation infrastructure at enterprise scale.
                </p>

                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '2rem',
                    marginBottom: '1.5rem',
                    flexWrap: 'wrap',
                }}>
                    <div>
                        <p style={{
                            fontSize: '0.6875rem',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            marginBottom: '0.375rem',
                        }}>
                            Recognition
                        </p>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: 0 }}>
                            2025 Stevie Award Winner
                        </p>
                    </div>
                    <div>
                        <p style={{
                            fontSize: '0.6875rem',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            marginBottom: '0.375rem',
                        }}>
                            Background
                        </p>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: 0 }}>
                            MS Computer Science + MBA
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <a
                        href="https://www.linkedin.com/in/pasupdr/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-default)',
                            borderRadius: '8px',
                            padding: '0.5rem 1.25rem',
                            textDecoration: 'none',
                            transition: 'border-color 0.2s',
                        }}
                    >
                        LinkedIn
                    </a>
                    <a
                        href="https://www.rakeshpasupuleti.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-default)',
                            borderRadius: '8px',
                            padding: '0.5rem 1.25rem',
                            textDecoration: 'none',
                            transition: 'border-color 0.2s',
                        }}
                    >
                        Portfolio
                    </a>
                </div>
            </div>

            {/* CTA */}
            <div style={{
                textAlign: 'center',
                padding: '2rem 0',
            }}>
                <h2 style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: '0.75rem',
                }}>
                    We're just getting started
                </h2>
                <p style={{
                    fontSize: '0.9375rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7,
                    marginBottom: '1.5rem',
                }}>
                    Lensy is in active development. We'd love to hear from you.
                </p>
                <a
                    href="/contact"
                    style={{
                        display: 'inline-block',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: '#fff',
                        background: 'var(--accent-primary, #6366f1)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0.625rem 1.5rem',
                        textDecoration: 'none',
                        transition: 'opacity 0.2s',
                    }}
                >
                    Get in Touch
                </a>
            </div>
        </div>
    );
}

export default AboutPage;
