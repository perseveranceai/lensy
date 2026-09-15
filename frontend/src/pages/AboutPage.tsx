import React from 'react';
import { Section, SectionHeading, Eyebrow, Button } from '../components/ui';

function AboutPage() {
    return (
        <Section width="prose" style={{ maxWidth: '720px' }}>
            {/* Hero */}
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                <SectionHeading as="h1" style={{ marginBottom: 'var(--space-3)' }}>
                    Fixing broken documentation
                </SectionHeading>
                <p style={{
                    fontSize: 'var(--text-body)',
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
                    fontSize: 'var(--text-h2)',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    margin: '0 0 0.25rem 0',
                }}>
                    Rakesh Pasupuleti
                </h2>
                <p style={{
                    fontSize: 'var(--text-body)',
                    color: 'var(--text-muted)',
                    margin: '0 0 1.25rem 0',
                }}>
                    Founder & CEO
                </p>

                <p style={{
                    fontSize: 'var(--text-body)',
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
                        <Eyebrow style={{ display: 'block', marginBottom: '0.375rem' }}>
                            Recognition
                        </Eyebrow>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
                            2025 Stevie Award Winner
                        </p>
                    </div>
                    <div>
                        <Eyebrow style={{ display: 'block', marginBottom: '0.375rem' }}>
                            Background
                        </Eyebrow>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
                            MS Computer Science + MBA
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <a
                        href="https://www.linkedin.com/company/getperseverance/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            fontSize: 'var(--text-sm)',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-default)',
                            borderRadius: '8px',
                            padding: '0.5rem 1.25rem',
                            textDecoration: 'none',
                            transition: 'border-color var(--transition-base)',
                        }}
                    >
                        LinkedIn
                    </a>
                    <a
                        href="https://www.rakeshpasupuleti.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            fontSize: 'var(--text-sm)',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-default)',
                            borderRadius: '8px',
                            padding: '0.5rem 1.25rem',
                            textDecoration: 'none',
                            transition: 'border-color var(--transition-base)',
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
                    fontSize: 'var(--text-h2)',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: 'var(--space-3)',
                }}>
                    We're just getting started
                </h2>
                <p style={{
                    fontSize: 'var(--text-body)',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7,
                    marginBottom: '1.5rem',
                }}>
                    Lensy is in active development. We'd love to hear from you.
                </p>
                <Button as="a" href="/contact">Get in Touch</Button>
            </div>
        </Section>
    );
}

export default AboutPage;
