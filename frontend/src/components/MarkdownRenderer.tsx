import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Box, Typography } from '@mui/material';

/**
 * MarkdownRenderer
 *
 * Encapsulates react-markdown + react-syntax-highlighter so they can be
 * code-split out of the initial bundle. LensyApp lazy-loads this component,
 * which means Prism (the syntax highlighter) and react-markdown are only
 * downloaded when a report with markdown/code content is actually rendered.
 *
 * Two modes, matching the original inline usage in LensyApp:
 *   - default (rich=false): bare markdown (was `<ReactMarkdown>{text}</ReactMarkdown>`)
 *   - rich=true: markdown with the custom component map incl. code highlighting
 *     (was the recommendations renderer). Rendering output is intentionally
 *     identical to the previous inline implementation.
 */

// Rich component map — lifted verbatim from the previous inline LensyApp usage
// so rendered output does not change.
const richComponents = {
    code({ node, className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || '');
        const inline = !match;
        return !inline && match ? (
            <Box sx={{
                maxHeight: '500px',
                overflow: 'auto',
                maxWidth: '100%',
                my: 2,
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '4px',
                '& pre': {
                    margin: '0 !important',
                    maxWidth: '100%'
                }
            }}>
                <SyntaxHighlighter
                    style={vscDarkPlus}
                    language={match[1]}
                    PreTag="div"
                    wrapLines={false}
                    wrapLongLines={false}
                    customStyle={{
                        margin: 0,
                        borderRadius: '4px',
                        fontSize: '0.875rem',
                        maxWidth: '100%'
                    }}
                    {...props}
                >
                    {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
            </Box>
        ) : (
            <code className={className} {...props} style={{
                backgroundColor: 'var(--bg-code-inline)',
                padding: '2px 6px',
                borderRadius: '3px',
                fontFamily: 'monospace',
                fontSize: '0.9em',
                color: 'var(--text-code-inline)'
            }}>
                {children}
            </code>
        );
    },
    p({ children }: any) {
        return <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.6 }}>{children}</Typography>;
    },
    h1({ children }: any) {
        return <Typography variant="h6" sx={{ mt: 2, mb: 1, fontWeight: 'bold' }}>{children}</Typography>;
    },
    h2({ children }: any) {
        return <Typography variant="subtitle1" sx={{ mt: 2, mb: 1, fontWeight: 'bold' }}>{children}</Typography>;
    },
    h3({ children }: any) {
        return <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, fontWeight: 'bold' }}>{children}</Typography>;
    },
    ul({ children }: any) {
        return <Box component="ul" sx={{ pl: 2, my: 1 }}>{children}</Box>;
    },
    li({ children }: any) {
        return <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>{children}</Typography>;
    }
};

interface MarkdownRendererProps {
    children: string;
    /** When true, use the custom component map with code highlighting. */
    rich?: boolean;
}

function MarkdownRenderer({ children, rich = false }: MarkdownRendererProps) {
    if (rich) {
        return <ReactMarkdown components={richComponents}>{children}</ReactMarkdown>;
    }
    return <ReactMarkdown>{children}</ReactMarkdown>;
}

export default MarkdownRenderer;
