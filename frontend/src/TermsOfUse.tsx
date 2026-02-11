import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Terms of Use page for the Perseverance AI Console.
 * Covers beta usage, IP protection, confidentiality, and acceptable use.
 *
 * DISCLAIMER: This is a template — Perseverance AI should have a lawyer
 * review and finalize the actual legal language.
 */

function TermsOfUse() {
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

                <h1 style={headerStyle}>Terms of Use</h1>
                <p style={lastUpdatedStyle}>Last updated: February 10, 2026</p>

                <p style={bodyStyle}>
                    These Terms of Use ("Terms") govern your access to and use of the Perseverance AI Console
                    and all associated services, including Lensy ("Services"), operated by Perseverance AI ("Company",
                    "we", "our", or "us"). By accessing or using the Services, you agree to be bound by these Terms.
                </p>

                <h2 style={sectionTitleStyle}>1. Beta Program & Access</h2>
                <p style={bodyStyle}>
                    The Services are currently in {boldSpan('private beta')}. Access is granted on an invitation-only
                    basis via access codes. Your access code is personal, non-transferable, and confidential. You agree not
                    to share your access code with any third party. We reserve the right to revoke access at any time
                    without notice.
                </p>

                <h2 style={sectionTitleStyle}>2. Confidentiality</h2>
                <p style={bodyStyle}>
                    As a beta participant, you acknowledge that the Services, including their features, functionality,
                    design, user interface, architecture, and all related documentation, constitute {boldSpan('confidential and proprietary information')} of
                    Perseverance AI. You agree to:
                </p>
                <ul style={listStyle}>
                    <li>Not disclose, publish, or share any information about the Services with any third party</li>
                    <li>Not take screenshots, recordings, or other reproductions of the Services for distribution</li>
                    <li>Not discuss the features, capabilities, or design of the Services publicly (including social media, forums, or blog posts)</li>
                    <li>Provide feedback only through authorized channels (hello@perseveranceai.com)</li>
                </ul>

                <h2 style={sectionTitleStyle}>3. Intellectual Property</h2>
                <p style={bodyStyle}>
                    All intellectual property rights in and to the Services — including but not limited to the
                    software, algorithms, user interface design, visual design, branding, logos, documentation,
                    and all underlying technology — are and shall remain the {boldSpan('exclusive property')} of
                    Perseverance AI. Nothing in these Terms grants you any right, title, or interest in our
                    intellectual property beyond the limited right to use the Services during the beta period.
                </p>
                <p style={bodyStyle}>
                    You expressly agree {boldSpan('not to')}:
                </p>
                <ul style={listStyle}>
                    <li>Copy, reproduce, modify, or create derivative works based on the Services</li>
                    <li>Reverse engineer, decompile, disassemble, or otherwise attempt to discover the source code or underlying technology</li>
                    <li>Replicate, imitate, or create competing products or services based on the concepts, features, or design of the Services</li>
                    <li>Remove, alter, or obscure any copyright, trademark, or proprietary notices</li>
                    <li>Use any proprietary information to build a similar or competing service</li>
                </ul>

                <h2 style={sectionTitleStyle}>4. Acceptable Use</h2>
                <p style={bodyStyle}>
                    You agree to use the Services only for their intended purpose — evaluating and improving
                    documentation quality. You shall not:
                </p>
                <ul style={listStyle}>
                    <li>Use the Services for any unlawful purpose or in violation of any applicable law</li>
                    <li>Attempt to gain unauthorized access to any systems or networks</li>
                    <li>Interfere with or disrupt the integrity or performance of the Services</li>
                    <li>Use the Services to process, store, or transmit malicious code</li>
                    <li>Resell, sublicense, or commercially exploit the Services without prior written consent</li>
                </ul>

                <h2 style={sectionTitleStyle}>5. Data & Privacy</h2>
                <p style={bodyStyle}>
                    Our collection and use of information is described in our{' '}
                    <a
                        href="/privacy"
                        onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}
                        style={{ color: 'var(--accent-primary, #3b82f6)', textDecoration: 'underline' }}
                    >
                        Privacy Policy
                    </a>
                    . By using the Services, you consent to such collection and use.
                </p>

                <h2 style={sectionTitleStyle}>6. Disclaimer of Warranties</h2>
                <p style={bodyStyle}>
                    The Services are provided {boldSpan('"AS IS"')} and {boldSpan('"AS AVAILABLE"')} without warranties of
                    any kind, whether express or implied, including but not limited to implied warranties of
                    merchantability, fitness for a particular purpose, and non-infringement. We do not warrant
                    that the Services will be uninterrupted, error-free, or secure, or that any defects will be corrected.
                </p>

                <h2 style={sectionTitleStyle}>7. Limitation of Liability</h2>
                <p style={bodyStyle}>
                    To the maximum extent permitted by law, Perseverance AI shall not be liable for any indirect,
                    incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data,
                    or business opportunities arising out of or related to your use of the Services.
                </p>

                <h2 style={sectionTitleStyle}>8. Termination</h2>
                <p style={bodyStyle}>
                    We may terminate or suspend your access to the Services immediately, without prior notice,
                    for any reason, including without limitation if you breach these Terms. Upon termination,
                    your right to use the Services will cease immediately. Sections 2 (Confidentiality), 3
                    (Intellectual Property), 6, 7, and 9 shall survive termination.
                </p>

                <h2 style={sectionTitleStyle}>9. Governing Law</h2>
                <p style={bodyStyle}>
                    These Terms shall be governed by and construed in accordance with the laws of the State of
                    Delaware, without regard to its conflict of law provisions. Any disputes arising under these
                    Terms shall be subject to the exclusive jurisdiction of the courts located in Delaware.
                </p>

                <h2 style={sectionTitleStyle}>10. Changes to Terms</h2>
                <p style={bodyStyle}>
                    We reserve the right to modify these Terms at any time. Changes will be effective immediately
                    upon posting. Your continued use of the Services after any changes constitutes acceptance of
                    the revised Terms.
                </p>

                <h2 style={sectionTitleStyle}>Contact</h2>
                <p style={bodyStyle}>
                    Questions about these Terms? Contact us at{' '}
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

export default TermsOfUse;
