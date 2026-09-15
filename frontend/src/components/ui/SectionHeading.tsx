// SectionHeading — a token-driven, purely presentational heading.
// By default it renders a single-color heading via `children`. It also
// supports an optional two-tone accent: a bright `lead` phrase followed
// by a muted `trail` phrase (used when `children` is not provided).
import React from 'react';

interface SectionHeadingProps {
    children?: React.ReactNode;
    lead?: string;
    trail?: string;
    as?: 'h1' | 'h2';
    style?: React.CSSProperties;
}

function SectionHeading({ children, lead, trail, as = 'h2', style }: SectionHeadingProps) {
    const Tag = as;
    const size = as === 'h1' ? 'var(--text-h1)' : 'var(--text-h2)';

    return (
        <Tag
            style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 700,
                fontSize: size,
                letterSpacing: 'var(--tracking-tight)',
                lineHeight: 1.15,
                color: 'var(--text-primary)',
                margin: 0,
                ...style,
            }}
        >
            {children != null ? (
                <span style={{ color: 'var(--text-primary)' }}>{children}</span>
            ) : (
                <>
                    <span style={{ color: 'var(--text-primary)' }}>{lead}</span>
                    {trail ? <span style={{ color: 'var(--text-muted)' }}>{' ' + trail}</span> : null}
                </>
            )}
        </Tag>
    );
}

export default SectionHeading;
