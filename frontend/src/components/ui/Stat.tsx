// Stat — a single metric: large value with a small monospace label beneath.
// Token-driven, purely presentational.
import React from 'react';

interface StatProps {
    value: string;
    label: string;
    style?: React.CSSProperties;
}

function Stat({ value, label, style }: StatProps) {
    return (
        <div style={style}>
            <div
                style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    letterSpacing: 'var(--tracking-tight)',
                }}
            >
                {value}
            </div>
            <div
                style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-eyebrow)',
                    color: 'var(--text-muted)',
                    letterSpacing: '0.04em',
                    marginTop: 'var(--space-2)',
                }}
            >
                {label}
            </div>
        </div>
    );
}

export default Stat;
