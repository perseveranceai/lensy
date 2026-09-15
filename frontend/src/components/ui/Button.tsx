// Button — primary or ghost action. Renders real <button> or <a> semantics.
// GPU-friendly transitions (transform/opacity), token-driven, accessible.
import React from 'react';

interface ButtonProps {
    children: React.ReactNode;
    variant?: 'primary' | 'ghost';
    as?: 'button' | 'a';
    href?: string;
    onClick?: () => void;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    style?: React.CSSProperties;
}

function Button({
    children,
    variant = 'primary',
    as = 'button',
    href,
    onClick,
    type = 'button',
    disabled,
    style,
}: ButtonProps) {
    const isPrimary = variant === 'primary';

    const baseStyle: React.CSSProperties = {
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        fontSize: '0.875rem',
        padding: '0.6rem 1.1rem',
        borderRadius: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition:
            'transform var(--transition-fast), background var(--transition-base), border-color var(--transition-base)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        textDecoration: 'none',
        opacity: disabled ? 0.6 : 1,
        ...(isPrimary
            ? {
                  background: 'var(--text-primary)',
                  color: 'var(--bg-primary)',
                  border: 'none',
              }
            : {
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
              }),
        ...style,
    };

    const applyHover = (el: HTMLElement) => {
        if (disabled) return;
        if (isPrimary) {
            el.style.transform = 'translateY(-1px)';
        } else {
            el.style.borderColor = 'var(--border-strong)';
            el.style.color = 'var(--text-primary)';
        }
    };
    const clearHover = (el: HTMLElement) => {
        if (isPrimary) {
            el.style.transform = 'translateY(0)';
        } else {
            el.style.borderColor = 'var(--border-default)';
            el.style.color = 'var(--text-secondary)';
        }
    };
    const applyActive = (el: HTMLElement) => {
        if (disabled) return;
        el.style.transform = 'translateY(0)';
    };

    const interactionHandlers = {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => applyHover(e.currentTarget),
        onMouseLeave: (e: React.MouseEvent<HTMLElement>) => clearHover(e.currentTarget),
        onMouseDown: (e: React.MouseEvent<HTMLElement>) => applyActive(e.currentTarget),
        onMouseUp: (e: React.MouseEvent<HTMLElement>) => applyHover(e.currentTarget),
    };

    if (as === 'a') {
        return (
            <a
                href={disabled ? undefined : href}
                style={baseStyle}
                aria-disabled={disabled}
                onClick={disabled ? undefined : onClick}
                {...interactionHandlers}
            >
                {children}
            </a>
        );
    }

    return (
        <button
            type={type}
            style={baseStyle}
            disabled={disabled}
            onClick={onClick}
            {...interactionHandlers}
        >
            {children}
        </button>
    );
}

export default Button;
