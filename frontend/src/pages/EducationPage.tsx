import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Section, Eyebrow, SectionHeading, Card } from '../components/ui';

interface Article {
    slug: string;
    title: string;
    description: string;
    category: string;
    readTime: string;
}

const articles: Article[] = [
    {
        slug: 'what-changed-in-lensy-after-rechecking-ai-ready-docs-signals',
        title: 'What Changed in Lensy After Re-checking AI-Ready Docs Signals',
        description: 'Markdown discoverability goes beyond .md files. How llms.txt, content negotiation, Link headers, and page-level mapping changed what Lensy checks.',
        category: 'AI Readiness',
        readTime: '4 min',
    },
    {
        slug: 'research-behind-ai-ready-docs',
        title: 'The Research Behind AI-Ready Documentation',
        description: 'Bot access, content structure, structured data, and discoverability — the four dimensions Lensy measures, grounded in peer-reviewed research.',
        category: 'AI Readiness',
        readTime: '3 min',
    },
    {
        slug: 'how-ai-search-finds-and-cites-docs',
        title: 'How AI Search Finds, Processes, and Cites Your Docs',
        description: 'Inside the RAG pipeline: crawling, chunking, retrieval, and citation. What llms.txt changes, and how platforms like Perplexity and ChatGPT decide what to cite.',
        category: 'AI Discoverability',
        readTime: '3 min',
    },
];

// Article list sits in a comfortable reading column, narrower than the wide shell.
const COLUMN_MAX_WIDTH = '760px';

function EducationPage() {
    const navigate = useNavigate();

    return (
        <Section width="wide" style={{ fontFamily: 'var(--font-sans)' }}>
            <div style={{ maxWidth: COLUMN_MAX_WIDTH, margin: '0 auto' }}>
                {/* Header */}
                <header style={{ marginBottom: 'var(--space-12)' }}>
                    <Eyebrow style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
                        Learn
                    </Eyebrow>
                    <SectionHeading as="h1" style={{ marginBottom: 'var(--space-4)' }}>
                        Education
                    </SectionHeading>
                    <p
                        style={{
                            fontSize: 'var(--text-body)',
                            color: 'var(--text-secondary)',
                            lineHeight: 1.7,
                            maxWidth: 'var(--width-prose)',
                            margin: 0,
                        }}
                    >
                        Research-backed insights on making documentation visible to AI search engines.
                    </p>
                </header>

                {/* Article list */}
                <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                    {articles.map((article) => (
                        <Card
                            key={article.slug}
                            interactive
                            onClick={() => navigate(`/education/${article.slug}`)}
                            ariaLabel={`Read article: ${article.title}`}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-3)',
                                    marginBottom: 'var(--space-3)',
                                }}
                            >
                                <Eyebrow>{article.category}</Eyebrow>
                                <span
                                    style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: 'var(--text-eyebrow)',
                                        letterSpacing: '0.04em',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    {article.readTime} read
                                </span>
                            </div>
                            <h3
                                style={{
                                    fontSize: 'var(--text-body)',
                                    fontWeight: 600,
                                    color: 'var(--text-primary)',
                                    margin: '0 0 var(--space-2) 0',
                                    lineHeight: 1.4,
                                }}
                            >
                                {article.title}
                            </h3>
                            <p
                                style={{
                                    fontSize: 'var(--text-sm)',
                                    color: 'var(--text-secondary)',
                                    lineHeight: 1.55,
                                    margin: 0,
                                }}
                            >
                                {article.description}
                            </p>
                        </Card>
                    ))}
                </div>

                {/* Footer note */}
                <div
                    style={{
                        textAlign: 'center',
                        marginTop: 'var(--space-12)',
                        padding: 'var(--space-6)',
                        border: '1px dashed var(--border-default)',
                        borderRadius: '12px',
                    }}
                >
                    <p
                        style={{
                            fontSize: 'var(--text-body)',
                            color: 'var(--text-muted)',
                            margin: 0,
                        }}
                    >
                        More articles coming soon. Have a topic in mind?{' '}
                        <a
                            href="/contact"
                            style={{
                                color: 'var(--text-primary)',
                                textDecoration: 'underline',
                                textUnderlineOffset: '2px',
                                fontWeight: 600,
                            }}
                        >
                            Let us know
                        </a>
                    </p>
                </div>
            </div>
        </Section>
    );
}

export default EducationPage;
