import React from 'react';
import { useNavigate } from 'react-router-dom';

interface ServiceCard {
    id: string;
    name: string;
    description: string;
    icon: string;
    path: string;
    status: 'active' | 'coming-soon';
}

const services: ServiceCard[] = [
    {
        id: 'lensy',
        name: 'Lensy',
        description: 'Documentation Quality Auditor — Analyze docs for deprecated code, outdated APIs, and content gaps with AI-powered fixes.',
        icon: '🔍',
        path: '/console/lensy',
        status: 'active',
    },
    // Future services go here:
    // {
    //     id: 'future-service',
    //     name: 'Service Name',
    //     description: 'Description here.',
    //     icon: '🚀',
    //     path: '/console/future-service',
    //     status: 'coming-soon',
    // },
];

function ConsoleDashboard() {
    const navigate = useNavigate();

    return (
        <div style={{
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '3rem 1.5rem',
        }}>
            {/* Dashboard Header */}
            <div style={{ marginBottom: '2.5rem' }}>
                <h1 style={{
                    fontFamily: 'var(--font-sans, var(--font-ui))',
                    fontSize: '2rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    margin: '0 0 0.5rem 0',
                    letterSpacing: '-0.02em',
                }}>
                    Console Home
                </h1>
                <p style={{
                    fontFamily: 'var(--font-sans, var(--font-ui))',
                    fontSize: '1rem',
                    color: 'var(--text-muted)',
                    margin: 0,
                }}>
                    Perseverance AI services
                </p>
            </div>

            {/* Service Cards Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '1.5rem',
            }}>
                {services.map((service) => (
                    <div
                        key={service.id}
                        onClick={() => service.status === 'active' && navigate(service.path)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && service.status === 'active') navigate(service.path);
                        }}
                        style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '12px',
                            padding: '1.75rem',
                            cursor: service.status === 'active' ? 'pointer' : 'default',
                            transition: 'all 0.3s ease',
                            opacity: service.status === 'coming-soon' ? 0.5 : 1,
                        }}
                        onMouseEnter={(e) => {
                            if (service.status === 'active') {
                                e.currentTarget.style.background = 'var(--bg-tertiary)';
                                e.currentTarget.style.borderColor = 'var(--border-default)';
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'var(--bg-secondary)';
                            e.currentTarget.style.borderColor = 'var(--border-subtle)';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    >
                        {/* Icon */}
                        <div style={{
                            fontSize: '2rem',
                            marginBottom: '1rem',
                        }}>
                            {service.icon}
                        </div>

                        {/* Title row */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            marginBottom: '0.5rem',
                        }}>
                            <h3 style={{
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                fontSize: '1.25rem',
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                margin: 0,
                            }}>
                                {service.name}
                            </h3>
                            {service.status === 'active' && (
                                <span style={{
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    color: '#818cf8',
                                    background: 'rgba(129, 140, 248, 0.1)',
                                    border: '1px solid rgba(129, 140, 248, 0.25)',
                                    borderRadius: '4px',
                                    padding: '0.1rem 0.4rem',
                                    textTransform: 'uppercase' as const,
                                    letterSpacing: '0.05em',
                                }}>
                                    Beta
                                </span>
                            )}
                            {service.status === 'coming-soon' && (
                                <span style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.75rem',
                                    fontWeight: 400,
                                    color: 'var(--text-muted)',
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-default)',
                                    borderRadius: '4px',
                                    padding: '0.125rem 0.5rem',
                                }}>
                                    Coming Soon
                                </span>
                            )}
                        </div>

                        {/* Description */}
                        <p style={{
                            fontFamily: 'var(--font-sans, var(--font-ui))',
                            fontSize: '0.9375rem',
                            color: 'var(--text-muted)',
                            lineHeight: 1.5,
                            margin: 0,
                        }}>
                            {service.description}
                        </p>

                        {/* Launch arrow for active services */}
                        {service.status === 'active' && (
                            <div style={{
                                marginTop: '1.25rem',
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                color: 'var(--text-secondary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.375rem',
                            }}>
                                Open {service.name}
                                <span style={{ fontSize: '1rem' }}>→</span>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default ConsoleDashboard;
