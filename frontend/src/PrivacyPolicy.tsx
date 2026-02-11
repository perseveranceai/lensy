import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Privacy Policy page for the Perseverance AI Console.
 * Covers data collection, cookies, and usage.
 *
 * DISCLAIMER: This is a template — Perseverance AI should have a lawyer
 * review and finalize the actual legal language.
 */

function PrivacyPolicy() {
    const navigate = useNavigate();

    const containerStyle: React.CSSProperties = {
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        padding: '2rem 1.5rem',
    };

    const contentStyle: React.CSSProperties = {
        maxWidth: '800px',
        margin: '0 auto',
    };

    const headerStyle: React.CSSProperties = {
        fontFamily: 'var(--font-sans, var(--font-ui))',
        fontSize: '2rem',
        fontWeight: 700,
        color: 'var(--text-primary)',
        marginBottom: '0.5rem',
        letterSpacing: '-0.02em',
    };

    const lastUpdatedStyle: React.CSSProperties = {
        fontFamily: 'var(--font-sans, var(--font-ui))',
        fontSize: '0.8125rem',
        color: 'var(--text-muted)',
        marginBottom: '2rem',
    };

    const sectionTitleStyle: React.CSSProperties = {
        fontFamily: 'var(--font-sans, var(--font-ui))',
        fontSize: '1.25rem',
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginTop: '2rem',
        marginBottom: '0.75rem',
    };

    const bodyStyle: React.CSSProperties = {
        fontFamily: 'var(--font-sans, var(--font-ui))',
        fontSize: '0.9375rem',
        color: 'var(--text-secondary)',
        lineHeight: 1.7,
        marginBottom: '1rem',
    };

    const listStyle: React.CSSProperties = {
        ...bodyStyle,
        paddingLeft: '1.5rem',
    };

    const boldSpan = (text: string) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{text}</span>
    );

    return (
        <div style={containerStyle}>
            <div style={contentStyle}>
                {/* Back link */}
                <button
                    onClick={() => navigate(-1)}
                    style={{
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: 'var(--text-muted)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        marginBottom: '2rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                    ← Back
                </button>

                <h1 style={headerStyle}>Privacy Policy</h1>
                <p style={lastUpdatedStyle}>Last updated: February 10, 2026</p>

                <p style={bodyStyle}>
                    Perseverance AI ("Company", "we", "our", or "us") is committed to protecting your privacy.
                    This Privacy Policy describes how we collect, use, and safeguard information when you use the
                    Perseverance AI Console and associated services ("Services").
                </p>

                <h2 style={sectionTitleStyle}>1. Information We Collect</h2>
                <p style={bodyStyle}>
                    We collect minimal information necessary to provide the Services:
                </p>
                <ul style={listStyle}>
                    <li>{boldSpan('Authentication Data')}: An access code cookie stored in your browser to maintain your session. We do not collect usernames, email addresses, or passwords through the Services.</li>
                    <li>{boldSpan('Usage Data')}: URLs of documentation pages you submit for analysis, analysis results, and generated fixes.</li>
                    <li>{boldSpan('Technical Data')}: Standard web server logs including IP addresses, browser type, and access timestamps, collected automatically by our hosting infrastructure (AWS CloudFront).</li>
                </ul>

                <h2 style={sectionTitleStyle}>2. Cookies</h2>
                <p style={bodyStyle}>
                    We use a {boldSpan('single essential cookie')} ({boldSpan('perseverance_console_token')}) to authenticate
                    your session. This cookie contains your access code and a timestamp, and expires after 48 hours.
                    We do not use tracking cookies, analytics cookies, or third-party advertising cookies.
                </p>

                <h2 style={sectionTitleStyle}>3. How We Use Information</h2>
                <p style={bodyStyle}>
                    We use the information we collect to:
                </p>
                <ul style={listStyle}>
                    <li>Provide, operate, and maintain the Services</li>
                    <li>Authenticate your access and maintain session security</li>
                    <li>Process documentation analysis requests</li>
                    <li>Improve and optimize the Services during the beta period</li>
                    <li>Detect and prevent technical issues or abuse</li>
                </ul>

                <h2 style={sectionTitleStyle}>4. Data Sharing</h2>
                <p style={bodyStyle}>
                    We do {boldSpan('not')} sell, rent, or trade your information. We may share data only in
                    these limited circumstances:
                </p>
                <ul style={listStyle}>
                    <li>{boldSpan('Service Providers')}: AWS (hosting, CDN, compute). Documentation URLs you submit are processed through AWS Bedrock AI models for analysis.</li>
                    <li>{boldSpan('Legal Requirements')}: If required by law, regulation, legal process, or governmental request.</li>
                    <li>{boldSpan('Business Transfer')}: In connection with a merger, acquisition, or sale of assets, with appropriate confidentiality protections.</li>
                </ul>

                <h2 style={sectionTitleStyle}>5. Data Security</h2>
                <p style={bodyStyle}>
                    We implement reasonable technical and organizational measures to protect your information,
                    including HTTPS encryption for all data in transit, secure cookie attributes (Secure, SameSite),
                    and access controls on our infrastructure. However, no method of electronic transmission or
                    storage is 100% secure.
                </p>

                <h2 style={sectionTitleStyle}>6. Data Retention</h2>
                <p style={bodyStyle}>
                    Authentication cookies expire after 48 hours. Analysis session data is retained for 30 days
                    to support re-scanning and report generation, then automatically deleted. Server logs are
                    retained for up to 90 days for security and debugging purposes.
                </p>

                <h2 style={sectionTitleStyle}>7. Your Rights</h2>
                <p style={bodyStyle}>
                    Depending on your jurisdiction, you may have rights regarding your personal data including
                    the right to access, correct, or delete your data. To exercise these rights, contact us at{' '}
                    <a
                        href="mailto:hello@perseveranceai.com"
                        style={{ color: 'var(--accent-primary, #3b82f6)', textDecoration: 'underline' }}
                    >
                        hello@perseveranceai.com
                    </a>.
                </p>

                <h2 style={sectionTitleStyle}>8. Children's Privacy</h2>
                <p style={bodyStyle}>
                    The Services are not intended for use by individuals under the age of 18. We do not
                    knowingly collect personal information from children.
                </p>

                <h2 style={sectionTitleStyle}>9. Changes to This Policy</h2>
                <p style={bodyStyle}>
                    We may update this Privacy Policy from time to time. Changes will be effective immediately
                    upon posting. We encourage you to review this page periodically.
                </p>

                <h2 style={sectionTitleStyle}>Contact</h2>
                <p style={bodyStyle}>
                    Questions about this Privacy Policy? Contact us at{' '}
                    <a
                        href="mailto:hello@perseveranceai.com"
                        style={{ color: 'var(--accent-primary, #3b82f6)', textDecoration: 'underline' }}
                    >
                        hello@perseveranceai.com
                    </a>
                </p>

                {/* Footer */}
                <div style={{
                    borderTop: '1px solid var(--border-subtle)',
                    marginTop: '3rem',
                    paddingTop: '1.5rem',
                    textAlign: 'center',
                }}>
                    <p style={{
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                        fontSize: '0.8125rem',
                        color: 'var(--text-muted)',
                    }}>
                        &copy; {new Date().getFullYear()} Perseverance AI. All rights reserved. Confidential &amp; Proprietary.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default PrivacyPolicy;
