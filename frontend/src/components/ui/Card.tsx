// Card — bordered surface. Can be static or interactive. When interactive
// (via `interactive`, `onClick`, or `href`) it is fully keyboard accessible:
// anchors render as <a>, otherwise a <div role="button"> with Enter/Space
// activation and a visible focus outline. Token-driven, presentational.
import React from 'react';

interface CardProps {
    children: React.ReactNode;
    interactive?: boolean;
    onClick?: () => void;
    href?: string;
    style?: React.CSSProperties;
    ariaLabel?: string;
}

function Card({ children, interactive, onClick, href, style, ariaLabel }: CardProps) {
    const isInteractive = Boolean(interactive || onClick || href);

    const baseStyle: React.CSSProperties = {
        display: 'block',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        padding: 'var(--space-6)',
        transition: 'border-color var(--transition-base), transform var(--transition-base)',
        textDecoration: 'none',
        color: 'inherit',
        boxSizing: 'border-box',
        ...(isInteractive ? { cursor: 'pointer' } : {}),
        ...style,
    };

    const applyHover = (el: HTMLElement) => {
        el.style.borderColor = 'var(--border-strong)';
        el.style.transform = 'translateY(-2px)';
    };
    const clearHover = (el: HTMLElement) => {
        el.style.borderColor = 'var(--border-subtle)';
        el.style.transform = 'translateY(0)';
    };
    const applyFocus = (el: HTMLElement) => {
        el.style.outline = '2px solid var(--border-strong)';
        el.style.outlineOffset = '2px';
    };
    const clearFocus = (el: HTMLElement) => {
        el.style.outline = 'none';
        el.style.outlineOffset = '0';
    };

    if (!isInteractive) {
        return <div style={baseStyle} aria-label={ariaLabel}>{children}</div>;
    }

    const hoverHandlers = {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => applyHover(e.currentTarget),
        onMouseLeave: (e: React.MouseEvent<HTMLElement>) => clearHover(e.currentTarget),
        onFocus: (e: React.FocusEvent<HTMLElement>) => applyFocus(e.currentTarget),
        onBlur: (e: React.FocusEvent<HTMLElement>) => clearFocus(e.currentTarget),
    };

    if (href) {
        return (
            <a href={href} style={baseStyle} aria-label={ariaLabel} {...hoverHandlers}>
                {children}
            </a>
        );
    }

    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={ariaLabel}
            style={baseStyle}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick?.();
                }
            }}
            {...hoverHandlers}
        >
            {children}
        </div>
    );
}

export default Card;
