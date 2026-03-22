import React, { useState } from 'react';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';

type FeedbackState = 'idle' | 'open' | 'sending' | 'sent' | 'error';

interface ScanMetrics {
    botsAllowed?: string;
    contentHealth?: string;
    queriesVisible?: string;
    aiReadiness?: number;
    overallScore?: number;
}

interface FeedbackWidgetProps {
    auditUrl?: string;
    scanMetrics?: ScanMetrics;
}

export default function FeedbackWidget({ auditUrl, scanMetrics }: FeedbackWidgetProps) {
    const [state, setState] = useState<FeedbackState>('idle');
    const [message, setMessage] = useState('');
    const [email, setEmail] = useState('');

    const handleSubmit = async () => {
        if (!message.trim()) return;
        setState('sending');

        try {
            const res = await fetch(`${API_BASE_URL}/console/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message.trim(),
                    email: email.trim() || undefined,
                    pageUrl: window.location.href,
                    auditUrl: auditUrl || undefined,
                    scanMetrics: scanMetrics || undefined,
                }),
            });
            if (!res.ok) throw new Error('Failed');
            setState('sent');
            setMessage('');
            setEmail('');
            setTimeout(() => setState('idle'), 3000);
        } catch {
            setState('error');
            setTimeout(() => setState('open'), 2000);
        }
    };

    if (state === 'idle' || state === 'sent') {
        return (
            <button
                onClick={() => setState('open')}
                aria-label="Send feedback"
                style={{
                    position: 'fixed',
                    bottom: '1.5rem',
                    right: '1.5rem',
                    zIndex: 1000,
                    background: state === 'sent' ? '#22c55e' : 'var(--text-primary, #fff)',
                    color: state === 'sent' ? '#fff' : 'var(--bg-primary, #0a0a0a)',
                    border: 'none',
                    borderRadius: '28px',
                    padding: '0.625rem 1.25rem',
                    fontFamily: 'var(--font-sans, "Plus Jakarta Sans", sans-serif)',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                }}
            >
                {state === 'sent' ? (
                    <>&#10003; Sent!</>
                ) : (
                    <>&#128172; Feedback</>
                )}
            </button>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            zIndex: 1000,
            width: '340px',
            background: 'var(--bg-secondary, #1a1a1a)',
            border: '1px solid var(--border-default, #333)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                padding: '0.875rem 1rem',
                borderBottom: '1px solid var(--border-subtle, #222)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
            }}>
                <span style={{
                    fontFamily: 'var(--font-sans, sans-serif)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: 'var(--text-primary, #fff)',
                }}>
                    Share Feedback
                </span>
                <button
                    onClick={() => setState('idle')}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted, #888)',
                        cursor: 'pointer',
                        fontSize: '1.25rem',
                        lineHeight: 1,
                        padding: '0 0.25rem',
                    }}
                >
                    &times;
                </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1rem' }}>
                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What would make Lensy more useful?"
                    autoFocus
                    rows={4}
                    style={{
                        width: '100%',
                        padding: '0.75rem',
                        fontFamily: 'var(--font-sans, sans-serif)',
                        fontSize: '0.875rem',
                        background: 'var(--bg-tertiary, #111)',
                        color: 'var(--text-primary, #fff)',
                        border: '1px solid var(--border-default, #333)',
                        borderRadius: '8px',
                        resize: 'vertical',
                        outline: 'none',
                        boxSizing: 'border-box',
                    }}
                />

                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email (optional, for follow-up)"
                    style={{
                        width: '100%',
                        padding: '0.625rem 0.75rem',
                        fontFamily: 'var(--font-sans, sans-serif)',
                        fontSize: '0.8125rem',
                        background: 'var(--bg-tertiary, #111)',
                        color: 'var(--text-primary, #fff)',
                        border: '1px solid var(--border-default, #333)',
                        borderRadius: '8px',
                        outline: 'none',
                        marginTop: '0.5rem',
                        boxSizing: 'border-box',
                    }}
                />

                {/* Show which audit this feedback is about */}
                {auditUrl && (
                    <p style={{
                        fontSize: '0.6875rem',
                        color: 'var(--text-muted, #888)',
                        margin: '0.5rem 0 0',
                        fontFamily: 'var(--font-sans, sans-serif)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        📎 Attached: {auditUrl}
                    </p>
                )}

                {state === 'error' && (
                    <p style={{
                        color: '#ef4444',
                        fontSize: '0.75rem',
                        margin: '0.5rem 0 0',
                        fontFamily: 'var(--font-sans, sans-serif)',
                    }}>
                        Something went wrong. Please try again.
                    </p>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={!message.trim() || state === 'sending'}
                    style={{
                        width: '100%',
                        padding: '0.625rem',
                        marginTop: '0.75rem',
                        fontFamily: 'var(--font-sans, sans-serif)',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        background: message.trim() && state !== 'sending' ? 'var(--text-primary, #fff)' : 'var(--border-strong, #444)',
                        color: message.trim() && state !== 'sending' ? 'var(--bg-primary, #0a0a0a)' : 'var(--text-muted, #888)',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: message.trim() && state !== 'sending' ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s ease',
                    }}
                >
                    {state === 'sending' ? 'Sending...' : 'Send Feedback'}
                </button>
            </div>
        </div>
    );
}
