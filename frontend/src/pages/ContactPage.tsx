import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// Context-aware messaging based on ref query param
const REF_CONFIG: Record<string, { heading: string; description: string; successMessage: string; buttonLabel: string }> = {
    llmstxt: {
        heading: 'Get Your llms.txt Generated',
        description: 'We\'ll create a structured llms.txt file for your documentation so AI coding assistants like Cursor, Copilot, and Claude can discover and consume your docs faster.',
        successMessage: 'We\'ll review your docs and get back to you with a generated llms.txt file.',
        buttonLabel: 'Request llms.txt',
    },
    markdown: {
        heading: 'Get Markdown Versions of Your Docs',
        description: 'We\'ll help you serve markdown alongside your HTML documentation. AI agents consume markdown up to 80% more efficiently — fewer tokens, cleaner code generation.',
        successMessage: 'We\'ll review your docs and reach out about markdown generation.',
        buttonLabel: 'Request Markdown Generation',
    },
    feedback: {
        heading: 'Share Your Feedback',
        description: 'Lensy is in Beta and your input helps us improve. Tell us what worked, what didn\'t, or what you\'d like to see next.',
        successMessage: 'Thanks for your feedback! We read every submission and it directly shapes what we build.',
        buttonLabel: 'Send Feedback',
    },
    default: {
        heading: 'Join the Waitlist',
        description: 'Get early access to higher audit limits and new features as we grow.',
        successMessage: 'We\'ll reach out when higher limits are available.',
        buttonLabel: 'Join Waitlist',
    },
};

function ContactPage() {
    const [searchParams] = useSearchParams();
    const ref = searchParams.get('ref') || 'default';
    const config = useMemo(() => REF_CONFIG[ref] || REF_CONFIG.default, [ref]);

    const [formData, setFormData] = useState({
        doc_url: '',
        name: '',
        email: '',
        organization: '',
        message: '',
    });
    const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

    const showMessageField = ref === 'feedback';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('sending');
        try {
            const res = await fetch('https://www.perseveranceai.com/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...formData, ref }),
            });
            if (res.ok) {
                setStatus('success');
                setFormData({ doc_url: '', name: '', email: '', organization: '', message: '' });
            } else {
                setStatus('error');
            }
        } catch {
            setStatus('error');
        }
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '0.625rem 0.875rem',
        fontSize: '0.875rem',
        fontFamily: 'var(--font-sans, var(--font-ui))',
        color: 'var(--text-primary)',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-default)',
        borderRadius: '8px',
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.2s',
    };

    const labelStyle: React.CSSProperties = {
        display: 'block',
        fontSize: '0.8125rem',
        fontWeight: 600,
        color: 'var(--text-secondary)',
        marginBottom: '0.375rem',
    };

    return (
        <div style={{
            maxWidth: '520px',
            margin: '0 auto',
            padding: '3rem 1.5rem',
            fontFamily: 'var(--font-sans, var(--font-ui))',
        }}>
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <h1 style={{
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: '0.5rem',
                }}>
                    {config.heading}
                </h1>
                <p style={{
                    fontSize: '0.9375rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                }}>
                    {config.description}
                </p>
            </div>

            {status === 'success' ? (
                <div style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    padding: '2rem',
                    textAlign: 'center',
                }}>
                    <p style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
                        {ref === 'feedback' ? 'Thank you!' : "You're on the list!"}
                    </p>
                    <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
                        {config.successMessage}
                    </p>
                </div>
            ) : (
                <form onSubmit={handleSubmit} style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    padding: '1.5rem',
                }}>
                    {!showMessageField && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={labelStyle}>Developer Portal or Website URL</label>
                            <input
                                type="text"
                                placeholder="e.g., docs.yourcompany.com or yourcompany.com"
                                value={formData.doc_url}
                                onChange={(e) => setFormData({ ...formData, doc_url: e.target.value })}
                                style={inputStyle}
                                required
                            />
                        </div>
                    )}
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={labelStyle}>Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            style={inputStyle}
                            required
                        />
                    </div>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={labelStyle}>Email</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            style={inputStyle}
                            required
                        />
                    </div>
                    {!showMessageField && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <label style={labelStyle}>Organization / Company</label>
                            <input
                                type="text"
                                value={formData.organization}
                                onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                                style={inputStyle}
                            />
                        </div>
                    )}
                    {showMessageField && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <label style={labelStyle}>Your feedback</label>
                            <textarea
                                placeholder="What worked? What didn't? What would you like to see?"
                                value={formData.message}
                                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                                style={{ ...inputStyle, minHeight: '120px', resize: 'vertical' }}
                                required
                            />
                        </div>
                    )}

                    {status === 'error' && (
                        <p style={{ color: '#ef4444', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
                            Something went wrong. Please try again.
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={status === 'sending'}
                        style={{
                            width: '100%',
                            padding: '0.625rem',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            fontFamily: 'var(--font-sans, var(--font-ui))',
                            color: '#fff',
                            background: 'var(--accent-primary, #6366f1)',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: status === 'sending' ? 'wait' : 'pointer',
                            opacity: status === 'sending' ? 0.7 : 1,
                            transition: 'opacity 0.2s',
                        }}
                    >
                        {status === 'sending' ? 'Submitting...' : config.buttonLabel}
                    </button>
                </form>
            )}

            <p style={{
                textAlign: 'center',
                marginTop: '1.5rem',
                fontSize: '0.875rem',
                color: 'var(--text-muted)',
            }}>
                Or schedule a live demo:{' '}
                <a
                    href="https://calendly.com/getperseverance"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                        textDecoration: 'none',
                    }}
                >
                    Pick a time
                </a>
            </p>
        </div>
    );
}

export default ContactPage;
