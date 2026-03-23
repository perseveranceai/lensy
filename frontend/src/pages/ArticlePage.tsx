import React, { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trackEvent } from '../analytics';

interface Reference {
    label: string;
    url: string;
}

interface ArticleContent {
    title: string;
    category: string;
    readTime: string;
    publishedDate: string;
    tldr: string[];
    sections: Array<{
        heading?: string;
        paragraphs: string[];
        bulletPoints?: string[];
    }>;
    references?: Reference[];
}

const articleContent: Record<string, ArticleContent> = {
    'research-behind-ai-ready-docs': {
        title: 'The Research Behind AI-Ready Documentation',
        category: 'AI Readiness',
        readTime: '3 min',
        publishedDate: '2026-03-22',
        tldr: [
            'Document structure directly affects AI retrieval quality. DeepRead [1] showed 10.3% improvement and RAPTOR [2] showed 20% improvement with structure-aware processing.',
            'ClaudeBot is blocked by 69% of websites and GPTBot by 62% [5]. 71% of sites that block training bots also block search crawlers [6], removing themselves from AI results entirely.',
            'JSON-LD markup increases rich snippet visibility by 20\u201330% [8]. Structured data, heading hierarchies, and proper canonicalization all contribute to higher citation rates.',
        ],
        sections: [
            {
                heading: 'Why Document Structure Matters',
                paragraphs: [
                    'Most AI search engines use Retrieval-Augmented Generation (RAG). They break documents into chunks, embed them in vector space, retrieve relevant chunks for a query, and feed those chunks to a language model. The quality of that chunking, and the structural signals available to guide it, directly affects answer quality.',
                    'DeepRead [1] found that preserving heading hierarchy during HTML-to-Markdown conversion enables a "locate-then-read" paradigm, improving retrieval by 10.3% over baseline agentic search. RAPTOR [2] showed 20% improvement on multi-step reasoning by building recursive tree structures from document hierarchies. The DUE benchmark [3] further established that document understanding requires explicit layout awareness across tasks spanning VQA, key information extraction, and machine reading comprehension.',
                    'Snowflake\'s engineering team [4] confirmed that Markdown-aware chunking provides 5\u201310% accuracy improvement in RAG quality for complex documents, and that retrieval strategy matters even with long-context LLMs.',
                ],
            },
            {
                heading: 'Bot Access: The Crawler Gate',
                paragraphs: [
                    'Major AI companies operate multiple crawlers with distinct purposes. Anthropic runs ClaudeBot (training), Claude-User (real-time fetches), and Claude-SearchBot (indexing). OpenAI separates GPTBot (training) from OAI-SearchBot (search results). Google separates Googlebot (search ranking) from Google-Extended (Gemini training) [7].',
                    'Industry analysis shows ClaudeBot is blocked by approximately 69% of websites and GPTBot by 62% [5]. More critically, 71% of sites that block training bots also inadvertently block search and retrieval bots [6], effectively removing themselves from AI-powered search results. OpenAI has stated that sites blocking OAI-SearchBot will not appear in ChatGPT search answers.',
                ],
            },
            {
                heading: 'Structured Data',
                paragraphs: [
                    'JSON-LD uses the Schema.org vocabulary to declare page types (TechArticle, APIReference), authors, publication dates, and topic relationships. BrightEdge research [8] shows pages with proper Schema.org markup see a 20\u201330% increase in rich snippet visibility. Google\'s Search Central documentation [9] confirms that structured data directly affects how content appears in search results and AI overviews.',
                    'OpenGraph meta tags influence how AI-powered preview systems and content aggregation tools summarize your content. Canonical URLs consolidate link equity and prevent AI engines from indexing duplicate versions [10], which is especially important for documentation sites serving versioned or localized content.',
                ],
            },
            {
                heading: 'What This Means',
                paragraphs: [
                    '84% of developers now use or plan to use AI tools [11]. Documentation that meets structural, access, and metadata standards gets cited. Documentation that doesn\'t is invisible to this growing majority.',
                ],
            },
        ],
        references: [
            { label: 'Li et al. "DeepRead: Document Structure-Aware Reasoning." arXiv:2602.05014, 2026.', url: 'https://arxiv.org/abs/2602.05014' },
            { label: 'Sarthi et al. "RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval." ICLR 2024.', url: 'https://arxiv.org/abs/2401.18059' },
            { label: 'Borchmann et al. "DUE: End-to-End Document Understanding Benchmark." NeurIPS 2021.', url: 'https://datasets-benchmarks-proceedings.neurips.cc/paper/2021/hash/069059b7ef840f0c74a814ec9237b6ec-Abstract-round2.html' },
            { label: 'Snowflake. "How Retrieval & Chunking Impact Finance RAG." 2024.', url: 'https://www.snowflake.com/en/engineering-blog/impact-retrieval-chunking-finance-rag/' },
            { label: 'ALM Corp. "ClaudeBot, Claude-User & Claude-SearchBot: Anthropic\'s Three-Bot Framework." 2025.', url: 'https://almcorp.com/blog/anthropic-claude-bots-robots-txt-strategy/' },
            { label: 'Search Engine Journal. "Anthropic\'s Claude Bots Make Robots.txt Decisions More Granular." 2025.', url: 'https://www.searchenginejournal.com/anthropics-claude-bots-make-robots-txt-decisions-more-granular/568253/' },
            { label: 'Google. "Google\'s Common Crawlers." Google for Developers, 2025.', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
            { label: 'BrightEdge. "Structured Data in the AI Search Era." 2025.', url: 'https://www.brightedge.com/blog/structured-data-ai-search-era' },
            { label: 'Google. "Introduction to Structured Data." Search Central.', url: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data' },
            { label: 'Google. "Canonicalization." Search Central.', url: 'https://developers.google.com/search/docs/crawling-indexing/canonicalization' },
            { label: 'Stack Overflow. "2025 Developer Survey Results." 2025.', url: 'https://survey.stackoverflow.co/2025/' },
        ],
    },
    'how-ai-search-finds-and-cites-docs': {
        title: 'How AI Search Finds, Processes, and Cites Your Docs',
        category: 'AI Discoverability',
        readTime: '3 min',
        publishedDate: '2026-03-22',
        tldr: [
            'Chunking strategy matters. Element-based chunking that respects document structure achieved 84.4% page-level accuracy [1], while 512-token windows with 200-token overlap scored highest across 90 configurations [2].',
            'llms.txt lets you serve Markdown directly to AI agents. Fern [4] reports over 90% reduction in token consumption. Twilio, Stripe, and Cloudflare have also adopted it.',
            'Perplexity cites sources on nearly every response. Brands mentioned positively across 4+ platforms are 2.8x more likely to appear in ChatGPT responses [7].',
        ],
        sections: [
            {
                heading: 'How Chunking Works',
                paragraphs: [
                    'AI search engines crawl your page, convert HTML to text or Markdown, split it into chunks, embed those chunks in vector space, and retrieve relevant pieces to generate an answer. Each stage is sensitive to document quality.',
                    'Jimeno-Yepes et al. [1] demonstrated that element-based chunking that respects document structure (headings, paragraphs, code blocks) rather than splitting at arbitrary character boundaries achieved 84.4% accuracy at page level and improved ROUGE and BLEU scores over naive splitting. Stäbler and Turnbull [2] benchmarked 90 chunker-model configurations across 7 domains and found sentence-based splitting with 512-token windows and 200-token overlap achieved the highest retrieval accuracy. Vectara\'s study [3] tested 25 chunking configurations across 48 embedding models and confirmed that fixed-size chunking at 256\u2013512 tokens consistently outperformed more computationally expensive semantic chunking.',
                ],
            },
            {
                heading: 'llms.txt and Markdown Alternate Links',
                paragraphs: [
                    'Proposed by Jeremy Howard of Answer.AI in September 2024, llms.txt [4] is a Markdown file that helps LLMs navigate websites by providing structured links to content instead of requiring models to parse HTML boilerplate. Adoption has been rapid:',
                ],
                bulletPoints: [
                    'Twilio [5] exposes Markdown versions of all docs (append .md to any URL) plus a curated llms.txt sitemap.',
                    'Fern [6] serves two variants: lightweight /llms.txt with summaries and comprehensive /llms-full.txt. Markdown serving reduces token consumption by over 90%.',
                    'Stripe\'s llms.txt includes an "instructions" section that guides AI to the right integration path.',
                    'Cloudflare organized theirs by service category for selective retrieval.',
                    'Beyond llms.txt, individual pages can signal Markdown availability using <link rel="alternate" type="text/markdown" href="/path/to/page.md"> in the HTML head. This per-page approach complements llms.txt by letting AI agents discover the Markdown version of any specific page they land on, without needing to consult a central index first.',
                ],
            },
            {
                heading: 'How Platforms Decide What to Cite',
                paragraphs: [
                    'Citation behavior varies significantly across platforms. Perplexity is retrieval-first and cites sources on nearly every response, with Reddit as its most-cited source at 6.6% of all citations [7]. ChatGPT cites when browsing is enabled, with Wikipedia leading at 7.8% [7]. Google AI Overviews distributes citations more evenly across sources.',
                    'Several patterns emerge. Pages with clear headings, code examples, and step-by-step instructions get cited more than dense prose. Technical reference queries trigger citations more reliably than generic how-tos. Brands mentioned positively across 4+ non-affiliated platforms are 2.8x more likely to appear in ChatGPT responses [8].',
                ],
            },
        ],
        references: [
            { label: 'Jimeno-Yepes et al. "Financial Report Chunking for Effective RAG." arXiv:2402.05131, 2024.', url: 'https://arxiv.org/abs/2402.05131' },
            { label: 'Stäbler, Turnbull et al. "Chunking Strategies for Domain-Specific IR in RAG." IEEE, 2024.', url: 'https://ieeexplore.ieee.org/document/11125724' },
            { label: 'Qu et al. "Is Semantic Chunking Worth the Computational Cost?" NAACL 2025.', url: 'https://arxiv.org/abs/2410.13070' },
            { label: 'Howard, J. "llms.txt: A Proposal to Help LLMs Use Websites." Answer.AI, 2024.', url: 'https://www.answer.ai/posts/2024-09-03-llmstxt.html' },
            { label: 'Twilio. "Docs Support for llms.txt and Markdown." 2024.', url: 'https://www.twilio.com/en-us/blog/developers/docs-llms-txt-markdown-support' },
            { label: 'Fern. "Markdown for LLMs." 2025.', url: 'https://buildwithfern.com/learn/docs/ai-features/llms-txt' },
            { label: 'Yext. "How AI Engines Decide What to Cite." 2026.', url: 'https://www.yext.com/blog/2026/03/how-chatgpt-perplexity-gemini-claude-decide-what-to-cite' },
            { label: 'XFunnel. "What Sources Do AI Search Engines Cite?" 2026.', url: 'https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose' },
        ],
    },
};

function ArticlePage() {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const article = slug ? articleContent[slug] : null;
    const ctaRef = useRef<HTMLDivElement>(null);
    const trackedRef = useRef(false);

    // Track article_read_complete when user scrolls to CTA
    useEffect(() => {
        trackedRef.current = false;
        const el = ctaRef.current;
        if (!el || !slug) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && !trackedRef.current) {
                trackedRef.current = true;
                trackEvent('article_read_complete', { article_slug: slug });
            }
        }, { threshold: 0.5 });
        observer.observe(el);
        return () => observer.disconnect();
    }, [slug]);

    useEffect(() => {
        if (!slug || !article) return;
        const link = document.createElement('link');
        link.rel = 'alternate';
        link.type = 'text/markdown';
        link.href = `/education/${slug}.md`;
        document.head.appendChild(link);

        document.title = `${article.title} | Perseverance AI`;
        let metaDesc = document.querySelector('meta[name="description"]');
        if (!metaDesc) {
            metaDesc = document.createElement('meta');
            metaDesc.setAttribute('name', 'description');
            document.head.appendChild(metaDesc);
        }
        metaDesc.setAttribute('content', article.tldr[0]);

        return () => { document.head.removeChild(link); };
    }, [slug, article]);

    if (!article) {
        return (
            <div style={{
                maxWidth: '680px',
                margin: '0 auto',
                padding: '3rem 1.5rem',
                textAlign: 'center',
                fontFamily: 'var(--font-sans, var(--font-ui))',
            }}>
                <h1 style={{ color: 'var(--text-primary)', marginBottom: '1rem' }}>Article not found</h1>
                <button
                    onClick={() => navigate('/education')}
                    style={{
                        color: 'var(--text-primary)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9375rem',
                        fontWeight: 600,
                        textDecoration: 'underline',
                        textUnderlineOffset: '2px',
                    }}
                >
                    Back to Education
                </button>
            </div>
        );
    }

    return (
        <div style={{
            maxWidth: '680px',
            margin: '0 auto',
            padding: '3rem 1.5rem',
            fontFamily: 'var(--font-sans, var(--font-ui))',
        }}>
            {/* Back link */}
            <button
                onClick={() => navigate('/education')}
                style={{
                    color: 'var(--text-muted)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    padding: 0,
                    marginBottom: '1.5rem',
                    display: 'block',
                    fontFamily: 'var(--font-sans, var(--font-ui))',
                }}
            >
                ← Back to Education
            </button>

            {/* Meta */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '0.75rem',
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
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    {article.readTime} read
                </span>
            </div>

            {/* Title */}
            <h1 style={{
                fontSize: '1.75rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.3,
                marginBottom: '1.5rem',
            }}>
                {article.title}
            </h1>

            {/* TLDR */}
            <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '1.25rem 1.5rem',
                marginBottom: '2rem',
            }}>
                <div style={{
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '0.75rem',
                }}>
                    TL;DR
                </div>
                <ul style={{
                    margin: 0,
                    paddingLeft: '1rem',
                    listStyle: 'disc',
                }}>
                    {article.tldr.map((point, i) => (
                        <li key={i} style={{
                            fontSize: '0.875rem',
                            color: 'var(--text-primary)',
                            lineHeight: 1.7,
                            marginBottom: i < article.tldr.length - 1 ? '0.5rem' : 0,
                        }}>
                            {point}
                        </li>
                    ))}
                </ul>
            </div>

            {/* Content */}
            {article.sections.map((section, i) => (
                <div key={i} style={{ marginBottom: '1.75rem' }}>
                    {section.heading && (
                        <h2 style={{
                            fontSize: '1.125rem',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            marginBottom: '0.75rem',
                        }}>
                            {section.heading}
                        </h2>
                    )}
                    {section.paragraphs.map((p, j) => (
                        <p key={j} style={{
                            fontSize: '0.9375rem',
                            color: 'var(--text-secondary)',
                            lineHeight: 1.8,
                            marginBottom: '0.875rem',
                        }}>
                            {p}
                        </p>
                    ))}
                    {section.bulletPoints && (
                        <ul style={{
                            paddingLeft: '1.25rem',
                            marginTop: '0.5rem',
                        }}>
                            {section.bulletPoints.map((bp, k) => (
                                <li key={k} style={{
                                    fontSize: '0.9375rem',
                                    color: 'var(--text-secondary)',
                                    lineHeight: 1.7,
                                    marginBottom: '0.5rem',
                                }}>
                                    {bp}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ))}

            {/* References */}
            {article.references && article.references.length > 0 && (
                <div style={{
                    marginTop: '2.5rem',
                    paddingTop: '1.5rem',
                    borderTop: '1px solid var(--border-subtle)',
                }}>
                    <h2 style={{
                        fontSize: '1.125rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        marginBottom: '1rem',
                    }}>
                        References
                    </h2>
                    <ol style={{ paddingLeft: '1.25rem', margin: 0 }}>
                        {article.references.map((ref, i) => (
                            <li key={i} style={{
                                fontSize: '0.8125rem',
                                color: 'var(--text-muted)',
                                lineHeight: 1.7,
                                marginBottom: '0.5rem',
                            }}>
                                {ref.url ? (
                                    <a
                                        href={ref.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                            color: 'var(--text-muted)',
                                            textDecoration: 'underline',
                                            textDecorationColor: 'var(--border-default)',
                                            textUnderlineOffset: '2px',
                                        }}
                                    >
                                        {ref.label}
                                    </a>
                                ) : ref.label}
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {/* CTA */}
            <div ref={ctaRef} style={{
                marginTop: '2.5rem',
                padding: '1.5rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                textAlign: 'center',
            }}>
                <p style={{
                    fontSize: '0.9375rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '1rem',
                }}>
                    Check your documentation's AI readiness.
                </p>
                <button
                    onClick={() => navigate('/')}
                    style={{
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: 'var(--bg-primary, #0a0a0a)',
                        background: 'var(--text-primary, #fff)',
                        border: '1px solid var(--border-default)',
                        borderRadius: '8px',
                        padding: '0.625rem 1.5rem',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                    }}
                >
                    Try Lensy Free
                </button>
            </div>
        </div>
    );
}

export default ArticlePage;
