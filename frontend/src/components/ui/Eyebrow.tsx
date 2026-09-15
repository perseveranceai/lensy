// Eyebrow — small uppercase monospace label used above headings.
// Token-driven, purely presentational.
import React from 'react';

interface EyebrowProps {
    children: React.ReactNode;
    style?: React.CSSProperties;
}

function Eyebrow({ children, style }: EyebrowProps) {
    return (
        <span
            style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-eyebrow)',
                letterSpacing: 'var(--tracking-eyebrow)',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                fontWeight: 600,
                ...style,
            }}
        >
            {children}
        </span>
    );
}

export default Eyebrow;
