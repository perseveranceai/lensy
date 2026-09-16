import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { Home } from './Home';
import { ScanReport } from './AppRoutes';
import { trackEvent } from './analytics';
import {
    Paper,
    TextField,
    Button,
    Typography,
    Box,
    Alert,
    CircularProgress,
    Card,
    CardContent,
    Grid,
    Chip,
    Collapse,
    IconButton,
    Checkbox,
    Divider,
    Tooltip
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import CachedIcon from '@mui/icons-material/Cached';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { Fix } from './components/FixReviewPanel';

// react-markdown + react-syntax-highlighter are heavy; lazy-load them so they
// stay out of the initial bundle and only download when a report is rendered.
const MarkdownRenderer = lazy(() => import('./components/MarkdownRenderer'));

// jsPDF + fonts loaded dynamically on PDF export to reduce initial bundle
const logoImg = `${process.env.PUBLIC_URL}/logo.png`;

// [NEW] Collapsible Component Helper
const CollapsibleCard = ({ title, subtitle, children, defaultExpanded = true, count = 0, color = "default" }: any) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    // Status-based color mapping
    const colorMap: Record<string, { border: string, bg: string, text: string }> = {
        error: { border: '#ef4444', bg: 'rgba(239,68,68,0.08)', text: '#ef4444' },
        warning: { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)', text: '#f59e0b' },
        success: { border: '#22c55e', bg: 'rgba(34,197,94,0.08)', text: '#22c55e' },
        info: { border: 'var(--accent-primary)', bg: 'rgba(255,255,255,0.05)', text: 'var(--accent-primary)' },
        default: { border: 'var(--border-default)', bg: 'transparent', text: 'var(--text-primary)' }
    };

    const statusColor = colorMap[color] || colorMap.default;

    return (
        <Card sx={{
            mb: 4,
            borderTop: color !== 'default' ? `4px solid ${statusColor.border}` : 'none',
            borderLeft: color !== 'default' ? `3px solid ${statusColor.border}` : 'none',
            transition: 'background-color var(--transition-base), border-color var(--transition-base), box-shadow var(--transition-base)',
            bgcolor: expanded ? 'var(--bg-tertiary)' : (color !== 'default' ? statusColor.bg : 'var(--bg-secondary)'),
            border: expanded ? '1px solid var(--border-default)' : '1px solid var(--border-subtle)',
            boxShadow: expanded ? '0 8px 32px rgba(0,0,0,0.15)' : 'none',
            overflow: 'hidden'
        }}>
            <Box
                sx={{
                    p: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    bgcolor: expanded ? 'var(--bg-tertiary)' : 'transparent',
                    '&:hover': {
                        bgcolor: 'var(--bg-tertiary)'
                    }
                }}
                onClick={() => setExpanded(!expanded)}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Typography variant="h6" component="div" sx={{
                                fontWeight: 600,
                                color: expanded ? 'var(--text-primary)' : 'var(--text-secondary)',
                                letterSpacing: '-0.01em'
                            }}>
                                {title}
                            </Typography>
                            {count > 0 && (
                                <Chip
                                    label={count}
                                    size="small"
                                    color={color === 'error' ? 'error' : color === 'warning' ? 'warning' : 'default'}
                                    sx={{ ml: 2, fontWeight: 700, height: 20 }}
                                />
                            )}
                        </Box>
                        {subtitle && (
                            <Typography variant="body2" sx={{
                                color: 'var(--text-muted)',
                                fontSize: '0.8rem',
                                mt: 0.25,
                                lineHeight: 1.4,
                            }}>
                                {subtitle}
                            </Typography>
                        )}
                    </Box>
                </Box>
                <IconButton size="small" sx={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
            </Box>
            <Collapse in={expanded}>
                <Divider sx={{ borderColor: 'var(--border-subtle)' }} />
                <CardContent sx={{ p: 3 }}>
                    {children}
                </CardContent>
            </Collapse>
        </Card>
    );
};

interface AnalysisRequest {
    url: string;
    selectedModel: 'claude' | 'titan' | 'llama' | 'auto';
    sessionId: string;
    inputType?: 'doc' | 'sitemap' | 'issue-discovery' | 'github-issues';
    contextAnalysis?: {
        enabled: boolean;
        maxContextPages?: number;
    };
    cacheControl?: {
        enabled: boolean;
    };
    sitemapUrl?: string;
    llmsTxtUrl?: string;
    useAgent?: boolean;
    skipCitations?: boolean;
    forceJsRender?: boolean;
}

interface DimensionResult {
    dimension: string;
    score: number | null;
    status: 'complete' | 'failed' | 'timeout' | 'retrying';
    findings: string[];
    recommendations: Array<{
        priority: 'high' | 'medium' | 'low';
        action: string;
        impact: string;
        evidence?: string;
        location?: string;
    }>;
    retryCount: number;
    processingTime: number;
    // New structured findings
    spellingIssues?: Array<{
        incorrect: string;
        correct: string;
        context: string;
    }>;
    codeIssues?: Array<{
        type: string;
        location: string;
        description: string;
        codeFragment: string;
    }>;
    terminologyInconsistencies?: Array<{
        variants: string[];
        recommendation: string;
    }>;
}

// â”€â”€ NEW: AI Readiness Category Interfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface BotAccessData {
    robotsTxtFound: boolean;
    bots: Array<{ name: string; userAgent: string; status: 'allowed' | 'blocked' | 'not-mentioned' }>;
    allowedCount: number;
    blockedCount: number;
}

interface DiscoverabilityData {
    llmsTxt: { found: boolean; url: string };
    llmsFullTxt: { found: boolean; url: string };
    sitemapXml: { found: boolean; url?: string; referencedInRobotsTxt: boolean };
    openGraph: { found: boolean; tags: Record<string, string> };
    canonical: { found: boolean; url?: string };
    metaRobots: { found: boolean; content?: string; blocksIndexing: boolean };
}

// â”€â”€ v2 Evidence-aware Detection Types â”€â”€
type EvidenceStatus = 'verified' | 'advertised' | 'mapped' | 'not_verified' | 'experimental';

interface DetectionSignal {
    status: EvidenceStatus;
    method?: string;
    validatedUrl?: string | null;
    audience?: 'ai_search' | 'coding_agents' | 'both';
    note?: string | null;
}

interface DetectionData {
    site: {
        llmsTxt: DetectionSignal;
        llmsFullTxt: DetectionSignal;
        sitemap: DetectionSignal;
        agentsMd: DetectionSignal;
        mcpJson: DetectionSignal;
        blockedAiCrawlers: string[];
        allowedAiCrawlers: string[];
        openApiSpecs: string[];
    };
    page: {
        markdown: DetectionSignal;
        llmsTxtMapping: DetectionSignal;
        llmsTxtMarkdownMapping: DetectionSignal;
        contentNegotiation: DetectionSignal;
    };
    probeLog?: Array<{ url: string; statusCode: number; purpose: string; durationMs: number }>;
}

interface ConsumabilityData {
    markdownAvailable: { found: boolean; urls: string[]; discoverable: boolean; discoveryMethod?: string };
    textToHtmlRatio: { ratio: number; textBytes: number; htmlBytes: number; status: 'good' | 'low' | 'very-low' };
    jsRendered: boolean;
    headingHierarchy: { h1Count: number; h2Count: number; h3Count: number; hasProperNesting: boolean; headings: string[] };
    codeBlocks: { count: number; withLanguageHints: number; hasCode: boolean };
    internalLinkDensity: { count: number; perKWords: number; status: 'good' | 'sparse' | 'excessive' };
    wordCount?: number;
    originRequiresJavaScript?: boolean;
    renderedContentRecovered?: boolean;
}

interface StructuredDataData {
    jsonLd: { found: boolean; types: string[]; isValidSchemaType: boolean };
    schemaCompleteness: { status: 'complete' | 'partial' | 'missing'; missingFields: string[] };
    openGraphCompleteness: { score: 'complete' | 'partial' | 'missing'; missingTags: string[] };
    breadcrumbs: { found: boolean };
}

interface AIDiscoverabilityData {
    queries: string[];
    queryTypes?: Array<'high' | 'mid' | 'low' | 'context-aware' | 'context-free'>;
    engines: {
        perplexity?: {
            available: boolean;
            results: Array<{ query: string; cited: boolean; totalCitations: number; citedUrl?: string; competingDomains?: string[] }>;
            foundRate: number;
        };
        brave?: {
            available: boolean;
            results: Array<{ query: string; cited: boolean; totalCitations: number; citedUrl?: string; competingDomains?: string[] }>;
            foundRate: number;
        };
    };
    overallDiscoverability: 'high' | 'partial' | 'low' | 'not-found';
    recommendations: Array<{ priority: string; issue: string; fix: string }>;
}

interface AIReadinessCategories {
    botAccess: BotAccessData;
    discoverability: DiscoverabilityData;
    consumability: ConsumabilityData;
    structuredData: StructuredDataData;
}

interface ScoreBreakdown {
    botAccess: number;          // always 0 in v2 â€” bot access is now a prerequisite, not scored
    discoverability: number;
    consumability: number;
    structuredData: number;
    aiDiscoverability: number;
}

// Legacy interface kept for backward compat (old reports)
interface AIReadinessResult {
    llmsTxt: { found: boolean; url: string; content?: string };
    llmsFullTxt: { found: boolean; url: string };
    robotsTxt: { found: boolean; aiDirectives: Array<{ userAgent: string; rule: 'Allow' | 'Disallow' }> };
    markdownExports: { available: boolean; sampleUrls: string[] };
    structuredData: { hasJsonLd: boolean; schemaTypes: string[] };
    overallScore: number;
    recommendations: string[];
}

interface FinalReport {
    overallScore: number;
    // New AI readiness fields
    scoreBreakdown?: ScoreBreakdown;
    categories?: AIReadinessCategories;
    aiDiscoverability?: AIDiscoverabilityData | null;
    contextualSuggestions?: string[];
    recommendations?: Array<{ category: string; priority: 'high' | 'medium' | 'low'; issue: string; fix: string; codeSnippet?: string }>;
    // Legacy fields (kept for old report compat)
    dimensionsAnalyzed?: number;
    dimensionsTotal?: number;
    confidence?: 'high' | 'medium' | 'low';
    modelUsed?: string;
    dimensions?: Record<string, DimensionResult>;
    codeAnalysis: {
        snippetsFound: number;
        syntaxErrors: number;
        deprecatedMethods: number;
        missingVersionSpecs: number;
        languagesDetected: string[];
        enhancedAnalysis?: {
            llmAnalyzedSnippets: number;
            deprecatedFindings: Array<{
                language: string;
                method: string;
                location: string;
                deprecatedIn: string;
                removedIn?: string;
                replacement: string;
                confidence: 'high' | 'medium' | 'low';
                codeFragment: string;
            }>;
            syntaxErrorFindings: Array<{
                language: string;
                location: string;
                errorType: string;
                description: string;
                codeFragment: string;
                confidence: 'high' | 'medium' | 'low';
            }>;
            confidenceDistribution: {
                high: number;
                medium: number;
                low: number;
            };
        };
    };
    mediaAnalysis: {
        videosFound: number;
        audiosFound: number;
        imagesFound: number;
        interactiveElements: number;
        accessibilityIssues: number;
        missingAltText: number;
    };
    linkAnalysis: {
        totalLinks: number;
        internalLinks: number;
        externalLinks: number;
        brokenLinks: number;
        totalLinkIssues?: number;
        linkIssueFindings?: Array<{
            url: string;
            status: number | string;
            anchorText: string;
            sourceLocation: string;
            errorMessage: string;
            issueType: '404' | 'error' | 'timeout' | 'access-denied';
        }>;
        subPagesIdentified: string[];
        linkContext: 'single-page' | 'multi-page-referenced';
        analysisScope: 'current-page-only' | 'with-subpages';
        linkValidation?: {
            checkedLinks: number;
            linkIssueFindings: Array<{
                url: string;
                status: number | string;
                anchorText: string;
                sourceLocation: string;
                errorMessage: string;
                issueType: '404' | 'error' | 'timeout' | 'access-denied';
            }>;
            healthyLinks: number;
            brokenLinks: number;
            accessDeniedLinks: number;
            timeoutLinks: number;
            otherErrors: number;
        };
    };
    // NEW: Sitemap health analysis for sitemap journey mode
    sitemapHealth?: {
        totalUrls?: number;
        healthyUrls?: number;
        brokenUrls?: number;
        accessDeniedUrls?: number;
        timeoutUrls?: number;
        otherErrorUrls?: number;
        healthPercentage?: number;
        linkIssues?: Array<{
            url: string;
            status: number | string;
            errorMessage: string;
            issueType: '404' | 'access-denied' | 'timeout' | 'error';
        }>;
        processingTime: number;
        error?: string; // New field for sitemap-level errors
    };
    cacheStatus: 'hit' | 'miss';
    contextAnalysis?: {
        enabled: boolean;
        contextPages: Array<{
            url: string;
            title: string;
            relationship: 'parent' | 'child' | 'sibling';
            confidence: number;
            cached?: boolean;
        }>;
        analysisScope: 'single-page' | 'with-context';
        totalPagesAnalyzed: number;
    };
    scope?: {
        url: string;
        mode: 'single-page' | 'sitemap';
        pagesAnalyzed: number;
        internalLinksValidated: number;
        sitemapChecked: boolean;
        sitemapUrl?: string;
        aiReadinessChecked: boolean;
    };
    analysisTime: number;
    retryCount: number;
    aiReadiness?: AIReadinessResult;
}

interface ProgressMessage {
    type: 'info' | 'success' | 'error' | 'warning' | 'progress' | 'cache-hit' | 'cache-miss' | 'category-result';
    message: string;
    timestamp: number;
    sessionId?: string;
    phase?: 'url-processing' | 'structure-detection' | 'dimension-analysis' | 'report-generation' | 'fix-generation' | 'input-detection' | 'ai-readiness' | 'sitemap-health';
    metadata?: {
        dimension?: string;
        score?: number;
        processingTime?: number;
        cacheStatus?: 'hit' | 'miss';
        contentType?: string;
        contextPages?: number;
        category?: string;
        data?: any;
        [key: string]: any;
    };
}

interface AnalysisState {
    status: 'idle' | 'analyzing' | 'generating' | 'applying' | 'completed' | 'error';
    report?: FinalReport;
    error?: string;
    executionArn?: string;
    progressMessages: ProgressMessage[];
    sourceMode?: 'doc' | 'sitemap' | 'issue-discovery' | 'github-issues';
}

const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';
const WEBSOCKET_URL = process.env.REACT_APP_WS_URL || 'wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod';

