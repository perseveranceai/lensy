// Section — layout wrapper enforcing consistent vertical rhythm and a
// focused content width. Token-driven, purely presentational.
import React from 'react';

interface SectionProps {
    children: React.ReactNode;
    width?: 'wide' | 'prose';
    id?: string;
    style?: React.CSSProperties;
}

function Section({ children, width = 'wide', id, style }: SectionProps) {
    const maxWidth = width === 'prose' ? 'var(--width-prose)' : 'var(--width-wide)';

    return (
        <section
            id={id}
            style={{
                maxWidth,
                margin: '0 auto',
                padding: 'var(--space-16) var(--page-pad-x)',
                boxSizing: 'border-box',
                ...style,
            }}
        >
            {children}
        </section>
    );
}

export default Section;
