import React from 'react';
import { useNavigate } from 'react-router-dom';

interface Article {
    slug: string;
    title: string;
    description: string;
    category: string;
    readTime: string;
}

const articles: Article[] = [
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

function EducationPage() {
    const navigate = useNavigate();

    return (
        <div style={{
            maxWidth: '800px',
            margin: '0 auto',
            padding: '3rem 1.5rem',
            fontFamily: 'var(--font-sans, var(--font-ui))',
        }}>
            <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                <h1 style={{
                    fontSize: '2rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: '0.75rem',
                }}>
                    Education
                </h1>
                <p style={{
                    fontSize: '1.0625rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7,
                    maxWidth: '560px',
                    margin: '0 auto',
                }}>
                    Research-backed insights on making documentation visible to AI search engines.
                </p>
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
                {articles.map((article) => (
                    <article
                        key={article.slug}
                        onClick={() => navigate(`/education/${article.slug}`)}
                        style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '12px',
                            padding: '1.5rem',
                            cursor: 'pointer',
                            transition: 'border-color 0.2s, transform 0.15s',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--border-strong)';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--border-subtle)';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            marginBottom: '0.625rem',
                        }}>
                            <span style={{
                                fontSize: '0.6875rem',
                                fontWeight: 700,
                                color: 'var(--text-secondary)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                            }}>
                                {article.category}
                            </span>
                            <span style={{
                                fontSize: '0.6875rem',
                                color: 'var(--text-muted)',
                            }}>
                                {article.readTime} read
                            </span>
                        </div>
                        <h2 style={{
                            fontSize: '1.125rem',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            margin: '0 0 0.5rem 0',
                            lineHeight: 1.4,
                        }}>
                            {article.title}
                        </h2>
                        <p style={{
                            fontSize: '0.875rem',
                            color: 'var(--text-secondary)',
                            lineHeight: 1.6,
                            margin: 0,
                        }}>
                            {article.description}
                        </p>
                    </article>
                ))}
            </div>

            <div style={{
                textAlign: 'center',
                marginTop: '2.5rem',
                padding: '1.5rem',
                border: '1px dashed var(--border-default)',
                borderRadius: '12px',
            }}>
                <p style={{
                    fontSize: '0.875rem',
                    color: 'var(--text-muted)',
                    margin: 0,
                }}>
                    More articles coming soon. Have a topic in mind?{' '}
                    <a
                        href="/contact"
                        style={{ color: 'var(--text-primary)', textDecoration: 'underline', textUnderlineOffset: '2px', fontWeight: 600 }}
                    >
                        Let us know
                    </a>
                </p>
            </div>
        </div>
    );
}

export default EducationPage;