function LensyApp() {
    const [url, setUrl] = useState('');
    const skipRateLimit = process.env.REACT_APP_SKIP_RATE_LIMIT === 'true';
    const [usageRemaining, setUsageRemaining] = useState<number | null>(skipRateLimit ? 999 : null);

    // Fetch usage on mount and after scans (skip when REACT_APP_SKIP_RATE_LIMIT=true in .env)
    useEffect(() => {
        if (skipRateLimit) return;
        const fetchUsage = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/usage`);
                if (res.ok) {
                    const data = await res.json();
                    setUsageRemaining(data.remaining);
                }
            } catch { /* silent */ }
        };
        fetchUsage();
        const handler = () => fetchUsage();
        window.addEventListener('lensy:usage-changed', handler);
        return () => window.removeEventListener('lensy:usage-changed', handler);
    }, []);

    const [selectedModel, setSelectedModel] = useState<'claude' | 'titan' | 'llama' | 'auto'>('claude');
    const [contextAnalysisEnabled, setContextAnalysisEnabled] = useState(true);
    const [cacheEnabled, setCacheEnabled] = useState(false);
    const [selectedMode, setSelectedMode] = useState<'doc' | 'sitemap' | 'issue-discovery' | 'github-issues'>('doc');
    const [manualModeOverride, setManualModeOverride] = useState<'doc' | 'sitemap' | 'issue-discovery' | 'github-issues' | null>(null);
    const [companyDomain, setCompanyDomain] = useState('');
    const [discoveredIssues, setDiscoveredIssues] = useState<Array<{
        id: string;
        title: string;
        description: string;
        frequency: number;
        sources: string[];
    }>>([]);
    const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
    const [isSearchingIssues, setIsSearchingIssues] = useState(false);
    const [validationResults, setValidationResults] = useState<any>(null);
    // GitHub Issues mode state
    const [githubRepoUrl, setGithubRepoUrl] = useState('');
    const [githubDocsUrl, setGithubDocsUrl] = useState('');
    const [suggestedDocsRepos, setSuggestedDocsRepos] = useState<Array<{ name: string; fullName: string; description: string; hasDocsContent: boolean; contentFileCount: number; codeFileCount: number; hasLlmsTxt: boolean }>>([]);
    const [showManualDocsEntry, setShowManualDocsEntry] = useState(false);
    const [docsSource, setDocsSource] = useState<'github' | 'website' | 'repo-only' | null>(null);
    const [noDocsAsCode, setNoDocsAsCode] = useState(false);
    const [docsAsCodeConfirmation, setDocsAsCodeConfirmation] = useState<'pending' | 'yes' | 'no' | null>(null); // human-in-the-loop step
    const [docsContextReady, setDocsContextReady] = useState(false); // gates issue selection â€” true only when a valid docs source is confirmed
    const [crawlUrl, setCrawlUrl] = useState('');
    const [creatingPrIndex, setCreatingPrIndex] = useState<number | null>(null);
    const [prUrls, setPrUrls] = useState<Record<number, string>>({});
    const [prError, setPrError] = useState<string | null>(null);
    const [docsContextHint, setDocsContextHint] = useState<string | null>(null);
    // Preview-docs state (pre-crawl confirmation step)
    const [previewDocs, setPreviewDocs] = useState<{
        found: boolean;
        source: 'llms.txt' | 'sitemap.xml' | null;
        sourceUrl?: string;
        pageCount?: number;
        categories?: string[];
        domain?: string;
        message?: string;
    } | null>(null);
    const [isPreviewingDocs, setIsPreviewingDocs] = useState(false);
    const [manualLlmsUrl, setManualLlmsUrl] = useState(''); // Direct llms.txt/sitemap.xml URL if auto-detect fails
    // Knowledge Base build state (separate from analysis)
    const [kbBuildState, setKbBuildState] = useState<'idle' | 'building' | 'ready' | 'error'>('idle');
    const kbBuildStateRef = useRef<'idle' | 'building' | 'ready' | 'error'>('idle');
    const [kbBuildProgress, setKbBuildProgress] = useState<Array<{ type: string; message: string; timestamp: number; metadata?: any }>>([]);
    const [kbInfo, setKbInfo] = useState<{ domain: string; pageCount: number } | null>(null);
    const [githubIssues, setGithubIssues] = useState<Array<{
        number: number;
        title: string;
        body: string;
        html_url: string;
        labels: Array<{ name: string }>;
        created_at: string;
        comments: number;
        isDocsRelated: boolean;
        docsConfidence?: number;
        docsCategories?: string[];
        docsGap?: {
            gapType: string;
            affectedDocs: string[];
            summary: string;
            suggestedFix: string;
            confidence: number;
        };
    }>>([]);
    const [selectedGithubIssues, setSelectedGithubIssues] = useState<number[]>([]);
    const [isFetchingGithubIssues, setIsFetchingGithubIssues] = useState(false);
    const [githubFetchCompleted, setGithubFetchCompleted] = useState(false);
    const [githubFetchMeta, setGithubFetchMeta] = useState<{ totalFetched: number; dateRange: string; classificationMethod: 'llm' | 'keyword' } | null>(null);
    const [githubAnalysisResults, setGithubAnalysisResults] = useState<any>(null);
    const [copiedFixIndex, setCopiedFixIndex] = useState<number | null>(null);
    const [analysisState, setAnalysisState] = useState<AnalysisState>({
        status: 'idle',
        progressMessages: []
    });
    const [selectedRecommendations, setSelectedRecommendations] = useState<string[]>([]);
    const [progressExpanded, setProgressExpanded] = useState(true);
    const wsRef = useRef<WebSocket | null>(null);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const citationsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const currentSessionIdRef = useRef<string>('');
    const urlRef = useRef<string>('');
    const progressEndRef = useRef<HTMLDivElement>(null);
    const issuesListRef = useRef<HTMLDivElement>(null);
    const [showScrollIndicator, setShowScrollIndicator] = useState(false);

    // Fix Generation State
    const [fixes, setFixes] = useState<Fix[]>([]);
    const [isGeneratingFixes, setIsGeneratingFixes] = useState(false);
    const [isApplyingFixes, setIsApplyingFixes] = useState(false);
    const [showFixPanel, setShowFixPanel] = useState(false);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [forceFreshScan, setForceFreshScan] = useState(false);
    const [sitemapUrl, setSitemapUrl] = useState('');
    const [llmsTxtUrl, setLlmsTxtUrl] = useState('');
    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
    const [useAgentEngine, setUseAgentEngine] = useState(true);
    const [fixSuccessMessage, setFixSuccessMessage] = useState<string | null>(null);
    const [lastModifiedFile, setLastModifiedFile] = useState<string | null>(null);

    // â”€â”€ Async Card State (populated via WebSocket category-result messages) â”€â”€
    const [asyncCards, setAsyncCards] = useState<{
        botAccess?: BotAccessData;
        discoverability?: DiscoverabilityData;
        consumability?: ConsumabilityData;
        structuredData?: StructuredDataData;
        aiDiscoverability?: AIDiscoverabilityData;
        detection?: DetectionData;  // v2: evidence-aware detection report
        overallScore?: { overallScore: number; botAccessState?: 'js_blocked' | 'fully_blocked' | 'partially_blocked' | 'accessible'; scoreBreakdown: ScoreBreakdown; recommendationCount: number; contextualSuggestionCount: number; docConfidence?: { score: number; signals: string[] } };
    }>({});
    const [activeDetailCard, setActiveDetailCard] = useState<'score' | 'bots' | 'content' | 'queries' | null>(null);
    const [showAllRecs, setShowAllRecs] = useState(false);
    const [showFullContentBreakdown, setShowFullContentBreakdown] = useState(false);
    const [heroTab, setHeroTab] = useState<'readiness' | 'citations' | 'recommendations'>('readiness');
    const heroTabPanelRef = React.useRef<HTMLDivElement>(null);
    const [rejectedUrl, setRejectedUrl] = useState<string | null>(null);

    // â”€â”€ Focus management: move focus to tab panel on tab switch (WCAG 2.4.3) â”€â”€
    useEffect(() => {
        if (heroTabPanelRef.current) {
            heroTabPanelRef.current.focus({ preventScroll: true });
        }
    }, [heroTab]);

    // â”€â”€ Persist audit state across route changes only (not page refresh) â”€â”€
    // Always attempt to restore from sessionStorage so state persists on reload.
    // (window as any).__lensy_session_alive tracking is no longer needed since we want
    // to preserve state across hard reloads for the current session.
    useEffect(() => {
        try {
            if (window.location.pathname === '/') {
                sessionStorage.removeItem('lensy-audit-state');
                return;
            }
            const saved = sessionStorage.getItem('lensy-audit-state');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.url) setUrl(parsed.url);
                if (parsed.asyncCards && Object.keys(parsed.asyncCards).length > 0) setAsyncCards(parsed.asyncCards);
                if (parsed.analysisState && parsed.analysisState.status !== 'analyzing') {
                    setAnalysisState(parsed.analysisState);
                }
                if (parsed.heroTab) setHeroTab(parsed.heroTab);
                if (parsed.currentSessionId) setCurrentSessionId(parsed.currentSessionId);
            }
        } catch (e) { /* ignore parse errors */ }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Save to sessionStorage on state changes (for route-change restoration)
    useEffect(() => {
        if (analysisState.status === 'idle' && Object.keys(asyncCards).length === 0) return;
        try {
            sessionStorage.setItem('lensy-audit-state', JSON.stringify({
                url,
                asyncCards,
                analysisState: analysisState.status === 'analyzing' ? { ...analysisState, status: 'completed' } : analysisState,
                heroTab,
                currentSessionId,
            }));
        } catch (e) { /* ignore quota errors */ }
    }, [url, asyncCards, analysisState, heroTab, currentSessionId]);

    // Keep kbBuildState ref in sync (for use in WebSocket callbacks where state is stale)
    useEffect(() => {
        kbBuildStateRef.current = kbBuildState;
    }, [kbBuildState]);

    // Keep urlRef in sync for WebSocket callbacks (closures capture stale state)
    useEffect(() => { urlRef.current = url; }, [url]);

    // Auto-detect input type when URL changes (for Doc/Sitemap modes)
    useEffect(() => {
        if (url.trim() && (selectedMode === 'doc' || selectedMode === 'sitemap')) {
            const detected = url.toLowerCase().includes('sitemap.xml') ? 'sitemap' : 'doc';
            // Update selected mode based on detection if not manually overridden
            if (!manualModeOverride) {
                setSelectedMode(detected);
            }
        }
    }, [url, selectedMode, manualModeOverride]);

    // Auto-scroll disabled â€” let user control their own scroll position
    // Previously scrolled to progress messages during analysis, causing jarring page jumps

    // Track whether issues list is scrollable and not scrolled to bottom
    useEffect(() => {
        const el = issuesListRef.current;
        if (!el) { setShowScrollIndicator(false); return; }
        const checkScroll = () => {
            const hasOverflow = el.scrollHeight > el.clientHeight;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
            setShowScrollIndicator(hasOverflow && !atBottom);
        };
        checkScroll();
        el.addEventListener('scroll', checkScroll);
        // Re-check on resize
        const observer = new ResizeObserver(checkScroll);
        observer.observe(el);
        return () => { el.removeEventListener('scroll', checkScroll); observer.disconnect(); };
    }, [githubIssues, analysisState.status, githubAnalysisResults]);

    // Auto-collapse progress when analysis completes + GA tracking
    useEffect(() => {
        if (analysisState.status === 'completed') {
            setProgressExpanded(false);
            trackEvent('generate_report_completed', { url: urlRef.current });
        } else if (analysisState.status === 'error') {
            setProgressExpanded(false);
            trackEvent('generate_report_failed', { error: analysisState.error, url: urlRef.current });
        } else if (analysisState.status === 'analyzing') {
            setProgressExpanded(false);
        }
    }, [analysisState.status]);

    // Cleanup WebSocket on unmount
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            // Clear timers directly so they can't fire setState after unmount
            // (don't rely solely on ws.onclose for the ping interval).
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            if (citationsTimeoutRef.current) {
                clearTimeout(citationsTimeoutRef.current);
                citationsTimeoutRef.current = null;
            }
        };
    }, []);

    const fetchFixesForSession = async (sessionId: string) => {
        try {
            const fixesUrl = `${API_BASE_URL}/sessions/${sessionId}/fixes`;
            const fixesResponse = await fetch(fixesUrl);

            if (fixesResponse.ok) {
                const fixSession = await fixesResponse.json();
                setFixes(fixSession.fixes || []);
                setShowFixPanel(true);
                console.log('Loaded fixes:', fixSession.fixes);
                setAnalysisState(prev => ({
                    ...prev,
                    status: 'completed'
                }));
            } else {
                console.warn('Could not fetch fixes from S3');
                setAnalysisState(prev => ({
                    ...prev,
                    progressMessages: [...prev.progressMessages, {
                        type: 'info',
                        message: 'Fixes ready but not accessible. Please retry re-scan later.',
                        timestamp: Date.now()
                    }]
                }));
            }
        } catch (fetchError) {
            console.error('Error fetching fixes:', fetchError);
        } finally {
            setIsGeneratingFixes(false);
        }
    };

    const connectWebSocket = (sessionId: string): Promise<WebSocket> => {
        // Always update the current session ID ref so the onmessage filter works
        currentSessionIdRef.current = sessionId;

        // If already connected and ready, just return the existing socket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            console.log('Reusing existing WebSocket connection for session:', sessionId);
            // Re-subscribe just in case (the backend handler is idempotent for subscriptions)
            wsRef.current.send(JSON.stringify({
                action: 'subscribe',
                sessionId
            }));
            return Promise.resolve(wsRef.current);
        }

        return new Promise((resolve, reject) => {
            console.log('Connecting new WebSocket...');
            const ws = new WebSocket(WEBSOCKET_URL);
            let subscribed = false;

            ws.onopen = () => {
                console.log('WebSocket connected');
                // Subscribe to session updates
                ws.send(JSON.stringify({
                    action: 'subscribe',
                    sessionId
                }));
                subscribed = true;

                // Set up heartbeat (ping) every 20 seconds to prevent timeout
                if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ action: 'ping' }));
                    }
                }, 20000);

                resolve(ws);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                if (!subscribed) {
                    reject(error);
                }
            };

            ws.onmessage = (event) => {
                try {
                    const message: ProgressMessage = JSON.parse(event.data);
                    // Use console.debug for heartbeat to avoid clutter
                    if (message.message === 'pong') return;

                    // Filter: only accept messages for the current active session (uses ref, not closure)
                    if (message.sessionId && message.sessionId !== currentSessionIdRef.current) {
                        console.debug('Ignoring message for different session:', message.sessionId, '(expected:', currentSessionIdRef.current, ')');
                        return;
                    }

                    console.log('Progress update:', message);

                    // Detect terminal error messages from agent (e.g., content gate rejection)
                    if (message.type === 'error') {
                        const terminalPatterns = [
                            'Unable to analyze',
                            'Content validation failed',
                            'contentGateFailed',
                            'Analysis failed',
                            'timed out',
                            'not a documentation page',
                            'Insufficient content',
                            'unable to access',
                            'unable to fetch',
                            'does not appear to be',
                        ];
                        const isTerminal = terminalPatterns.some(p => message.message?.includes(p));
                        if (isTerminal) {
                            console.log('Terminal error detected via WebSocket:', message.message);
                            // Save the URL for error display and reset input for all terminal errors
                            setRejectedUrl(urlRef.current);
                            setCurrentSessionId(null);
                            setAnalysisState(prev => ({
                                ...prev,
                                status: 'error',
                                error: message.message,
                                progressMessages: [...prev.progressMessages, message]
                            }));
                            // Refresh usage counter â€” rejected scans get refunded
                            window.dispatchEvent(new Event('lensy:usage-changed'));
                            return;
                        }
                    }

                    // Handle category-result messages for async card loading
                    if (message.type === 'category-result' && message.metadata?.category && message.metadata?.data) {
                        const { category, data } = message.metadata;
                        console.log(`Async card update: ${category}`, data);
                        setAsyncCards(prev => ({ ...prev, [category]: data }));
                        // Bot access data received â€” no auto-expand needed (it's a banner now, not a card)
                        // Stop citations loading when data arrives
                        if (category === 'aiDiscoverability') {
                            setCitationsLoading(false);
                        }
                        // Don't add category-result to progress messages (noisy)
                        return;
                    }

                    setAnalysisState(prev => ({
                        ...prev,
                        progressMessages: [...prev.progressMessages, message]
                    }));

                    // [NEW] Handle success message from FixGenerator during async invocation
                    // backend ProgressPublisher.success metadata contains fixCount, but no phase
                    if (message.type === 'success' && (message.phase === 'fix-generation' || message.metadata?.fixCount !== undefined) && (message.metadata?.fixCount || 0) > 0) {
                        console.log('Fix generation complete via WebSocket, fetching fixes...');
                        fetchFixesForSession(sessionId);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                if (pingIntervalRef.current) {
                    clearInterval(pingIntervalRef.current);
                    pingIntervalRef.current = null;
                }
            };

            wsRef.current = ws;
        });
    };

    const pollForResults = async (sessionId: string) => {
        const maxAttempts = 60;
        let attempts = 0;
        let lastPhase = '';

        const poll = async () => {
            try {
                attempts++;
                console.log(`Polling attempt ${attempts}/${maxAttempts}`);

                const statusResponse = await fetch(`${API_BASE_URL}/status/${sessionId}`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();

                    // Add progress messages based on status
                    if (statusData.status && statusData.status !== lastPhase) {
                        lastPhase = statusData.status;
                        const phaseMessages: Record<string, string> = {
                            'processing': 'Processing URL and fetching content...',
                            'analyzing': 'Running AI-powered dimension analysis...',
                            'link-validation': 'Validating links and checking for broken URLs...',
                            'code-analysis': 'Analyzing code snippets for issues...',
                            'ai-readiness': 'Checking AI readiness indicators...',
                            'sitemap-health': 'Analyzing sitemap health...',
                            'generating-report': 'Generating final report...'
                        };

                        const message = phaseMessages[statusData.status] || `Analysis phase: ${statusData.status}`;
                        setAnalysisState(prev => ({
                            ...prev,
                            progressMessages: [...prev.progressMessages, { type: 'progress', message, timestamp: Date.now() }]
                        }));
                    }

                    // Check for explicit failure or rejection status from backend
                    if (statusData.status === 'failed' || statusData.status === 'rejected') {
                        console.log('Analysis failed/rejected (detected via polling):', statusData.error);
                        let errorMsg = statusData.error || statusData.reason || 'Analysis failed. Check the progress messages for details.';
                        if (errorMsg === 'unreachable-url') {
                            errorMsg = 'Lensy was unable to access this URL. Please verify the URL is correct and publicly accessible.';
                        }
                        const isDocRejection = errorMsg.includes('does not appear to be') || errorMsg.includes('not a documentation page') || errorMsg.includes('non-documentation-page');
                        if (isDocRejection && !rejectedUrl) {
                            setRejectedUrl(urlRef.current);
                            setUrl('');
                            setCurrentSessionId(null);
                            setTimeout(() => { document.querySelector<HTMLInputElement>('input[placeholder*="URL"]')?.focus(); }, 100);
                        }
                        setAnalysisState(prev => {
                            // Don't overwrite if already showing doc-rejection error or user already reset
                            if (prev.status === 'idle' || (prev.status === 'error' && prev.error?.includes('does not appear to be'))) {
                                return prev;
                            }
                            return { ...prev, status: 'error', error: errorMsg };
                        });
                        return;
                    }

                    if (statusData.report) {
                        // Keep connection for fix generation

                        // Add completion message
                        setAnalysisState(prev => ({
                            ...prev,
                            progressMessages: [...prev.progressMessages, { type: 'success', message: 'Analysis complete! Generating results...', timestamp: Date.now() }]
                        }));

                        setAnalysisState(prev => ({
                            ...prev,
                            status: 'completed',
                            report: statusData.report
                        }));
                        return;
                    }
                }

                // Add periodic "still working" message every 15 seconds (3 polls)
                if (attempts % 3 === 0 && attempts < maxAttempts) {
                    setAnalysisState(prev => ({
                        ...prev,
                        progressMessages: [...prev.progressMessages, {
                            type: 'info',
                            message: `Still analyzing... (${Math.round(attempts * 5 / 60)}+ minutes elapsed)`,
                            timestamp: Date.now()
                        }]
                    }));
                }

                if (attempts >= maxAttempts) {
                    setAnalysisState(prev => ({
                        ...prev,
                        status: 'error',
                        error: 'Analysis timed out'
                    }));
                    return;
                }

                setTimeout(poll, 5000);
            } catch (error) {
                // A transient network error must NOT permanently halt polling.
                // Reschedule (respecting maxAttempts) so a single blip is survivable.
                console.error('Polling error:', error);
                if (attempts < maxAttempts) {
                    setTimeout(poll, 5000);
                } else {
                    setAnalysisState(prev => ({
                        ...prev,
                        status: 'error',
                        error: 'Analysis timed out'
                    }));
                }
            }
        };

        setTimeout(poll, 5000);
    };

    // â”€â”€â”€ GitHub Issues Mode: Fetch and Analyze â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleFetchGithubIssues = async () => {
        const urlStr = githubRepoUrl.trim();
        if (!urlStr) {
            setAnalysisState({ status: 'error', error: 'Please enter a GitHub repository URL', progressMessages: [] });
            return;
        }

        // Validate it looks like a GitHub URL or owner/repo format
        const isGitHubUrl = /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/i.test(urlStr);
        const isOwnerRepo = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(urlStr);

        if (!isGitHubUrl && !isOwnerRepo) {
            setAnalysisState({
                status: 'error',
                error: 'Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo) or owner/repo format.',
                progressMessages: []
            });
            return;
        }

        // Parse owner/repo from URL
        let owner = '', repo = '';
        try {
            if (urlStr.includes('github.com')) {
                const parts = urlStr.replace(/https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, '').split('/');
                owner = parts[0];
                repo = parts[1]?.replace(/\.git$/, '') || '';
            } else if (urlStr.includes('/')) {
                [owner, repo] = urlStr.split('/');
            }
        } catch {
            setAnalysisState({ status: 'error', error: 'Invalid GitHub URL. Use format: https://github.com/owner/repo', progressMessages: [] });
            return;
        }

        if (!owner || !repo) {
            setAnalysisState({ status: 'error', error: 'Could not parse owner/repo from URL. Use format: https://github.com/owner/repo', progressMessages: [] });
            return;
        }

        setIsFetchingGithubIssues(true);
        setGithubFetchCompleted(false);
        setGithubIssues([]);
        setSelectedGithubIssues([]);
        setGithubAnalysisResults(null);
        setDocsAsCodeConfirmation(null);
        setNoDocsAsCode(false);
        setDocsContextReady(false);
        setKbBuildState('idle');
        setKbBuildProgress([]);
        setKbInfo(null);
        setCrawlUrl('');
        setPreviewDocs(null);

        try {
            console.log(`Fetching GitHub issues for ${owner}/${repo}...`);

            // Call our backend endpoint for github issues (last 2 weeks, LLM-classified)
            const response = await fetch(`${API_BASE_URL}/github-issues`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner, repo, docsUrl: githubDocsUrl || undefined })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 429) {
                    throw new Error(errorData.message || 'GitHub API rate limit exceeded. Unauthenticated requests are limited to 60 per hour. Please wait and try again.');
                }
                if (response.status === 404) {
                    throw new Error(errorData.message || `Repository not found. Please check the URL and make sure it exists and is public.`);
                }
                if (response.status === 403) {
                    throw new Error(errorData.message || `Cannot access this repository. It may be private. Only public repositories are supported.`);
                }
                throw new Error(errorData.message || errorData.error || `Something went wrong (HTTP ${response.status}). Please try again.`);
            }

            const result = await response.json();
            console.log(`Fetched ${result.totalFetched || result.issues?.length || 0} issues (${result.dateRange}), ${result.docsRelatedCount || 0} docs-related via ${result.classificationMethod}`);

            setGithubIssues(result.issues || []);
            setGithubFetchMeta({
                totalFetched: result.totalFetched || result.issues?.length || 0,
                dateRange: result.dateRange || 'last 2 weeks',
                classificationMethod: result.classificationMethod || 'llm'
            });
            setGithubFetchCompleted(true);

            // Handle docs repo discovery results with human-in-the-loop
            if (result.docsContext?.suggestedDocsRepos?.length > 0 && !githubDocsUrl) {
                const repos = result.docsContext.suggestedDocsRepos;
                setSuggestedDocsRepos(repos);

                // Check if ANY discovered repo has actual docs content
                const reposWithDocs = repos.filter((r: any) => r.hasDocsContent);
                const reposWithoutDocs = repos.filter((r: any) => !r.hasDocsContent);

                if (reposWithDocs.length > 0) {
                    // At least one repo has real docs â€” auto-select the first one with docs
                    setGithubDocsUrl(reposWithDocs[0].fullName);
                    setDocsAsCodeConfirmation(null);
                    setDocsContextReady(true); // docs source confirmed automatically
                } else if (reposWithoutDocs.length > 0) {
                    // Found repos matching docs patterns but NO actual docs content
                    // â†’ trigger human-in-the-loop: "Do you store docs as code?"
                    setDocsAsCodeConfirmation('pending');
                    setGithubDocsUrl(''); // don't auto-select
                }
                setDocsContextHint(null);
            } else if (result.docsContext?.hint && !githubDocsUrl) {
                setDocsContextHint(result.docsContext.hint);
                setSuggestedDocsRepos([]);
                setDocsAsCodeConfirmation(null);
            } else {
                setDocsContextHint(null);
                setSuggestedDocsRepos([]);
                setDocsAsCodeConfirmation(null);
            }

            // Default to none selected â€” user picks which to analyze
            setSelectedGithubIssues([]);

        } catch (error) {
            console.error('Error fetching GitHub issues:', error);
            setAnalysisState({
                status: 'error',
                error: `Failed to fetch GitHub issues: ${error instanceof Error ? error.message : 'Unknown error'}`,
                progressMessages: []
            });
        } finally {
            setIsFetchingGithubIssues(false);
        }
    };

    // Shared handler for processing GitHub analysis results (used by both sync and async paths)
    const handleGithubAnalysisResults = (results: any) => {
        // Check if backend detected no docs-as-code
        if (results.noDocsAsCode) {
            setNoDocsAsCode(true);
            setAnalysisState({
                status: 'completed',
                sourceMode: 'github-issues',
                progressMessages: [
                    { type: 'info', message: results.message, timestamp: Date.now() }
                ]
            });
            return;
        }

        setNoDocsAsCode(false);
        setDocsSource(results.docsSource || 'repo-only');
        setGithubAnalysisResults(results.analyses || []);
        setCopiedFixIndex(null);
        setAnalysisState(prev => ({
            status: 'completed',
            sourceMode: 'github-issues',
            progressMessages: [
                ...prev.progressMessages,
                { type: 'success', message: `Analysis complete: ${results.analyses?.length || 0} issues analyzed`, timestamp: Date.now() }
            ]
        }));
    };

    const handleAnalyzeGithubIssues = async () => {
        if (selectedGithubIssues.length === 0) {
            setAnalysisState({ status: 'error', error: 'Please select at least one issue to analyze', progressMessages: [] });
            return;
        }

        // Parse owner/repo
        const urlStr = githubRepoUrl.trim();
        const parts = urlStr.replace(/https?:\/\/github\.com\//, '').replace(/\/$/, '').split('/');
        const owner = parts[0], repo = parts[1];

        const currentSessionId = `github-${Date.now()}`;
        const isAsyncCrawl = !!crawlUrl;

        setAnalysisState({
            status: 'analyzing',
            sourceMode: 'github-issues',
            progressMessages: [{ type: 'info', message: isAsyncCrawl ? 'Starting docs crawl and analysis (this may take 1-2 minutes)...' : 'Analyzing selected issues against documentation...', timestamp: Date.now() }]
        });

        try {
            const issuesToAnalyze = githubIssues.filter(i => selectedGithubIssues.includes(i.number));

            // Connect WebSocket before async crawl for real-time progress
            if (isAsyncCrawl) {
                try {
                    await connectWebSocket(currentSessionId);
                    console.log('WebSocket connected for GitHub issues analysis session:', currentSessionId);
                } catch (wsErr) {
                    console.warn('WebSocket connection failed, will use polling:', wsErr);
                }
            }

            const response = await fetch(`${API_BASE_URL}/github-issues/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner,
                    repo,
                    issues: issuesToAnalyze.map(i => ({
                        number: i.number,
                        title: i.title,
                        body: i.body,
                        html_url: i.html_url,
                        labels: i.labels
                    })),
                    docsUrl: githubDocsUrl || undefined,
                    crawlUrl: crawlUrl || undefined,
                    sessionId: currentSessionId
                })
            });

            if (!response.ok) {
                if (response.status === 429) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || 'GitHub API rate limit exceeded. Please wait and try again.');
                }
                throw new Error(`HTTP ${response.status}`);
            }

            // Handle async response (202 Accepted) â€” poll for results
            if (response.status === 202) {
                console.log('Async analysis started, polling for results...');
                setAnalysisState(prev => ({
                    ...prev,
                    progressMessages: [
                        ...prev.progressMessages,
                        { type: 'info', message: 'Analysis running in background. Live progress updates will appear below...', timestamp: Date.now() }
                    ]
                }));

                // Poll for results every 5 seconds
                const pollForResults = async () => {
                    const maxAttempts = 60; // 5 minutes max
                    for (let attempt = 0; attempt < maxAttempts; attempt++) {
                        await new Promise(resolve => setTimeout(resolve, 5000));

                        try {
                            const pollResponse = await fetch(`${API_BASE_URL}/github-issues/results/${currentSessionId}`);
                            if (pollResponse.status === 200) {
                                const results = await pollResponse.json();
                                if (results.analyses) {
                                    console.log('Got results via polling:', results);
                                    handleGithubAnalysisResults(results);
                                    return;
                                }
                            }
                            // 202 means still processing, continue polling
                        } catch (pollErr) {
                            console.warn('Poll attempt failed:', pollErr);
                        }
                    }

                    // Timeout
                    setAnalysisState(prev => ({
                        status: 'error',
                        error: 'Analysis timed out after 5 minutes. The results may still be processing â€” try refreshing.',
                        progressMessages: prev.progressMessages
                    }));
                };

                pollForResults();
                return; // Don't block â€” polling runs in background
            }

            // Synchronous response â€” handle directly
            const results = await response.json();
            handleGithubAnalysisResults(results);

        } catch (error) {
            console.error('Error analyzing GitHub issues:', error);
            setAnalysisState({
                status: 'error',
                sourceMode: 'github-issues',
                error: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                progressMessages: []
            });
        }
    };

    // â”€â”€â”€ Preview Docs: lightweight check before crawling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handlePreviewDocs = async () => {
        const rawInput = crawlUrl.trim();
        if (!rawInput) {
            setAnalysisState({ status: 'error', error: 'Please enter your docs website URL first.', progressMessages: [] });
            return;
        }

        // Normalize: strip https://, www., trailing slash, detect if full URL given
        const normalized = rawInput
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./, '')
            .replace(/\/$/, '');
        const domain = normalized.split('/')[0]; // just the host

        setIsPreviewingDocs(true);
        setPreviewDocs(null);
        setManualLlmsUrl('');

        try {
            const res = await fetch(`${API_BASE_URL}/github-issues/preview-docs?domain=${encodeURIComponent(domain)}`);
            const data = await res.json();
            setPreviewDocs(data);
            if (data.found) {
                if (data.cached && data.cachedPageCount > 0) {
                    // KB already exists in S3 cache â€” skip "Build Knowledge Base" button entirely
                    setKbBuildState('ready');
                    setKbInfo({ domain, pageCount: data.cachedPageCount });
                    setDocsContextReady(true);
                } else {
                    // No cache â€” show "Build Knowledge Base" button
                    setKbBuildState('idle');
                    setKbBuildProgress([]);
                    setKbInfo(null);
                }
            } else {
                // Auto-populate manual URL field with the domain for user to correct
                setManualLlmsUrl(`https://${domain}/llms.txt`);
            }
        } catch (err) {
            setPreviewDocs({ found: false, source: null, domain, message: 'Failed to check the domain. Please verify the URL and try again.' });
            setManualLlmsUrl(`https://${domain}/llms.txt`);
        } finally {
            setIsPreviewingDocs(false);
        }
    };

    // When user provides a manual llms.txt / sitemap URL, use that as the crawlUrl directly
    const handleConfirmManualUrl = () => {
        const url = manualLlmsUrl.trim();
        if (!url.startsWith('http')) {
            setAnalysisState({ status: 'error', error: 'Please enter a full URL starting with https://', progressMessages: [] });
            return;
        }
        // Set crawlUrl to the manual URL and treat as confirmed
        setCrawlUrl(url);
        const domain = url.replace(/^https?:\/\//i, '').split('/')[0];
        setPreviewDocs({ found: true, source: url.includes('sitemap') ? 'sitemap.xml' : 'llms.txt', sourceUrl: url, domain, pageCount: undefined, categories: [] });
        // docsContextReady is set ONLY after KB is built, not on manual URL confirmation
        setKbBuildState('idle');
        setKbBuildProgress([]);
        setKbInfo(null);
    };

    // Build Knowledge Base â€” crawl + summarize + S3 cache (separate from issue analysis)
    const handleBuildKb = async () => {
        const domain = crawlUrl.trim()
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./, '')
            .replace(/\/$/, '')
            .split('/')[0];

        const kbSessionId = `kb-${Date.now()}`;

        setKbBuildState('building');
        setKbBuildProgress([
            { type: 'info', message: `Building knowledge base for ${domain}...`, timestamp: Date.now() }
        ]);

        try {
            // Connect WebSocket for real-time progress
            try {
                const ws = await connectWebSocket(kbSessionId);
                // Override onmessage to route KB progress to kbBuildProgress (not analysisState)
                ws.onmessage = (event: MessageEvent) => {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.message === 'pong') return;
                        // Filter: only accept messages for this KB session
                        if (message.sessionId && message.sessionId !== kbSessionId) {
                            console.debug('KB ignoring message for different session:', message.sessionId);
                            return;
                        }
                        console.log('KB build progress:', message);
                        setKbBuildProgress(prev => [...prev, message]);

                        // Detect completion via success message with contextPages (only on first success, guard against overwrites)
                        if (message.type === 'success' && message.metadata?.contextPages && kbBuildStateRef.current !== 'ready') {
                            setKbInfo({ domain, pageCount: message.metadata.contextPages });
                            setKbBuildState('ready');
                            setDocsContextReady(true);
                        }
                    } catch (error) {
                        console.error('Error parsing KB progress WebSocket message:', error);
                    }
                };
            } catch (wsErr) {
                console.warn('WebSocket connection failed for KB build, will use polling:', wsErr);
            }

            // Send the build-kb request
            const response = await fetch(`${API_BASE_URL}/github-issues/build-kb`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    crawlUrl: crawlUrl.trim(),
                    sessionId: kbSessionId
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // 202 means async â€” poll for results
            if (response.status === 202) {
                const maxAttempts = 60; // 5 minutes
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    // Check if already completed via WebSocket
                    if (kbBuildState === 'ready') return;

                    await new Promise(resolve => setTimeout(resolve, 5000));
                    try {
                        const pollResponse = await fetch(`${API_BASE_URL}/github-issues/results/${kbSessionId}`);
                        if (pollResponse.status === 200) {
                            const result = await pollResponse.json();
                            if (result.status === 'kb-ready') {
                                setKbInfo({ domain: result.domain, pageCount: result.pageCount });
                                setKbBuildState('ready');
                                setDocsContextReady(true);
                                return;
                            }
                        }
                    } catch (pollErr) {
                        console.warn('KB poll attempt failed:', pollErr);
                    }
                }
                // Timeout
                setKbBuildState('error');
                setKbBuildProgress(prev => [
                    ...prev,
                    { type: 'error', message: 'Knowledge base build timed out after 5 minutes.', timestamp: Date.now() }
                ]);
            }
        } catch (error) {
            console.error('KB build failed:', error);
            setKbBuildState('error');
            setKbBuildProgress(prev => [
                ...prev,
                { type: 'error', message: `Failed to build knowledge base: ${error instanceof Error ? error.message : 'Unknown error'}`, timestamp: Date.now() }
            ]);
        }
    };

    const searchForDeveloperIssues = async (domain: string) => {
        setIsSearchingIssues(true);
        setDiscoveredIssues([]);

        try {
            console.log(`Searching for developer issues for domain: ${domain}`);

            // Call the real IssueDiscoverer Lambda function
            const sessionId = `search-${Date.now()}`;
            const searchRequest = {
                companyName: domain.split('.')[0], // Extract company name from domain
                domain: domain,
                sessionId: sessionId
            };

            const response = await fetch(`${API_BASE_URL}/discover-issues`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(searchRequest)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            // Transform the response to match our UI interface
            const transformedIssues = result.issues.map((issue: any) => ({
                id: issue.id,
                title: issue.title,
                description: issue.description,
                frequency: issue.frequency,
                sources: issue.sources.map((url: string) => {
                    // Extract source names from URLs for display
                    if (url.includes('stackoverflow.com')) return 'Stack Overflow';
                    if (url.includes('solutionfall.com')) return 'SolutionFall';
                    if (url.includes('github.com')) return 'GitHub Issues';
                    if (url.includes('reddit.com')) return 'Reddit';
                    if (url.includes('discord.gg')) return 'Discord';
                    if (url.includes('dev.to')) return 'Dev.to';
                    if (url.includes('community.')) return 'Community Forums';
                    if (url.includes('twitter.com')) return 'Twitter';
                    if (url.includes('changelog')) return 'Changelog';
                    if (url.includes('knock.app')) return 'Knock Docs';
                    if (url.includes('liveblocks.io')) return 'Liveblocks Docs';
                    return 'Developer Forums';
                })
            }));

            console.log(`Found ${transformedIssues.length} issues from ${result.searchSources?.length || 0} sources`);
            setDiscoveredIssues(transformedIssues);

        } catch (error) {
            console.error('Error searching for developer issues:', error);
            console.error('Error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });

            // Show error message to user
            setDiscoveredIssues([]);

        } finally {
            setIsSearchingIssues(false);
        }
    };

    const handleGenerateFixes = async () => {
        setFixSuccessMessage(null);
        setLastModifiedFile(null);
        if (!analysisState.report) return;
        if (!currentSessionId) {
            console.error('No active session ID');
            setAnalysisState(prev => ({
                ...prev,
                status: 'completed',
                error: 'No active session found. Please run analysis first.'
            }));
            return;
        }

        // Ensure WebSocket is connected before generating fixes
        await connectWebSocket(currentSessionId);

        setIsGeneratingFixes(true);
        setShowFixPanel(false);
        setAnalysisState(prev => ({
            ...prev,
            status: 'generating',
            progressMessages: [
                ...prev.progressMessages,
                { type: 'info', message: 'Starting AI fix generation...', timestamp: Date.now() }
            ]
        }));

        try {
            // Map selected IDs back to recommendation actions
            const selectedActions = selectedRecommendations.map(id => {
                const [dim, indexStr] = id.split('-');
                const index = parseInt(indexStr);
                const result = (analysisState.report?.dimensions as any)[dim];
                return result?.recommendations?.[index]?.action;
            }).filter(Boolean);

            // ... (model mapping logic)
            const modelMap: Record<string, string> = {
                'claude': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
                'titan': 'amazon.titan-text-premier-v1:0',
                'llama': 'us.meta.llama3-1-70b-instruct-v1:0',
                'auto': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
            };
            const bedrockModelId = modelMap[selectedModel] || modelMap['claude'];

            const response = await fetch(`${API_BASE_URL}/generate-fixes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    selectedRecommendations: selectedActions,
                    modelId: bedrockModelId
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Fix generation failed: ${errorText}`);
            }

            const result = await response.json();
            console.log('Fix generation result:', result);

            // [NEW] Handle 202 Accepted (async) vs 200 OK (sync)
            if (response.status === 202) {
                setAnalysisState(prev => ({
                    ...prev,
                    status: 'generating', // Keep in generating state until WebSocket message
                    progressMessages: [...prev.progressMessages, {
                        type: 'info',
                        message: 'Fix generation request accepted. Waiting for completion...',
                        timestamp: Date.now()
                    }]
                }));
            } else {
                // Handle legacy sync response if any
                setAnalysisState(prev => ({
                    ...prev,
                    status: 'completed',
                    progressMessages: [...prev.progressMessages, {
                        type: 'success',
                        message: `Generated ${result.fixCount} fixes`,
                        timestamp: Date.now()
                    }]
                }));

                if (result.success && result.fixCount > 0 && currentSessionId) {
                    fetchFixesForSession(currentSessionId);
                }
            }
        } catch (error) {
            console.error('Error generating fixes:', error);
            setAnalysisState(prev => ({
                ...prev,
                status: 'error',
                error: error instanceof Error ? error.message : 'Failed to generate fixes'
            }));
            setIsGeneratingFixes(false);
        }
    };

    const handleApplyFixes = async (selectedFixIds: string[]) => {
        setFixSuccessMessage(null); // Clear previous messages
        setLastModifiedFile(null);
        setAnalysisState(prev => ({
            ...prev,
            status: 'applying',
            progressMessages: [
                ...prev.progressMessages,
                { type: 'info', message: 'Applying selected fixes and purging CloudFront cache...', timestamp: Date.now() }
            ]
        }));
        setIsApplyingFixes(true);
        try {
            const response = await fetch(`${API_BASE_URL}/apply-fixes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    selectedFixIds
                })
            });

            if (response.ok) {
                const result = await response.json();
                setAnalysisState(prev => ({
                    ...prev,
                    status: 'completed',
                    report: undefined, // Clear report to force re-scan
                }));
                // Set prominent success message
                setFixSuccessMessage(`${result.message}. Please click "Re-scan" to verify.`);
                if (result.filename) {
                    setLastModifiedFile(result.filename);
                }

                // Clear fixing and selection states to prevent persistence of old issues
                setFixes([]);
                setSelectedRecommendations([]);
                setSelectedIssues([]);
                setShowFixPanel(false);
                setForceFreshScan(true);
                setCurrentSessionId(null); // Force a new session for the re-scan

                // Show a temporary success alert or scroll to progress
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to apply fixes');
            }
        } catch (e: any) {
            console.error(e);
            setAnalysisState(prev => ({
                ...prev,
                status: 'error',
                error: `Failed to apply fixes: ${e.message}`,
                progressMessages: [...prev.progressMessages, {
                    type: 'error',
                    message: `Failed to apply fixes: ${e.message}`,
                    timestamp: Date.now()
                }]
            }));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } finally {
            setIsApplyingFixes(false);
        }
    };

    // â”€â”€ Run AI Citations check on-demand â”€â”€
    const [citationsLoading, setCitationsLoading] = useState(false);
    const handleRunCitations = async () => {
        if (!currentSessionId || citationsLoading) {
            console.warn('[Citations] Skipped: sessionId=', currentSessionId, 'loading=', citationsLoading);
            return;
        }
        const citationUrl = urlRef.current || url || (analysisState.report as any)?.url;
        if (!citationUrl) {
            console.warn('[Citations] Skipped: no URL available');
            return;
        }

        console.log('[Citations] Starting citation check for:', citationUrl, 'session:', currentSessionId);
        trackEvent('run_citations_clicked', { url: citationUrl });
        setCitationsLoading(true);
        setHeroTab('citations');

        try {
            // Reconnect WebSocket to receive category-result messages
            try {
                await connectWebSocket(currentSessionId);
                console.log('[Citations] WebSocket connected');
            } catch (e) {
                console.warn('[Citations] WebSocket reconnect failed, will poll:', e);
            }

            const resp = await fetch(`${API_BASE_URL}/run-citations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: citationUrl, sessionId: currentSessionId }),
            });
            if (!resp.ok) {
                const errorBody = await resp.json().catch(() => ({}));
                throw new Error(errorBody.error || `Citation check request failed with ${resp.status}`);
            }
            console.log('[Citations] API response:', resp.status);

            // Timeout fallback â€” WebSocket should deliver results, but stop loading after 90s.
            // Tracked in a ref so it can be cleared on unmount (avoids setState-after-unmount).
            if (citationsTimeoutRef.current) clearTimeout(citationsTimeoutRef.current);
            citationsTimeoutRef.current = setTimeout(() => setCitationsLoading(false), 90000);
        } catch (e) {
            console.error('[Citations] Citation check failed:', e);
            setCitationsLoading(false);
        }
    };

    const handleAnalyze = async (overrideUrlOrOptions?: any, optionsArg?: { forceJsRender?: boolean }) => {
        const overrideUrl = typeof overrideUrlOrOptions === 'string' ? overrideUrlOrOptions : undefined;
        const options = typeof overrideUrlOrOptions === 'object' ? overrideUrlOrOptions : optionsArg;
        const actualUrl = overrideUrl || url;
        if (overrideUrl) setUrl(overrideUrl);
        setFixSuccessMessage(null);
        setLastModifiedFile(null);
        setAsyncCards({}); // Clear async card state for fresh analysis
        sessionStorage.removeItem('lensy-audit-state'); // Clear stale results
        setActiveDetailCard(null);
        setShowAllRecs(false);
        setRejectedUrl(null); // Clear any previous rejection
        const currentMode = manualModeOverride || selectedMode;

        // Handle GitHub Issues mode
        if (currentMode === 'github-issues') {
            if (githubIssues.length === 0) {
                // First click: fetch issues
                handleFetchGithubIssues();
            } else if (selectedGithubIssues.length > 0) {
                // Second click: analyze selected issues
                handleAnalyzeGithubIssues();
            } else {
                setAnalysisState({ status: 'error', error: 'Please select at least one issue to analyze', progressMessages: [] });
            }
            return;
        }

        // Validate inputs based on mode
        if (currentMode === 'issue-discovery') {
            if (!companyDomain.trim()) {
                setAnalysisState({ status: 'error', error: 'Please enter a company domain', progressMessages: [] });
                return;
            }
            if (selectedIssues.length === 0) {
                setAnalysisState({ status: 'error', error: 'Please select at least one issue to analyze', progressMessages: [] });
                return;
            }
        } else {
            if (!actualUrl.trim()) {
                setAnalysisState({ status: 'error', error: 'Please enter a URL', progressMessages: [] });
                return;
            }

            // Auto-prepend https:// if no protocol
            let normalizedUrl = actualUrl.trim();
            urlRef.current = normalizedUrl;
            if (!/^https?:\/\//i.test(normalizedUrl)) {
                normalizedUrl = `https://${normalizedUrl}`;
            }

            try {
                new URL(normalizedUrl);
            } catch {
                setAnalysisState({ status: 'error', error: 'Please enter a valid URL', progressMessages: [] });
                return;
            }

            // Update state with normalized URL so downstream code uses it
            if (normalizedUrl !== url) {
                setUrl(normalizedUrl);
            }
            // Also update the ref used by WebSocket callbacks
            urlRef.current = normalizedUrl;
        }

        trackEvent('generate_report_started', { url: urlRef.current || actualUrl, mode: currentMode });

        setAnalysisState({
            status: 'analyzing',
            sourceMode: currentMode,
            progressMessages: [
                { type: 'info', message: 'Starting analysis...', timestamp: Date.now() }
            ]
        });

        const sessionId = `session-${Date.now()}`;
        setCurrentSessionId(sessionId); // Store session ID for later use
        const finalInputType = currentMode;

        try {
            // Handle issue-discovery mode differently
            if (finalInputType === 'issue-discovery') {
                // Get selected issues
                const issuesToValidate = discoveredIssues.filter(issue => selectedIssues.includes(issue.id));

                console.log(`Validating ${issuesToValidate.length} selected issues`);

                // Call validate-issues endpoint
                const response = await fetch(`${API_BASE_URL}/validate-issues`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        issues: issuesToValidate.map(issue => ({
                            id: issue.id,
                            title: issue.title,
                            description: issue.description,
                            frequency: issue.frequency,
                            sources: issue.sources.map(source => {
                                // Convert display names back to URLs (best effort)
                                if (source === 'Stack Overflow') return 'https://stackoverflow.com';
                                if (source === 'GitHub Issues') return 'https://github.com';
                                if (source === 'Reddit') return 'https://reddit.com';
                                return source;
                            }),
                            category: 'general', // Default category
                            severity: 'medium', // Default severity
                            lastSeen: new Date().toISOString().split('T')[0],
                            relatedPages: [] // Will use sitemap fallback
                        })),
                        domain: companyDomain,
                        sessionId: sessionId
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const validationResults = await response.json();

                console.log('Validation results:', validationResults);

                // Store results for display
                setValidationResults(validationResults);

                // Store results and show completion
                setAnalysisState({
                    status: 'completed',
                    progressMessages: [
                        { type: 'success', message: `Validated ${validationResults.validationResults.length} issues`, timestamp: Date.now() },
                        { type: 'info', message: `Found ${validationResults.summary.resolved} resolved, ${validationResults.summary.potentialGaps} potential gaps, ${validationResults.summary.criticalGaps} critical gaps`, timestamp: Date.now() }
                    ]
                });

                // TODO: Display validation results in UI
                // For now, log to console
                console.table(validationResults.summary);

            } else {
                // Original doc/sitemap mode logic
                const analysisRequest: AnalysisRequest = {
                    url: urlRef.current || actualUrl,
                    selectedModel,
                    sessionId,
                    inputType: finalInputType,
                    contextAnalysis: (contextAnalysisEnabled && finalInputType === 'doc') ? {
                        enabled: true,
                        maxContextPages: 5
                    } : undefined,
                    cacheControl: {
                        enabled: forceFreshScan ? false : cacheEnabled
                    },
                    sitemapUrl: sitemapUrl.trim() || undefined,
                    llmsTxtUrl: llmsTxtUrl.trim() || undefined,
                    useAgent: useAgentEngine,
                    skipCitations: true,
                    forceJsRender: options?.forceJsRender,
                };
                if (forceFreshScan) setForceFreshScan(false);

                // Connect WebSocket
                try {
                    await connectWebSocket(sessionId);
                    setAnalysisState(prev => ({
                        ...prev,
                        progressMessages: [...prev.progressMessages, { type: 'info', message: 'Real-time updates connected', timestamp: Date.now() }]
                    }));
                } catch (wsError) {
                    console.warn('WebSocket failed, using polling only:', wsError);
                    // Silently fall back to polling - no need to alarm users
                }

                // Start analysis
                setAnalysisState(prev => ({
                    ...prev,
                    progressMessages: [...prev.progressMessages, { type: 'info', message: 'Submitting analysis request...', timestamp: Date.now() }]
                }));

                const response = await fetch(`${API_BASE_URL}/scan-doc`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(analysisRequest)
                });

                if (!response.ok) {
                    if (response.status === 429 && !skipRateLimit) {
                        const errorData = await response.json().catch(() => ({}));
                        window.dispatchEvent(new Event('lensy:usage-changed'));
                        setAnalysisState({
                            status: 'rate-limited' as any,
                            error: errorData.message || "You've used all your free audits for today.",
                            progressMessages: [],
                        });
                        return;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }

                const result = await response.json();

                // Refresh usage count in header
                window.dispatchEvent(new Event('lensy:usage-changed'));

                setAnalysisState(prev => ({
                    ...prev,
                    executionArn: result.executionArn,
                    progressMessages: [...prev.progressMessages, {
                        type: 'success',
                        message: 'Request accepted! Analysis started on server...',
                        timestamp: Date.now()
                    }]
                }));

                pollForResults(sessionId);
            }

        } catch (error) {
            if (wsRef.current) wsRef.current.close();
            setAnalysisState({
                status: 'error',
                error: error instanceof Error ? error.message : 'Analysis failed',
                progressMessages: []
            });
        }
    };

    const getScoreColor = (score: number | null): "default" | "success" | "warning" | "error" => {
        if (score === null) return 'default';
        if (score >= 80) return 'success';
        if (score >= 60) return 'warning';
        return 'error';
    };

    const getConfidenceColor = (confidence: string): "default" | "success" | "warning" | "error" => {
        switch (confidence) {
            case 'high': return 'success';
            case 'medium': return 'warning';
            case 'low': return 'error';
            default: return 'default';
        }
    };

    const getProgressIcon = (type: ProgressMessage['type']) => {
        switch (type) {
            case 'success':
                return <CheckCircleIcon sx={{ color: 'var(--text-primary)' }} />;
            case 'error':
                return <ErrorIcon sx={{ color: '#dc2626' }} />;
            case 'warning':
                return <WarningIcon sx={{ color: 'var(--text-muted)' }} />;
            case 'cache-hit':
                return <FlashOnIcon sx={{ color: 'var(--text-primary)' }} />;
            case 'cache-miss':
                return <CachedIcon sx={{ color: 'var(--text-muted)' }} />;
            case 'progress':
                return <HourglassEmptyIcon sx={{ color: 'var(--text-muted)' }} />;
            default:
                return <InfoIcon sx={{ color: 'var(--text-muted)' }} />;
        }
    };

    const exportValidationReport = (validationResults: any) => {
        const analysisDate = new Date().toLocaleDateString();

        let markdown = `# DOCUMENTATION QUALITY VALIDATION REPORT\n\n`;
        markdown += `**Company Domain:** ${companyDomain}\n`;
        markdown += `**Analyzed:** ${analysisDate}\n`;
        markdown += `**Total Issues Validated:** ${validationResults.summary.totalIssues}\n`;
        markdown += `**Processing Time:** ${validationResults.processingTime}ms\n\n`;

        // Executive Summary
        markdown += `## EXECUTIVE SUMMARY\n\n`;

        const isProactive = validationResults.validationResults.some((r: any) => r.issueTitle.startsWith('Audit:'));
        const sourceDescription = isProactive
            ? "proactive audit items based on industry best practices"
            : `real developer issue${validationResults.summary.totalIssues === 1 ? '' : 's'} found on Stack Overflow`;

        markdown += `This report analyzes ${validationResults.summary.totalIssues} ${sourceDescription}. Each issue was validated against existing documentation to identify gaps and improvement opportunities.\n\n`;

        // Summary Statistics
        markdown += `### Summary Statistics\n\n`;
        markdown += `- **âœ… Resolved Issues:** ${validationResults.summary.resolved} (${((validationResults.summary.resolved / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
        markdown += `- **ðŸ” Confirmed Gaps:** ${validationResults.summary.confirmed || 0} (${((validationResults.summary.confirmed / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
        markdown += `- **âš ï¸ Potential Gaps:** ${validationResults.summary.potentialGaps} (${((validationResults.summary.potentialGaps / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
        markdown += `- **âŒ Critical Gaps:** ${validationResults.summary.criticalGaps} (${((validationResults.summary.criticalGaps / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n\n`;

        // Key Insights
        markdown += `### Key Insights\n\n`;
        if (validationResults.summary.criticalGaps > 0) {
            markdown += `ðŸš¨ **${validationResults.summary.criticalGaps} critical documentation gaps** require immediate attention - these are issues developers are actively struggling with but have no documentation coverage.\n\n`;
        }
        if (validationResults.summary.potentialGaps > 0) {
            markdown += `âš ï¸ **${validationResults.summary.potentialGaps} potential gaps** exist where documentation pages exist but may not fully address developer needs.\n\n`;
        }
        if (validationResults.summary.resolved > 0) {
            markdown += `âœ… **${validationResults.summary.resolved} issues appear well-documented** with comprehensive coverage.\n\n`;
        }

        // Sitemap Health Analysis (if available)
        if (validationResults.sitemapHealth) {
            const sitemap = validationResults.sitemapHealth;
            markdown += `## SITEMAP HEALTH ANALYSIS\n\n`;
            markdown += `This analysis checked all ${sitemap.totalUrls} URLs from the documentation sitemap for accessibility and health.\n\n`;

            markdown += `### Health Summary\n\n`;
            markdown += `- **âœ… Healthy URLs:** ${sitemap.healthyUrls} (${sitemap.healthPercentage}%)\n`;
            markdown += `- **ðŸ”´ Broken URLs (404):** ${sitemap.brokenUrls || 0}\n`;
            markdown += `- **ðŸŸ¡ Access Denied (403):** ${sitemap.accessDeniedUrls || 0}\n`;
            markdown += `- **ðŸŸ  Timeout Issues:** ${sitemap.timeoutUrls || 0}\n`;
            markdown += `- **âš« Other Errors:** ${sitemap.otherErrorUrls || 0}\n\n`;

            if (sitemap.linkIssues.length > 0) {
                markdown += `### Link Issues Details\n\n`;

                const brokenLinks = sitemap.linkIssues.filter((issue: any) => issue.issueType === '404');
                const accessDeniedLinks = sitemap.linkIssues.filter((issue: any) => issue.issueType === 'access-denied');
                const timeoutLinks = sitemap.linkIssues.filter((issue: any) => issue.issueType === 'timeout');
                const otherErrors = sitemap.linkIssues.filter((issue: any) => issue.issueType === 'error');

                if (brokenLinks.length > 0) {
                    markdown += `#### ðŸ”´ Broken Links (404) - ${brokenLinks.length}\n\n`;
                    brokenLinks.forEach((issue: any, i: number) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (accessDeniedLinks.length > 0) {
                    markdown += `#### ðŸŸ¡ Access Denied (403) - ${accessDeniedLinks.length}\n\n`;
                    accessDeniedLinks.forEach((issue: any, i: number) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (timeoutLinks.length > 0) {
                    markdown += `#### ðŸŸ  Timeout Issues - ${timeoutLinks.length}\n\n`;
                    timeoutLinks.forEach((issue: any, i: number) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (otherErrors.length > 0) {
                    markdown += `#### âš« Other Errors - ${otherErrors.length}\n\n`;
                    otherErrors.forEach((issue: any, i: number) => {
                        markdown += `${i + 1}. \`${issue.url}\` (${issue.status})\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }
            } else {
                markdown += `### âœ… All Links Healthy\n\nNo broken links or accessibility issues found in the documentation sitemap!\n\n`;
            }
        }

        // Detailed Issue Analysis
        markdown += `## DETAILED ISSUE ANALYSIS\n\n`;

        validationResults.validationResults.forEach((result: any, index: number) => {
            const statusEmoji = result.status === 'resolved' ? 'âœ…' :
                result.status === 'confirmed' ? 'ðŸ”' :
                    result.status === 'potential-gap' ? 'âš ï¸' :
                        result.status === 'critical-gap' ? 'âŒ' : 'â“';

            markdown += `### ${index + 1}. ${statusEmoji} ${result.issueTitle}\n\n`;
            markdown += `**Status:** ${result.status.toUpperCase()}\n`;
            markdown += `**Confidence:** ${result.confidence}%\n\n`;

            // Evidence Analysis
            if (result.evidence && result.evidence.length > 0) {
                markdown += `**ðŸ“„ Documentation Evidence (${result.evidence.length} pages analyzed):**\n\n`;
                result.evidence.forEach((evidence: any, idx: number) => {
                    markdown += `${idx + 1}. **${evidence.pageUrl}** - ${evidence.pageTitle}\n`;
                    if (evidence.semanticScore !== undefined) {
                        markdown += `   - Semantic Match: ${(evidence.semanticScore * 100).toFixed(0)}%\n`;
                    }
                    markdown += `   - Code Examples: ${evidence.codeExamples}\n`;
                    markdown += `   - Production Guidance: ${evidence.productionGuidance ? 'Yes' : 'No'}\n`;
                    if (evidence.contentGaps.length > 0) {
                        markdown += `   - Missing Content: ${evidence.contentGaps.join(', ')}\n`;
                    }
                    markdown += `\n`;
                });
            }

            // AI Recommendations
            if (result.recommendations && result.recommendations.length > 0) {
                markdown += `**ðŸ’¡ AI-Generated Recommendations:**\n\n`;
                result.recommendations.forEach((rec: string, idx: number) => {
                    // PRESERVE the full markdown formatting including code blocks
                    markdown += `${idx + 1}. ${rec}\n\n`;
                });
            }

            // Potential Gaps
            if (result.potentialGaps && result.potentialGaps.length > 0) {
                markdown += `**âš ï¸ Identified Gaps:**\n\n`;
                result.potentialGaps.forEach((gap: any, idx: number) => {
                    markdown += `- **${gap.pageUrl || 'General'}:** ${gap.reasoning}\n`;
                    if (gap.missingContent && gap.missingContent.length > 0) {
                        markdown += `  Missing: ${gap.missingContent.join(', ')}\n`;
                    }
                });
                markdown += `\n`;
            }

            markdown += `---\n\n`;
        });

        // Recommendations Summary
        markdown += `## PRIORITY RECOMMENDATIONS\n\n`;

        const criticalIssues = validationResults.validationResults.filter((r: any) => r.status === 'critical-gap');
        const confirmedIssues = validationResults.validationResults.filter((r: any) => r.status === 'confirmed');
        const potentialGaps = validationResults.validationResults.filter((r: any) => r.status === 'potential-gap');

        if (criticalIssues.length > 0) {
            markdown += `### ðŸš¨ Critical Priority (${criticalIssues.length} issues)\n\n`;
            criticalIssues.forEach((issue: any, idx: number) => {
                markdown += `${idx + 1}. **Create documentation for:** ${issue.issueTitle}\n`;
                markdown += `   - Developer Impact: High (no existing coverage)\n`;
                markdown += `   - Confidence: ${issue.confidence}%\n\n`;
            });
        }

        if (confirmedIssues.length > 0) {
            markdown += `### ðŸ” High Priority (${confirmedIssues.length} confirmed gaps)\n\n`;
            confirmedIssues.forEach((issue: any, idx: number) => {
                markdown += `${idx + 1}. **Fix incomplete documentation for:** ${issue.issueTitle}\n`;
                markdown += `   - Developer Impact: High (docs exist but miss key info)\n`;
                markdown += `   - Confidence: ${issue.confidence}%\n\n`;
            });
        }

        if (potentialGaps.length > 0) {
            markdown += `### âš ï¸ Medium Priority (${potentialGaps.length} issues)\n\n`;
            potentialGaps.forEach((issue: any, idx: number) => {
                markdown += `${idx + 1}. **Enhance documentation for:** ${issue.issueTitle}\n`;
                markdown += `   - Developer Impact: Medium (partial coverage exists)\n`;
                markdown += `   - Confidence: ${issue.confidence}%\n\n`;
            });
        }

        markdown += `## METHODOLOGY\n\n`;
        markdown += `This analysis used AI-powered semantic search to match real developer issues against existing documentation. Each issue was:\n\n`;
        markdown += `1. **Discovered** from Stack Overflow developer community\n`;
        markdown += `2. **Analyzed** using semantic similarity matching against documentation\n`;
        markdown += `3. **Validated** by fetching and analyzing actual page content\n`;
        markdown += `4. **Scored** for confidence based on content relevance and completeness\n`;
        markdown += `5. **Enhanced** with AI-generated improvement recommendations\n\n`;

        markdown += `---\n\n`;
        markdown += `*Report generated by Documentation Quality Auditor*\n`;
        markdown += `*Analysis Date: ${analysisDate}*\n`;
        markdown += `*Total Processing Time: ${validationResults.processingTime}ms*\n`;

        // Create and download file
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url_obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url_obj;

        // Safety check for domain
        const safeDomain = companyDomain ? companyDomain.replace(/[^a-zA-Z0-9]/g, '-') : 'analysis';
        const filename = `documentation-validation-report-${safeDomain}-${new Date().toISOString().split('T')[0]}.md`;

        a.download = filename;
        document.body.appendChild(a);
        a.click();

        // Delay cleanup to ensure download starts
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url_obj);
        }, 1000);
    };

    const exportMarkdownReport = (report: FinalReport) => {
        const analysisDate = new Date().toLocaleDateString();

        let markdown = `# DOCUMENTATION QUALITY REPORT\n\n`;
        markdown += `**URL:** ${url}\n`;
        markdown += `**Analyzed:** ${analysisDate}\n`;

        // Handle sitemap mode vs doc mode scoring
        // Only use sitemap layout if we are explicitly in sitemap mode
        if ((manualModeOverride || selectedMode) === 'sitemap' && report.sitemapHealth) {
            // SITEMAP MODE: Show health percentage
            markdown += `**Overall Health:** ${report.sitemapHealth.healthPercentage}%\n`;
            markdown += `**Total URLs Checked:** ${report.sitemapHealth.totalUrls}\n`;
            markdown += `**Healthy URLs:** ${report.sitemapHealth.healthyUrls}\n\n`;

            markdown += `## SITEMAP HEALTH SUMMARY\n\n`;
            markdown += `- **Total URLs:** ${report.sitemapHealth.totalUrls}\n`;
            markdown += `- **Healthy:** ${report.sitemapHealth.healthyUrls} (${report.sitemapHealth.healthPercentage}%)\n`;
            markdown += `- **Broken (404):** ${report.sitemapHealth.brokenUrls}\n`;
            markdown += `- **Access Denied (403):** ${report.sitemapHealth.accessDeniedUrls}\n`;
            markdown += `- **Timeout:** ${report.sitemapHealth.timeoutUrls}\n`;
            markdown += `- **Other Errors:** ${report.sitemapHealth.otherErrorUrls}\n\n`;

            // Show broken links if any
            if (report.sitemapHealth.linkIssues && report.sitemapHealth.linkIssues.length > 0) {
                markdown += `## LINK ISSUES DETAILS\n\n`;

                const brokenLinks = report.sitemapHealth.linkIssues.filter(issue => issue.issueType === '404');
                const accessDeniedLinks = report.sitemapHealth.linkIssues.filter(issue => issue.issueType === 'access-denied');
                const timeoutLinks = report.sitemapHealth.linkIssues.filter(issue => issue.issueType === 'timeout');
                const otherErrors = report.sitemapHealth.linkIssues.filter(issue => issue.issueType === 'error');

                if (brokenLinks.length > 0) {
                    markdown += `### Broken Links (404) - ${brokenLinks.length}\n\n`;
                    brokenLinks.forEach((issue, i) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (accessDeniedLinks.length > 0) {
                    markdown += `### Access Denied (403) - ${accessDeniedLinks.length}\n\n`;
                    accessDeniedLinks.forEach((issue, i) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (timeoutLinks.length > 0) {
                    markdown += `### Timeout Issues - ${timeoutLinks.length}\n\n`;
                    timeoutLinks.forEach((issue, i) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (otherErrors.length > 0) {
                    markdown += `### Other Errors - ${otherErrors.length}\n\n`;
                    otherErrors.forEach((issue, i) => {
                        markdown += `${i + 1}. \`${issue.url}\` (${issue.status})\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }
            } else if (report.sitemapHealth.error) {
                markdown += `## SITEMAP HEALTH ERROR\n\n`;
                markdown += `âš ï¸ **Check Failed:** ${report.sitemapHealth.error}\n\n`;
            } else {
                markdown += `## LINK ISSUES\n\nâœ“ No broken links found - all URLs are healthy!\n\n`;
            }

        } else if ((manualModeOverride || selectedMode) === 'doc') {
            // DOC MODE
            markdown += `**Overall Score:** ${report.overallScore}/100\n\n`;

            markdown += `## DIMENSION SCORES\n\n`;
            Object.entries(report.dimensions || {}).forEach(([dimension, result]) => {
                const rawScore = result.score || 0;
                const displayScore = rawScore > 10 ? (rawScore / 10).toFixed(1) : rawScore;
                markdown += `**${dimension.charAt(0).toUpperCase() + dimension.slice(1)}:** ${displayScore}/10\n`;
            });

            // DOC MODE SITEMAP HEALTH (if available)
            if (report.sitemapHealth) {
                markdown += `\n## SITEMAP HEALTH SUMMARY\n\n`;
                if (report.sitemapHealth.error) {
                    markdown += `âš ï¸ **Check Failed:** ${report.sitemapHealth.error}\n\n`;
                } else {
                    markdown += `- **Total URLs:** ${report.sitemapHealth.totalUrls}\n`;
                    markdown += `- **Healthy:** ${report.sitemapHealth.healthyUrls} (${report.sitemapHealth.healthPercentage}%)\n`;
                    markdown += `- **Broken (404):** ${report.sitemapHealth.brokenUrls}\n`;
                }
            }

            // AI Readiness Assessment
            if (report.aiReadiness) {
                markdown += `\n## AI-READINESS ASSESSMENT\n\n`;
                markdown += `**Overall AI Score:** ${report.aiReadiness.overallScore}/100\n\n`;

                markdown += `### Key Checks\n`;
                markdown += `- **llms.txt:** ${report.aiReadiness.llmsTxt.found ? 'âœ… Found' : 'âŒ Missing'}\n`;
                markdown += `- **llms-full.txt:** ${report.aiReadiness.llmsFullTxt.found ? 'âœ… Found' : 'âŒ Missing'}\n`;
                markdown += `- **Robots.txt AI Rules:** ${report.aiReadiness.robotsTxt.aiDirectives.length > 0 ? 'âœ… ' + report.aiReadiness.robotsTxt.aiDirectives.length + ' rules found' : 'âš ï¸ No specific AI rules'}\n`;
                markdown += `- **Structured Data (JSON-LD):** ${report.aiReadiness.structuredData.hasJsonLd ? 'âœ… Found' : 'âŒ Missing'}\n`;

                if (report.aiReadiness.recommendations.length > 0) {
                    markdown += `\n### Recommendations\n`;
                    report.aiReadiness.recommendations.forEach(rec => markdown += `- ${rec}\n`);
                }
            }

            // Spelling & Typos
            const spellingIssues = report.dimensions?.clarity?.spellingIssues || [];
            if (spellingIssues.length > 0) {
                markdown += `\n## SPELLING & TYPOS (${spellingIssues.length})\n\n`;
                markdown += `| Incorrect | Correct | Context |\n`;
                markdown += `|-----------|---------|---------|\n`;
                spellingIssues.forEach(m => {
                    markdown += `| ${m.incorrect} | **${m.correct}** | ...${m.context.replace(/\|/g, '-').replace(/\n/g, ' ')}... |\n`;
                });
            }

            // Configuration & Code Issues
            const configIssues = report.dimensions?.accuracy?.codeIssues || [];
            if (configIssues.length > 0) {
                markdown += `\n## CONFIGURATION & CODE ISSUES (${configIssues.length})\n\n`;
                configIssues.forEach((issue, i) => {
                    markdown += `### ${i + 1}. ${issue.type.toUpperCase()}\n`;
                    markdown += `**Description:** ${issue.description}\n`;
                    markdown += `**Location:** ${issue.location}\n`;
                    markdown += `\`\`\`\n${issue.codeFragment}\n\`\`\`\n\n`;
                });
            }

            markdown += `\n## CRITICAL FINDINGS\n\n`;

            // URL Slug Analysis - NEW
            const urlSlugAnalysis = (report as any).urlSlugAnalysis;
            if (urlSlugAnalysis && urlSlugAnalysis.issues && urlSlugAnalysis.issues.length > 0) {
                markdown += `### URL Slug Issues (${urlSlugAnalysis.issues.length}) âš ï¸\n\n`;
                markdown += `| Segment | Issue | Suggestion | Confidence |\n`;
                markdown += `|---------|-------|------------|------------|\n`;
                urlSlugAnalysis.issues.forEach((issue: any) => {
                    markdown += `| ${issue.segment} | Likely typo | **${issue.suggestion}** | ${issue.confidence} |\n`;
                });
                markdown += `\n**Impact:** URL typos are particularly problematic because:\n`;
                markdown += `- Developers bookmark and share these URLs, perpetuating the mistake\n`;
                markdown += `- Fixing later requires setting up redirects\n`;
                markdown += `- It signals lack of automated quality checks in the documentation pipeline\n\n`;
                markdown += `**Recommendation:** Consider fixing this URL and setting up a 301 redirect from the old URL to maintain existing bookmarks.\n\n`;
            }

            // Link Issues (404s and other errors)
            const linkIssues = (report.linkAnalysis.linkIssueFindings || report.linkAnalysis.linkValidation?.linkIssueFindings) || [];
            const brokenLinks = linkIssues.filter((link: any) => link.issueType === '404');
            const otherIssues = linkIssues.filter((link: any) => link.issueType !== '404');

            markdown += `### Link Issues (${linkIssues.length})\n\n`;

            if (brokenLinks.length > 0) {
                markdown += `#### Broken Links (404) - ${brokenLinks.length}\n\n`;
                brokenLinks.forEach((link: any, i: number) => {
                    markdown += `${i + 1}. **${link.anchorText}** â†’ \`${link.url}\`\n`;
                    markdown += `   Error: ${link.errorMessage}\n\n`;
                });
            }

            if (otherIssues.length > 0) {
                markdown += `#### Other Link Issues - ${otherIssues.length}\n\n`;
                otherIssues.forEach((link: any, i: number) => {
                    markdown += `${i + 1}. **${link.anchorText}** â†’ \`${link.url}\` (${link.status})\n`;
                    markdown += `   Issue: ${link.errorMessage}\n`;
                    markdown += `   Type: ${link.issueType === 'access-denied' ? 'Access Denied (403)' : link.issueType === 'timeout' ? 'Timeout' : 'Error'}\n\n`;
                });
            }

            if (linkIssues.length === 0) {
                markdown += `âœ“ None found\n\n`;
            }

            // Deprecated Code
            const deprecatedCode = report.codeAnalysis.enhancedAnalysis?.deprecatedFindings || [];
            markdown += `### Deprecated Code (${deprecatedCode.length})\n\n`;
            if (deprecatedCode.length === 0) {
                markdown += `âœ“ None found\n\n`;
            } else {
                deprecatedCode.forEach((finding, i) => {
                    markdown += `${i + 1}. **${finding.method}** in ${finding.location}\n`;
                    markdown += `   - Deprecated in: ${finding.deprecatedIn}\n`;
                    if (finding.removedIn) {
                        markdown += `   - Removed in: ${finding.removedIn}\n`;
                    }
                    markdown += `   - Replacement: ${finding.replacement}\n`;
                    markdown += `   - Confidence: ${finding.confidence}\n\n`;
                });
            }

            // Syntax Errors
            const syntaxErrors = report.codeAnalysis.enhancedAnalysis?.syntaxErrorFindings || [];
            markdown += `### Syntax Errors (${syntaxErrors.length})\n\n`;
            if (syntaxErrors.length === 0) {
                markdown += `âœ“ None found\n\n`;
            } else {
                syntaxErrors.forEach((error, i) => {
                    markdown += `${i + 1}. **${error.errorType}** in ${error.location}\n`;
                    markdown += `   - Description: ${error.description}\n`;
                    markdown += `   - Code: \`${error.codeFragment}\`\n`;
                    markdown += `   - Confidence: ${error.confidence}\n\n`;
                });
            }

            markdown += `## RECOMMENDATIONS\n\n`;
            Object.entries(report.dimensions || {}).forEach(([dimension, result]) => {
                if (result.recommendations.length > 0) {
                    markdown += `### ${dimension.charAt(0).toUpperCase() + dimension.slice(1)}\n\n`;
                    result.recommendations.forEach((rec, i) => {
                        markdown += `${i + 1}. **${rec.priority.toUpperCase()}:** ${rec.action}\n`;
                        markdown += `   Impact: ${rec.impact}\n`;
                        if (rec.evidence) {
                            markdown += `   Evidence: _${rec.evidence}_${rec.location ? ` (${rec.location})` : ''}\n`;
                        }
                        markdown += `\n`;
                    });
                }
            });

            // [NEW] Sitemap Health Status (Domain-level)
            console.log('Exporting report, sitemapHealth:', report.sitemapHealth);
            if (report.sitemapHealth) {
                markdown += `\n## SITEMAP HEALTH (Domain Level)\n\n`;

                if (report.sitemapHealth.error) {
                    markdown += `âš ï¸ **Check Failed:** ${report.sitemapHealth.error}\n\n`;
                } else {
                    markdown += `**Health Score:** ${report.sitemapHealth.healthPercentage}/100\n`;
                    markdown += `**Total URLs:** ${report.sitemapHealth.totalUrls}\n`;
                    markdown += `**Broken URLs:** ${report.sitemapHealth.brokenUrls}\n\n`;
                }

                if (report.sitemapHealth && (report.sitemapHealth.brokenUrls || 0) > 0) {
                    if (report.sitemapHealth.linkIssues) {
                        const broken = report.sitemapHealth.linkIssues.filter(i => i.issueType === '404').slice(0, 10);
                        markdown += `### Top Broken Links\n`;
                        broken.forEach(link => {
                            markdown += `- \`${link.url}\` (404)\n`;
                        });
                        if ((report.sitemapHealth.brokenUrls || 0) > 10) {
                            markdown += `- ...and ${(report.sitemapHealth.brokenUrls || 0) - 10} more\n`;
                        }
                        markdown += `\n`;
                    }
                }
            }
        }

        markdown += `---\n\n`;
        markdown += `*Report generated by Documentation Quality Auditor*\n`;
        markdown += `*Analysis model: ${report.modelUsed}*\n`;
        markdown += `*Analysis time: ${(report.analysisTime / 1000).toFixed(1)}s*\n`;

        // Create and download file
        // [FIX] Use data URL instead of blob URL for better Chrome compatibility
        const isSitemapMode = (manualModeOverride || selectedMode) === 'sitemap';
        const filename = isSitemapMode && report.sitemapHealth
            ? `sitemap-health-report-${new Date().toISOString().split('T')[0]}.md`
            : `documentation-quality-report-${new Date().toISOString().split('T')[0]}.md`;

        // Encode markdown as data URL
        const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown);

        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = dataUrl;
        a.download = filename;

        document.body.appendChild(a);
        a.click();

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(a);
        }, 100);
    };

    /** Quick-start user guide PDF */
    const exportUserGuidePdf = async () => {
        // @ts-ignore
        const jspdfModule = await import('jspdf') as any;
        const jsPDF = jspdfModule.default || jspdfModule.jsPDF;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const fn = 'helvetica';
        doc.setFont(fn, 'normal');

        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();
        const m = 20;
        const cw = pw - m * 2;
        let gy = 0;

        const gColor = {
            dark: [30, 30, 30] as [number, number, number],
            body: [30, 30, 30] as [number, number, number],
            muted: [107, 114, 128] as [number, number, number],
            light: [156, 163, 175] as [number, number, number],
            blue: [59, 130, 246] as [number, number, number],
            border: [229, 231, 235] as [number, number, number],
        };

        // Footer
        const guideFooter = () => {
            doc.setDrawColor(...gColor.border);
            doc.line(m, ph - 12, pw - m, ph - 12);
            doc.setFontSize(7);
            doc.setTextColor(...gColor.light);
            doc.setFont(fn, 'normal');
            doc.text(`(c) ${new Date().getFullYear()} Perseverance AI`, m, ph - 7);
            doc.text('Lensy User Guide', pw - m, ph - 7, { align: 'right' });
        };

        // --- Cover / Title area ---
        doc.setFillColor(...gColor.blue);
        doc.rect(0, 0, pw, 2, 'F');

        // Logo
        gy = 30;
        const gLogoSize = 24;
        doc.addImage(logoImg, 'PNG', pw / 2 - gLogoSize / 2, gy, gLogoSize, gLogoSize);

        gy += gLogoSize + 6;
        doc.setFontSize(9);
        doc.setTextColor(...gColor.muted);
        doc.setFont(fn, 'normal');
        doc.text('Perseverance AI', pw / 2, gy, { align: 'center' });

        gy += 18;
        doc.setFontSize(20);
        doc.setFont(fn, 'bold');
        doc.setTextColor(...gColor.dark);
        doc.text('Lensy Quick Start Guide', pw / 2, gy, { align: 'center' });

        gy += 6;
        doc.setDrawColor(...gColor.border);
        doc.line(m + 30, gy, pw - m - 30, gy);

        gy += 8;
        doc.setFontSize(10);
        doc.setFont(fn, 'normal');
        doc.setTextColor(...gColor.muted);
        doc.text('Documentation Quality Auditor', pw / 2, gy, { align: 'center' });

        gy += 5;
        doc.setFontSize(9);
        doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pw / 2, gy, { align: 'center' });

        guideFooter();

        // --- Steps ---
        gy += 20;

        const stepTitle = (num: number, title: string) => {
            gy += 6;
            doc.setFontSize(11);
            doc.setFont(fn, 'bold');
            doc.setTextColor(...gColor.dark);
            doc.text(`${num}. ${title}`, m, gy);
            gy += 6;
        };

        const stepBody = (text: string) => {
            doc.setFontSize(10);
            doc.setFont(fn, 'normal');
            doc.setTextColor(...gColor.body);
            const lines = doc.splitTextToSize(text, cw);
            lines.forEach((line: string) => {
                doc.text(line, m, gy);
                gy += 5;
            });
        };

        const stepLink = (label: string, url: string) => {
            doc.setFontSize(9);
            doc.setFont(fn, 'normal');
            doc.setTextColor(...gColor.blue);
            doc.textWithLink(label, m + 4, gy, { url });
            gy += 5;
        };

        // Step 1
        stepTitle(1, 'Open the Console');
        stepBody('Navigate to the Perseverance AI Console in your browser. You will be presented with the login screen.');
        stepLink('console.perseveranceai.com', 'https://console.perseveranceai.com');
        gy += 2;

        // Step 2
        stepTitle(2, 'Sign In');
        stepBody('Enter your email address and the access code that was shared with you offline. Check the "I agree to the terms" box, then click "Sign in". Your session remains active for 48 hours.');
        gy += 2;

        // Step 3
        stepTitle(3, 'Enter a URL to Analyze');
        stepBody('Once signed in, you will see the Lensy auditor dashboard. Paste the full URL of the documentation page you want to audit into the input field (e.g. https://docs.example.com/getting-started).');
        gy += 2;

        // Step 4
        stepTitle(4, 'Run the Analysis');
        stepBody('Click "Analyze" to start the audit. Lensy will evaluate the page across multiple quality dimensions including relevance, freshness, clarity, accuracy, and completeness. It also checks sitemap health, link validity, code quality, and AI-readiness. The analysis typically takes 15 to 45 seconds.');
        gy += 2;

        // Step 5
        stepTitle(5, 'Review Your Results');
        stepBody('After the analysis completes, you will see:');
        gy += 1;
        const resultItems = [
            'Overall score (out of 100) with a breakdown by dimension',
            'Executive summary with strengths, weaknesses, and top actions',
            'Critical findings (link issues, deprecated code, syntax errors)',
            'AI-readiness assessment (llms.txt, structured data)',
            'Sitemap health check for the domain',
            'Actionable recommendations sorted by priority',
        ];
        resultItems.forEach((item, i) => {
            doc.setFontSize(10);
            doc.setFont(fn, 'normal');
            doc.setTextColor(...gColor.body);
            const lines = doc.splitTextToSize(`${i + 1}. ${item}`, cw - 4);
            lines.forEach((line: string) => {
                doc.text(line, m + 4, gy);
                gy += 5;
            });
        });
        gy += 2;

        // Step 6
        stepTitle(6, 'Export Your Report');
        stepBody('Click "Export Report (PDF)" at the bottom of the results to download a branded PDF report. This report follows a structured narrative format and can be shared with your team for review or compliance purposes.');
        gy += 4;

        // Helpful links section
        gy += 4;
        doc.setDrawColor(...gColor.border);
        doc.line(m, gy, pw - m, gy);
        gy += 8;
        doc.setFontSize(11);
        doc.setFont(fn, 'bold');
        doc.setTextColor(...gColor.dark);
        doc.text('Helpful Links', m, gy);
        gy += 7;

        const links = [
            { label: 'Perseverance AI Console', url: 'https://console.perseveranceai.com' },
            { label: 'Perseverance AI Website', url: 'https://perseveranceai.com' },
        ];
        links.forEach(link => {
            doc.setFontSize(10);
            doc.setFont(fn, 'normal');
            doc.setTextColor(...gColor.blue);
            doc.textWithLink(link.label, m + 4, gy, { url: link.url });
            gy += 6;
        });

        // Need help note
        gy += 4;
        doc.setFontSize(9);
        doc.setFont(fn, 'normal');
        doc.setTextColor(...gColor.muted);
        const helpLines = doc.splitTextToSize('For questions, support, or to request additional access codes, contact your Perseverance AI representative.', cw);
        helpLines.forEach((line: string) => {
            doc.text(line, m, gy);
            gy += 4.5;
        });

        doc.save(`lensy-quick-start-guide-${new Date().toISOString().split('T')[0]}.pdf`);
    };

    /** Export report as branded Perseverance AI PDF â€” Amazon narrative style */
    const exportPdfReport = async (report: FinalReport) => {
        // @ts-ignore
        const jspdfModule = await import('jspdf') as any;
        const jsPDF = jspdfModule.default || jspdfModule.jsPDF;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        // Use default helvetica font
        const fn = 'helvetica';
        doc.setFont(fn, 'normal');

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        const contentWidth = pageWidth - margin * 2;
        let y = 0;

        // --- Minimal palette: uniform dark text, matching user guide ---
        const c = {
            textDark: [30, 30, 30] as [number, number, number],
            textBody: [30, 30, 30] as [number, number, number],       // same as dark â€” uniform black
            textMuted: [100, 100, 100] as [number, number, number],   // only for footer
            textLight: [156, 163, 175] as [number, number, number],   // only for footer/cover accents
            blue: [59, 130, 246] as [number, number, number],
            borderLight: [229, 231, 235] as [number, number, number],
        };

        // Helper: normalize dimension score to 0-100
        const normScore100 = (raw: number): number => raw <= 10 ? Math.round(raw * 10) : Math.round(raw);
        const sz = 10; // standard body font size
        const lh = 5;  // line height

        const checkPage = (neededHeight: number) => {
            if (y + neededHeight > pageHeight - 18) {
                doc.addPage();
                drawFooter();
                y = 18;
            }
        };

        const drawFooter = () => {
            doc.setDrawColor(...c.borderLight);
            doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
            doc.setFontSize(7);
            doc.setTextColor(...c.textLight);
            doc.setFont(fn, 'normal');
            doc.text(`(c) ${new Date().getFullYear()} Perseverance AI  |  Confidential`, margin, pageHeight - 7);
            doc.text('Generated by Lensy AI. Mistakes can happen, please double-check.', pageWidth - margin, pageHeight - 7, { align: 'right' });
        };

        // Section heading: bold, no underline, just spacing
        const heading = (text: string) => {
            checkPage(12);
            y += 6;
            doc.setFontSize(12);
            doc.setFont(fn, 'bold');
            doc.setTextColor(...c.textDark);
            doc.text(text, margin, y);
            y += 6;
        };

        // Sub-heading: bold, same size as body
        const subheading = (text: string) => {
            checkPage(10);
            y += 3;
            doc.setFontSize(sz);
            doc.setFont(fn, 'bold');
            doc.setTextColor(...c.textDark);
            doc.text(text, margin, y);
            y += lh + 1;
        };

        // Paragraph: normal weight, wraps at content width
        const para = (text: string) => {
            doc.setFontSize(sz);
            doc.setFont(fn, 'normal');
            doc.setTextColor(...c.textBody);
            const lines = doc.splitTextToSize(text, contentWidth);
            for (const line of lines) {
                checkPage(lh);
                doc.text(line, margin, y);
                y += lh;
            }
        };

        // Inline bold label + normal value on same line
        const labelValue = (label: string, value: string) => {
            checkPage(lh + 1);
            doc.setFontSize(sz);
            doc.setFont(fn, 'bold');
            doc.setTextColor(...c.textDark);
            doc.text(label, margin, y);
            doc.setFont(fn, 'normal');
            doc.setTextColor(...c.textBody);
            doc.text(value, margin + doc.getTextWidth(label + '  '), y);
            y += lh + 0.5;
        };

        const isSitemapMode = (manualModeOverride || selectedMode) === 'sitemap';

        // ====== PAGE 1: COVER ======

        // Thin top accent line
        doc.setFillColor(...c.blue);
        doc.rect(0, 0, pageWidth, 2, 'F');

        // Logo
        y = 40;
        const logoSize = 24;
        doc.addImage(logoImg, 'PNG', pageWidth / 2 - logoSize / 2, y, logoSize, logoSize);

        y += logoSize + 6;
        doc.setFontSize(10);
        doc.setTextColor(...c.textMuted);
        doc.setFont(fn, 'normal');
        doc.text('Perseverance AI', pageWidth / 2, y, { align: 'center' });

        y += 22;
        doc.setFontSize(22);
        doc.setFont(fn, 'bold');
        doc.setTextColor(...c.textDark);
        const reportTitle = isSitemapMode && report.sitemapHealth
            ? 'Sitemap Health Report'
            : 'Documentation Quality Report';
        doc.text(reportTitle, pageWidth / 2, y, { align: 'center' });

        y += 8;
        doc.setDrawColor(...c.borderLight);
        doc.line(margin + 40, y, pageWidth - margin - 40, y);

        y += 10;
        doc.setFontSize(10);
        doc.setFont(fn, 'normal');
        doc.setTextColor(...c.blue);
        const displayUrl = url.length > 65 ? url.substring(0, 62) + '...' : url;
        doc.text(displayUrl, pageWidth / 2, y, { align: 'center' });

        y += 8;
        doc.setFontSize(9);
        doc.setTextColor(...c.textMuted);
        doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pageWidth / 2, y, { align: 'center' });

        // Score box
        y += 18;
        const boxW = 56;
        const boxH = 28;
        const boxX = pageWidth / 2 - boxW / 2;
        if (isSitemapMode && report.sitemapHealth) {
            const pct = report.sitemapHealth.healthPercentage || 0;
            doc.setDrawColor(...c.textDark);
            doc.setLineWidth(1);
            doc.roundedRect(boxX, y, boxW, boxH, 4, 4, 'S');
            doc.setLineWidth(0.2);
            doc.setFontSize(22);
            doc.setFont(fn, 'bold');
            doc.setTextColor(...c.textDark);
            doc.text(`${pct}/100`, pageWidth / 2, y + 16, { align: 'center' });
            doc.setFontSize(7);
            doc.setTextColor(...c.textMuted);
            doc.setFont(fn, 'normal');
            doc.text('HEALTH SCORE', pageWidth / 2, y + 23, { align: 'center' });
        } else {
            const score = report.overallScore || 0;
            doc.setDrawColor(...c.textDark);
            doc.setLineWidth(1);
            doc.roundedRect(boxX, y, boxW, boxH, 4, 4, 'S');
            doc.setLineWidth(0.2);
            doc.setFontSize(22);
            doc.setFont(fn, 'bold');
            doc.setTextColor(...c.textDark);
            doc.text(`${score}/100`, pageWidth / 2, y + 16, { align: 'center' });
            doc.setFontSize(7);
            doc.setTextColor(...c.textMuted);
            doc.setFont(fn, 'normal');
            doc.text('OVERALL SCORE', pageWidth / 2, y + 23, { align: 'center' });
        }

        y += 38;
        doc.setFontSize(8);
        doc.setTextColor(...c.textLight);
        doc.text(`Analysis time: ${(report.analysisTime / 1000).toFixed(1)}s`, pageWidth / 2, y, { align: 'center' });

        drawFooter();

        // ====== PAGE 2+: NARRATIVE BODY ======
        doc.addPage();
        drawFooter();
        y = 18;

        if (isSitemapMode && report.sitemapHealth) {
            // --- SITEMAP MODE (narrative) ---
            heading('Sitemap Health Summary');
            const sh = report.sitemapHealth;
            const shPct = sh.healthPercentage ?? ((sh.totalUrls || 0) > 0 ? Math.round(((sh.healthyUrls || 0) / (sh.totalUrls || 1)) * 100) : 0);
            para(
                `The sitemap contains ${sh.totalUrls} URLs in total, of which ${sh.healthyUrls} are healthy (${shPct}%). ` +
                `Broken links (404): ${sh.brokenUrls || 0}. Access-denied responses (403): ${sh.accessDeniedUrls || 0}. ` +
                `Timeouts: ${sh.timeoutUrls || 0}. Other errors: ${sh.otherErrorUrls || 0}.`
            );

            if (sh.linkIssues && sh.linkIssues.length > 0) {
                heading('Link Issue Details');
                const broken404 = sh.linkIssues.filter(i => i.issueType === '404');
                if (broken404.length > 0) {
                    subheading(`Broken Links (404) - ${broken404.length}`);
                    broken404.forEach((issue, i) => {
                        checkPage(lh);
                        doc.setFontSize(sz);
                        doc.setFont(fn, 'normal');
                        doc.setTextColor(...c.textBody);
                        const line = `${i + 1}. ${issue.url}`;
                        doc.text(line.length > 100 ? line.substring(0, 97) + '...' : line, margin, y);
                        y += lh;
                    });
                    y += 2;
                }
            }
        } else {
            // --- DOC MODE (Amazon narrative style) ---

            // Build dimension data
            const dimEntries = Object.entries(report.dimensions || {});
            const strengths: string[] = [];
            const weaknesses: string[] = [];
            const improvements: { action: string; impact: string }[] = [];

            dimEntries.forEach(([dim, result]) => {
                const raw = result.score || 0;
                const s100 = normScore100(raw);
                const dimName = dim.charAt(0).toUpperCase() + dim.slice(1);
                if (s100 >= 85) {
                    const reason = (result.findings || []).find(f => !f.toLowerCase().startsWith('content type'));
                    strengths.push(reason ? `${dimName} scored ${s100}/100. ${reason}` : `${dimName} scored ${s100}/100`);
                } else if (s100 < 70) {
                    const reason = (result.findings || []).find(f => !f.toLowerCase().startsWith('content type'));
                    weaknesses.push(reason ? `${dimName} scored ${s100}/100. ${reason}` : `${dimName} scored ${s100}/100`);
                }
            });

            // Build Top Actions from across ALL sections
            // Clean up text: remove em dashes, en dashes, ellipsis, and other AI-looking symbols
            const cleanText = (text: string): string => {
                return text
                    .replace(/\s*[â€”â€“]\s*/g, '. ')     // em dash, en dash to period+space
                    .replace(/\.{2,}/g, '.')            // collapse multiple dots
                    .replace(/\.\s*\./g, '.')           // collapse ". ." to "."
                    .replace(/\s{2,}/g, ' ')            // collapse double spaces
                    .trim();
            };

            // Top Actions are structured: { action, impact }
            // 1. AI-Readiness
            if (report.aiReadiness) {
                const aiScore = Number(report.aiReadiness.overallScore) || 0;
                const missingAI: string[] = [];
                if (!report.aiReadiness.llmsTxt.found) missingAI.push('llms.txt');
                if (!report.aiReadiness.llmsFullTxt.found) missingAI.push('llms-full.txt');
                if (!report.aiReadiness.structuredData.hasJsonLd) missingAI.push('structured data (JSON-LD)');
                if (missingAI.length > 0) {
                    improvements.push({
                        action: `AI-readiness scored ${aiScore}/100. Add ${missingAI.join(', ')}`,
                        impact: 'Without these files, AI assistants cannot discover or accurately reference your documentation, making your content invisible to the fastest-growing discovery channel.'
                    });
                }
            }

            // 2. Sitemap health issues
            if (report.sitemapHealth) {
                if (report.sitemapHealth.error) {
                    const cleanedError = cleanText(report.sitemapHealth.error);
                    improvements.push({
                        action: `Sitemap check failed. ${cleanedError}`,
                        impact: 'A broken sitemap prevents search engines from efficiently crawling and indexing your pages, directly reducing organic search visibility.'
                    });
                } else if ((report.sitemapHealth.brokenUrls || 0) > 0) {
                    improvements.push({
                        action: `${report.sitemapHealth.brokenUrls} broken URLs found in sitemap need to be fixed`,
                        impact: 'Broken URLs in the sitemap waste crawl budget and erode search engine trust in your site over time.'
                    });
                }
            }

            // 3. Critical findings
            const linkIssueCountSummary = (report.linkAnalysis.linkIssueFindings || report.linkAnalysis.linkValidation?.linkIssueFindings)?.length || 0;
            const deprecatedCountSummary = report.codeAnalysis.enhancedAnalysis?.deprecatedFindings?.length || 0;
            const spellingCountSummary = (report.dimensions?.clarity?.spellingIssues || []).length;
            if (linkIssueCountSummary > 0) {
                improvements.push({
                    action: `${linkIssueCountSummary} broken or problematic link${linkIssueCountSummary !== 1 ? 's' : ''} need attention`,
                    impact: 'Broken links frustrate users and signal poor maintenance to search engines, hurting rankings.'
                });
            }
            if (deprecatedCountSummary > 0) {
                improvements.push({
                    action: `${deprecatedCountSummary} deprecated code reference${deprecatedCountSummary !== 1 ? 's' : ''} should be updated`,
                    impact: 'Developers following deprecated examples will hit errors, generating support tickets and eroding trust in your docs.'
                });
            }
            if (spellingCountSummary > 3) {
                improvements.push({
                    action: `${spellingCountSummary} spelling errors should be corrected`,
                    impact: 'Spelling errors reduce credibility and can confuse developers trying to match exact API names or parameters.'
                });
            }

            // 4. High-priority dimension recommendations (cleaned, deduplicated)
            const seenActions: string[] = [];
            improvements.forEach(imp => seenActions.push(imp.action.toLowerCase().substring(0, 40)));

            const isDuplicate = (action: string): boolean => {
                const lower = action.toLowerCase();
                return seenActions.some(seen =>
                    lower.includes(seen.substring(0, 25)) || seen.includes(lower.substring(0, 25))
                );
            };

            dimEntries.forEach(([, result]) => {
                if (result.recommendations && result.recommendations.length > 0) {
                    const topRec = result.recommendations[0];
                    if (topRec.priority === 'high' || (topRec.priority as string) === 'HIGH') {
                        const cleaned = cleanText(topRec.action);
                        if (!isDuplicate(cleaned)) {
                            seenActions.push(cleaned.toLowerCase().substring(0, 40));
                            improvements.push({ action: cleaned, impact: topRec.impact || '' });
                        }
                    }
                }
            });

            // 5. Fill from any dimension recommendations if under 3
            if (improvements.length < 3) {
                dimEntries.forEach(([, result]) => {
                    if (result.recommendations && result.recommendations.length > 0 && improvements.length < 5) {
                        const action = cleanText(result.recommendations[0].action);
                        if (!isDuplicate(action)) {
                            seenActions.push(action.toLowerCase().substring(0, 40));
                            improvements.push({ action, impact: result.recommendations[0].impact || '' });
                        }
                    }
                });
            }

            // ================================================================
            // PAGE 2: THE ONE-PAGER (CTO scans this in 2 minutes)
            // ================================================================

            // --- Executive Summary (2-3 lines) ---
            heading('Executive Summary');
            const overallScore = report.overallScore || 0;
            const scoreVerdict = overallScore >= 80
                ? 'The page demonstrates strong documentation quality across most dimensions.'
                : overallScore >= 60
                    ? 'The page meets baseline quality standards but has room for improvement in several areas.'
                    : 'The page has significant quality gaps that should be addressed.';
            para(`This documentation scored ${overallScore}/100 overall. ${scoreVerdict}`);
            y += 1;

            // --- Dimension Scores (score + one-line definition) ---
            const dimDefs: Record<string, string> = {
                relevance: 'Does the content match what the target audience needs?',
                freshness: 'Is the content up to date with current versions and practices?',
                clarity: 'Is the content well-structured, readable, and free of errors?',
                accuracy: 'Are code samples, configurations, and instructions correct?',
                completeness: 'Does the page cover the full workflow, edge cases, and next steps?',
            };
            subheading('Dimension Scores');
            dimEntries.forEach(([dimension, result]) => {
                const s100 = normScore100(result.score || 0);
                checkPage(lh * 2);
                doc.setFontSize(sz);
                const dimLabel = dimension.charAt(0).toUpperCase() + dimension.slice(1);
                // Dimension name + score on same line
                doc.setFont(fn, 'bold');
                doc.setTextColor(...c.textDark);
                doc.text(dimLabel, margin + 4, y);
                doc.text(`${s100}/100`, margin + 50, y);
                // Definition on same line after score
                const def = dimDefs[dimension.toLowerCase()] || '';
                if (def) {
                    doc.setFont(fn, 'normal');
                    doc.text(def, margin + 68, y);
                }
                y += lh + 1;
            });
            if (report.aiReadiness) {
                const aiS = Number(report.aiReadiness.overallScore) || 0;
                checkPage(lh * 2);
                doc.setFontSize(sz);
                doc.setFont(fn, 'bold');
                doc.setTextColor(...c.textDark);
                doc.text('AI-Readiness', margin + 4, y);
                doc.text(`${aiS}/100`, margin + 50, y);
                doc.setFont(fn, 'normal');
                doc.text('Can AI assistants discover and use your documentation?', margin + 68, y);
                y += lh + 1;
            }
            y += 2;

            // --- Top 5 Issues: What, Why, Action ---
            heading('Top 5 Issues');
            para('The highest-impact findings across all dimensions. Each issue includes what was found, why it matters, and the recommended action.');
            y += 1;

            improvements.slice(0, 5).forEach((imp, i) => {
                checkPage(lh * 6);
                // Issue number + action (bold)
                doc.setFontSize(sz);
                doc.setFont(fn, 'bold');
                doc.setTextColor(...c.textDark);
                const numPrefix = `${i + 1}. `;
                const actionX = margin + doc.getTextWidth(numPrefix);
                doc.text(numPrefix, margin, y);
                doc.setFont(fn, 'normal');
                doc.setTextColor(...c.textBody);
                const actionLines = doc.splitTextToSize(imp.action, contentWidth - doc.getTextWidth(numPrefix));
                actionLines.forEach((line: string, li: number) => {
                    checkPage(lh);
                    doc.text(line, li === 0 ? actionX : actionX, y);
                    y += lh;
                });
                // Why it matters (same dark color, slightly smaller, indented)
                if (imp.impact) {
                    doc.setFontSize(sz - 1);
                    doc.setTextColor(...c.textDark);
                    const impactLines = doc.splitTextToSize(`Why it matters: ${imp.impact}`, contentWidth - 8);
                    impactLines.forEach((line: string) => { checkPage(lh); doc.text(line, margin + 8, y); y += lh; });
                }
                y += 2;
            });

            // ================================================================
            // APPENDIX: EVERYTHING BELOW THE LINE
            // ================================================================
            doc.addPage();
            drawFooter();
            y = 18;

            // Appendix title
            y += 4;
            doc.setFontSize(14);
            doc.setFont(fn, 'bold');
            doc.setTextColor(...c.textDark);
            doc.text('Appendix', margin, y);
            y += 3;
            doc.setDrawColor(...c.borderLight);
            doc.line(margin, y, pageWidth - margin, y);
            y += 6;

            // --- A1: Sitemap Health ---
            if (report.sitemapHealth) {
                heading('Sitemap Health');
                if (report.sitemapHealth.error) {
                    para(`The sitemap check was unable to complete. ${cleanText(report.sitemapHealth.error)}`);
                } else {
                    const sh = report.sitemapHealth;
                    const pctHealthy = sh.healthPercentage ?? ((sh.totalUrls || 0) > 0 ? Math.round(((sh.healthyUrls || 0) / (sh.totalUrls || 1)) * 100) : 0);
                    para(
                        `The domain-level sitemap contains ${sh.totalUrls} URLs. Of these, ${sh.healthyUrls} (${pctHealthy}%) are healthy. ` +
                        `Broken links (404): ${sh.brokenUrls || 0}. Access-denied (403): ${sh.accessDeniedUrls || 0}. Timeouts: ${sh.timeoutUrls || 0}.`
                    );
                    if (sh.linkIssues && sh.linkIssues.length > 0) {
                        subheading(`Link Issues (${sh.linkIssues.length})`);
                        sh.linkIssues.forEach((issue, i) => {
                            checkPage(lh);
                            doc.setFontSize(sz);
                            doc.setFont(fn, 'normal');
                            doc.setTextColor(...c.textBody);
                            const txt = `${i + 1}. [${issue.issueType}] ${issue.url}`;
                            doc.text(txt.length > 100 ? txt.substring(0, 97) + '...' : txt, margin, y);
                            y += lh;
                        });
                        y += 2;
                    }
                }
            }

            // --- A2: Critical Findings ---
            heading('Critical Findings');
            const linkIssueCount = (report.linkAnalysis.linkIssueFindings || report.linkAnalysis.linkValidation?.linkIssueFindings)?.length || 0;
            const deprecatedCount = report.codeAnalysis.enhancedAnalysis?.deprecatedFindings?.length || 0;
            const syntaxErrorCount = report.codeAnalysis.enhancedAnalysis?.syntaxErrorFindings?.length || 0;
            const urlSlugIssues = (report as any).urlSlugAnalysis?.issues || [];

            const criticalItems = [
                { label: 'Link Issues', count: linkIssueCount },
                { label: 'Deprecated Code', count: deprecatedCount },
                { label: 'Syntax Errors', count: syntaxErrorCount },
                { label: 'URL Slug Issues', count: urlSlugIssues.length },
            ];
            criticalItems.forEach((item, idx) => {
                checkPage(lh);
                doc.setFontSize(sz);
                doc.setFont(fn, 'normal');
                doc.setTextColor(...c.textBody);
                const status = item.count > 0 ? `${item.count} found` : 'None found';
                doc.text(`${idx + 1}. ${item.label}: ${status}`, margin, y);
                y += lh + 0.5;
            });

            if (urlSlugIssues.length > 0) {
                subheading('URL Slug Issues');
                urlSlugIssues.forEach((issue: any, i: number) => {
                    checkPage(lh);
                    doc.setFontSize(sz);
                    doc.setFont(fn, 'normal');
                    doc.setTextColor(...c.textBody);
                    doc.text(`${i + 1}. "${issue.segment}" should be "${issue.suggestion}" (${issue.confidence})`, margin, y);
                    y += lh;
                });
                y += 2;
            }

            // --- A3: Spelling & Typos ---
            const spellingIssues = report.dimensions?.clarity?.spellingIssues || [];
            if (spellingIssues.length > 0) {
                heading('Spelling and Typos');
                para(`${spellingIssues.length} spelling issue${spellingIssues.length !== 1 ? 's were' : ' was'} detected in the documentation.`);
                spellingIssues.forEach((m, idx) => {
                    checkPage(lh);
                    doc.setFontSize(sz);
                    doc.setFont(fn, 'normal');
                    doc.setTextColor(...c.textBody);
                    doc.text(`${idx + 1}. "${m.incorrect}" should be "${m.correct}"`, margin, y);
                    y += lh;
                });
                y += 2;
            }

            // --- A4: Configuration & Code Issues ---
            const configIssues = report.dimensions?.accuracy?.codeIssues || [];
            if (configIssues.length > 0) {
                heading('Configuration and Code Issues');
                para(`${configIssues.length} code or configuration issue${configIssues.length !== 1 ? 's were' : ' was'} identified.`);
                configIssues.forEach((issue, i) => {
                    subheading(`${i + 1}. ${issue.type.toUpperCase()}`);
                    para(issue.description);
                    labelValue('Location:', issue.location);
                });
            }

            // --- A5: Link Issues (grouped by type) ---
            const linkIssues = (report.linkAnalysis.linkIssueFindings || report.linkAnalysis.linkValidation?.linkIssueFindings) || [];
            if (linkIssues.length > 0) {
                const brokenLinks = linkIssues.filter((l: any) => l.issueType === '404');
                const authLinks = linkIssues.filter((l: any) => l.issueType === 'access-denied');
                const timeoutLinks = linkIssues.filter((l: any) => l.issueType === 'timeout');
                const otherLinks = linkIssues.filter((l: any) => l.issueType === 'error');

                heading('Link Issues');
                para(`${linkIssues.length} link issue${linkIssues.length !== 1 ? 's were' : ' was'} found during validation.`);

                const renderLinkGroup = (title: string, items: any[], muted: boolean, note?: string) => {
                    if (items.length === 0) return;
                    subheading(`${title} (${items.length})`);
                    if (note) {
                        checkPage(lh);
                        doc.setFontSize(sz - 1);
                        doc.setFont(fn, 'italic');
                        doc.setTextColor(...(muted ? c.textLight : c.textBody));
                        doc.text(note, margin, y);
                        y += lh;
                    }
                    items.forEach((link: any, i: number) => {
                        checkPage(lh);
                        doc.setFontSize(sz);
                        doc.setFont(fn, 'normal');
                        doc.setTextColor(...(muted ? c.textLight : c.textBody));
                        const linkLine = `${i + 1}. "${link.anchorText || 'Link'}" \u2192 ${link.url}`;
                        doc.text(linkLine.length > 100 ? linkLine.substring(0, 97) + '...' : linkLine, margin, y);
                        y += lh;
                    });
                    y += 1;
                };

                renderLinkGroup('Broken Links (404)', brokenLinks, false);
                renderLinkGroup('Auth-Protected (401/403)', authLinks, true, 'These endpoints may require authentication and are likely not broken.');
                renderLinkGroup('Timeouts', timeoutLinks, true);
                renderLinkGroup('Other Errors', otherLinks, true);
                y += 2;
            }

            // --- A6: Deprecated Code ---
            const deprecatedCode = report.codeAnalysis.enhancedAnalysis?.deprecatedFindings || [];
            if (deprecatedCode.length > 0) {
                heading('Deprecated Code');
                para(`${deprecatedCode.length} deprecated API${deprecatedCode.length !== 1 ? 's were' : ' was'} found.`);
                deprecatedCode.forEach((finding, i) => {
                    subheading(`${i + 1}. ${finding.method}`);
                    labelValue('Location:', finding.location);
                    labelValue('Deprecated in:', finding.deprecatedIn);
                    labelValue('Replacement:', finding.replacement);
                });
            }

            // --- A7: AI-Readiness (detailed) ---
            if (report.aiReadiness) {
                heading('AI-Readiness Assessment');
                const ai = report.aiReadiness;
                labelValue('Overall AI Score:', `${ai.overallScore}/100`);
                y += 1;
                const aiItems = [
                    { label: 'llms.txt', found: ai.llmsTxt.found, impact: 'AI assistants (ChatGPT, Copilot, Perplexity) cannot discover or reference your documentation. This is the fastest-growing traffic channel and your content is invisible to it.' },
                    { label: 'llms-full.txt', found: ai.llmsFullTxt.found, impact: 'AI tools that do find your site can only work with partial content, leading to incomplete or inaccurate answers about your product.' },
                    { label: 'Structured Data (JSON-LD)', found: ai.structuredData.hasJsonLd, impact: 'Search engines cannot build rich results (FAQs, how-tos, breadcrumbs) for your pages, reducing click-through rates from search.' },
                ];
                aiItems.forEach((item, idx) => {
                    checkPage(lh * 3);
                    doc.setFontSize(sz);
                    doc.setFont(fn, 'normal');
                    doc.setTextColor(...c.textBody);
                    const status = item.found ? 'Found' : 'Missing';
                    doc.text(`${idx + 1}. ${item.label}: ${status}`, margin, y);
                    y += lh + 0.5;
                    if (!item.found) {
                        doc.setFontSize(sz - 1);
                        doc.setTextColor(...c.textDark);
                        const impactLines = doc.splitTextToSize(`Impact: ${item.impact}`, contentWidth - 6);
                        impactLines.forEach((line: string) => { checkPage(lh); doc.text(line, margin + 6, y); y += lh; });
                    }
                });
                y += 2;
            }

            // --- A8: All Recommendations (sorted, deduplicated) ---
            const priorityOrder: Record<string, number> = { high: 0, HIGH: 0, medium: 1, MEDIUM: 1, low: 2, LOW: 2 };
            const allRecsRaw = Object.entries(report.dimensions || {})
                .flatMap(([dim, result]) => (result.recommendations || []).map(rec => ({ ...rec, dimension: dim })))
                .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

            const allRecs: typeof allRecsRaw = [];
            const recFingerprints: string[] = [];
            allRecsRaw.forEach(rec => {
                const fp = rec.action.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
                const isSimilar = recFingerprints.some(existing => {
                    const shorter = Math.min(fp.length, existing.length, 30);
                    let matches = 0;
                    for (let ci = 0; ci < shorter; ci++) { if (fp[ci] === existing[ci]) matches++; }
                    return matches / shorter > 0.6;
                });
                if (!isSimilar) {
                    allRecs.push(rec);
                    recFingerprints.push(fp);
                }
            });

            if (allRecs.length > 0) {
                heading('All Recommendations');
                allRecs.forEach((rec: any, i: number) => {
                    checkPage(lh * 3);
                    doc.setFontSize(sz);
                    doc.setFont(fn, 'bold');
                    doc.setTextColor(...c.textDark);
                    const numPrefix = `${i + 1}. `;
                    doc.text(numPrefix, margin, y);
                    const actionX = margin + doc.getTextWidth(numPrefix);
                    doc.setFont(fn, 'normal');
                    doc.setTextColor(...c.textBody);
                    const actionLines = doc.splitTextToSize(rec.action, contentWidth - doc.getTextWidth(numPrefix));
                    actionLines.forEach((line: string, li: number) => {
                        checkPage(lh);
                        doc.text(line, li === 0 ? actionX : margin + doc.getTextWidth(numPrefix), y);
                        y += lh;
                    });
                    doc.setFontSize(sz);
                    doc.setFont(fn, 'normal');
                    doc.setTextColor(...c.textMuted);
                    checkPage(lh);
                    doc.text(`${rec.priority?.toUpperCase()} priority, ${rec.impact} impact, ${rec.dimension}`, margin + doc.getTextWidth(numPrefix), y);
                    y += lh;
                    if (rec.evidence) {
                        checkPage(lh);
                        const evidenceText = `Evidence: ${rec.evidence}${rec.location ? ` (${rec.location})` : ''}`;
                        const evidenceLines = doc.splitTextToSize(evidenceText, contentWidth - doc.getTextWidth(numPrefix));
                        evidenceLines.forEach((line: string) => {
                            checkPage(lh);
                            doc.text(line, margin + doc.getTextWidth(numPrefix), y);
                            y += lh;
                        });
                    }
                    y += 1;
                });
            }

            // --- A9: Dimension Analysis (detailed findings) ---
            heading('Dimension Analysis');
            para('Detailed findings for each quality dimension are listed below.');

            dimEntries.forEach(([dimension, result]) => {
                const s100 = normScore100(result.score || 0);
                subheading(`${dimension.charAt(0).toUpperCase() + dimension.slice(1)} - ${s100}/100`);

                const findings = (result.findings || []).filter(
                    (f: string) => !f.toLowerCase().startsWith('content type')
                );
                if (findings.length > 0) {
                    findings.forEach((finding: string, idx: number) => {
                        checkPage(lh);
                        doc.setFontSize(sz);
                        doc.setFont(fn, 'normal');
                        doc.setTextColor(...c.textBody);
                        const lines = doc.splitTextToSize(`${idx + 1}. ${finding}`, contentWidth);
                        lines.forEach((line: string) => {
                            checkPage(lh);
                            doc.text(line, margin, y);
                            y += lh;
                        });
                    });
                } else {
                    para('No major findings.');
                }
                y += 2;
            });
        }

        // Save
        const pdfFilename = isSitemapMode && report.sitemapHealth
            ? `sitemap-health-report-${new Date().toISOString().split('T')[0]}.pdf`
            : `documentation-quality-report-${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(pdfFilename);
    };

    const isGithubWideMode = selectedMode === 'github-issues' && (analysisState.status === 'analyzing' || !!githubAnalysisResults);
    // Pre-submit input validation (empty/invalid URL, missing domain/issues) should NOT
    // collapse the centered landing view or reveal the How It Works section - even when a
    // leftover session/re-scan state exists. Only a real report keeps activity on.
    const isPreSubmitInputError =
        analysisState.status === 'error' &&
        !analysisState.report &&
        (
            (analysisState.error || '').startsWith('Please enter') ||
            (analysisState.error || '').startsWith('Please select') ||
            (analysisState.error || '') === 'Please enter a valid URL'
        );
    const hasDocActivity = isPreSubmitInputError
        ? false
        : (
            analysisState.status !== 'idle' ||
            !!analysisState.report ||
            Object.keys(asyncCards).length > 0 ||
            !!currentSessionId ||
            !!fixSuccessMessage ||
            !!validationResults
        );
    const isLandingView =
        selectedMode !== 'github-issues' &&
        selectedMode !== 'issue-discovery' &&
        !hasDocActivity &&
        usageRemaining !== 0;

    const location = useLocation();

    if (location.pathname === '/results' || location.pathname === '/scan') {
        return (
            <ScanReport
                url={url}
                analysisState={analysisState}
                citationData={asyncCards.aiDiscoverability}
                overallScoreData={asyncCards.overallScore}
                citationsLoading={citationsLoading}
                onRunCitations={handleRunCitations}
                onScan={handleAnalyze}
            />
        );
    }

    return <Home onScan={handleAnalyze} analysisState={analysisState} />;
}

export default LensyApp;
