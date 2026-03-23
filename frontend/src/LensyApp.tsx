import React, { useState, useEffect, useRef, useMemo } from 'react';
import { trackEvent } from './analytics';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
    Container,
    Paper,
    TextField,
    Button,
    Typography,
    Box,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert,
    CircularProgress,
    Card,
    CardContent,
    Grid,
    Chip,
    AppBar,
    Toolbar,
    Switch,
    FormControlLabel,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Collapse,
    IconButton,
    Checkbox,
    Divider,
    Skeleton,
    Tooltip
} from '@mui/material';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import CachedIcon from '@mui/icons-material/Cached';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import FixReviewPanel, { Fix } from './components/FixReviewPanel';
import jsPDF from 'jspdf';
import { JAKARTA_REGULAR, JAKARTA_BOLD } from './jakartaFonts';
const logoImg = `${process.env.PUBLIC_URL}/logo.png`;

// [NEW] Collapsible Component Helper
const CollapsibleCard = ({ title, subtitle, children, defaultExpanded = true, count = 0, color = "default" }: any) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    // Status-based color mapping
    const colorMap: Record<string, { border: string, bg: string, text: string }> = {
        error: { border: '#ef4444', bg: 'rgba(239,68,68,0.08)', text: '#ef4444' },
        warning: { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)', text: '#f59e0b' },
        success: { border: '#22c55e', bg: 'rgba(34,197,94,0.08)', text: '#22c55e' },
        info: { border: '#3b82f6', bg: 'rgba(59,130,246,0.08)', text: '#3b82f6' },
        default: { border: 'var(--border-default)', bg: 'transparent', text: 'var(--text-primary)' }
    };

    const statusColor = colorMap[color] || colorMap.default;

    return (
        <Card sx={{
            mb: 4,
            borderTop: color !== 'default' ? `4px solid ${statusColor.border}` : 'none',
            borderLeft: color !== 'default' ? `3px solid ${statusColor.border}` : 'none',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
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

// ── NEW: AI Readiness Category Interfaces ────────────────────────────────

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

interface ConsumabilityData {
    markdownAvailable: { found: boolean; urls: string[]; discoverable: boolean; discoveryMethod?: string };
    textToHtmlRatio: { ratio: number; textBytes: number; htmlBytes: number; status: 'good' | 'low' | 'very-low' };
    jsRendered: boolean;
    headingHierarchy: { h1Count: number; h2Count: number; h3Count: number; hasProperNesting: boolean; headings: string[] };
    codeBlocks: { count: number; withLanguageHints: number; hasCode: boolean };
    internalLinkDensity: { count: number; perKWords: number; status: 'good' | 'sparse' | 'excessive' };
    wordCount?: number;
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
    botAccess: number;
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

// Feature flags
const FEATURE_FLAG_AUTO_FIXES = false;

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
    const [docsContextReady, setDocsContextReady] = useState(false); // gates issue selection — true only when a valid docs source is confirmed
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

    // ── Async Card State (populated via WebSocket category-result messages) ──
    const [asyncCards, setAsyncCards] = useState<{
        botAccess?: BotAccessData;
        discoverability?: DiscoverabilityData;
        consumability?: ConsumabilityData;
        structuredData?: StructuredDataData;
        aiDiscoverability?: AIDiscoverabilityData;
        overallScore?: { overallScore: number; scoreBreakdown: ScoreBreakdown; recommendationCount: number; contextualSuggestionCount: number; docConfidence?: { score: number; signals: string[] } };
    }>({});
    const [activeDetailCard, setActiveDetailCard] = useState<'score' | 'bots' | 'content' | 'queries' | null>(null);
    const [showAllRecs, setShowAllRecs] = useState(false);
    const [showFullContentBreakdown, setShowFullContentBreakdown] = useState(false);
    const [heroTab, setHeroTab] = useState<'readiness' | 'citations' | 'recommendations'>('readiness');
    const [rejectedUrl, setRejectedUrl] = useState<string | null>(null);

    // ── Persist audit state across route changes only (not page refresh) ──
    // On full page refresh, JS globals reset → sessionAlive is false → clear storage
    // On route change (SPA navigation), globals persist → sessionAlive stays true → restore state
    useEffect(() => {
        if (!(window as any).__lensy_session_alive) {
            // Full page refresh — clear stale state and mark session alive
            sessionStorage.removeItem('lensy-audit-state');
            (window as any).__lensy_session_alive = true;
            return;
        }
        // Route change — restore from sessionStorage
        try {
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

    // Auto-scroll disabled — let user control their own scroll position
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
            setProgressExpanded(true);
        }
    }, [analysisState.status]);

    // Cleanup WebSocket on unmount
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
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
                            // Refresh usage counter — rejected scans get refunded
                            window.dispatchEvent(new Event('lensy:usage-changed'));
                            return;
                        }
                    }

                    // Handle category-result messages for async card loading
                    if (message.type === 'category-result' && message.metadata?.category && message.metadata?.data) {
                        const { category, data } = message.metadata;
                        console.log(`Async card update: ${category}`, data);
                        setAsyncCards(prev => ({ ...prev, [category]: data }));
                        // Auto-expand bots card when it's the first to render
                        if (category === 'botAccess' && !activeDetailCard) {
                            setActiveDetailCard('bots');
                        }
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
                        const errorMsg = statusData.error || statusData.reason || 'Analysis failed. Check the progress messages for details.';
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
                console.error('Polling error:', error);
            }
        };

        setTimeout(poll, 5000);
    };

    // ─── GitHub Issues Mode: Fetch and Analyze ───────────────────────────
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
                    // At least one repo has real docs — auto-select the first one with docs
                    setGithubDocsUrl(reposWithDocs[0].fullName);
                    setDocsAsCodeConfirmation(null);
                    setDocsContextReady(true); // docs source confirmed automatically
                } else if (reposWithoutDocs.length > 0) {
                    // Found repos matching docs patterns but NO actual docs content
                    // → trigger human-in-the-loop: "Do you store docs as code?"
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

            // Default to none selected — user picks which to analyze
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

            // Handle async response (202 Accepted) — poll for results
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
                        error: 'Analysis timed out after 5 minutes. The results may still be processing — try refreshing.',
                        progressMessages: prev.progressMessages
                    }));
                };

                pollForResults();
                return; // Don't block — polling runs in background
            }

            // Synchronous response — handle directly
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

    // ─── Preview Docs: lightweight check before crawling ──────────────────────
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
                    // KB already exists in S3 cache — skip "Build Knowledge Base" button entirely
                    setKbBuildState('ready');
                    setKbInfo({ domain, pageCount: data.cachedPageCount });
                    setDocsContextReady(true);
                } else {
                    // No cache — show "Build Knowledge Base" button
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

    // Build Knowledge Base — crawl + summarize + S3 cache (separate from issue analysis)
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

            // 202 means async — poll for results
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

    // ── Run AI Citations check on-demand ──
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
            console.log('[Citations] API response:', resp.status);

            // Timeout fallback — WebSocket should deliver results, but stop loading after 90s
            setTimeout(() => setCitationsLoading(false), 90000);
        } catch (e) {
            console.error('[Citations] Citation check failed:', e);
            setCitationsLoading(false);
        }
    };

    const handleAnalyze = async () => {
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
            if (!url.trim()) {
                setAnalysisState({ status: 'error', error: 'Please enter a URL', progressMessages: [] });
                return;
            }

            // Auto-prepend https:// if no protocol
            let normalizedUrl = url.trim();
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

        trackEvent('generate_report_started', { url: urlRef.current || url, mode: currentMode });

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
                    url: urlRef.current || url,
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
        markdown += `- **✅ Resolved Issues:** ${validationResults.summary.resolved} (${((validationResults.summary.resolved / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
        markdown += `- **🔍 Confirmed Gaps:** ${validationResults.summary.confirmed || 0} (${((validationResults.summary.confirmed / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
        markdown += `- **⚠️ Potential Gaps:** ${validationResults.summary.potentialGaps} (${((validationResults.summary.potentialGaps / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
        markdown += `- **❌ Critical Gaps:** ${validationResults.summary.criticalGaps} (${((validationResults.summary.criticalGaps / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n\n`;

        // Key Insights
        markdown += `### Key Insights\n\n`;
        if (validationResults.summary.criticalGaps > 0) {
            markdown += `🚨 **${validationResults.summary.criticalGaps} critical documentation gaps** require immediate attention - these are issues developers are actively struggling with but have no documentation coverage.\n\n`;
        }
        if (validationResults.summary.potentialGaps > 0) {
            markdown += `⚠️ **${validationResults.summary.potentialGaps} potential gaps** exist where documentation pages exist but may not fully address developer needs.\n\n`;
        }
        if (validationResults.summary.resolved > 0) {
            markdown += `✅ **${validationResults.summary.resolved} issues appear well-documented** with comprehensive coverage.\n\n`;
        }

        // Sitemap Health Analysis (if available)
        if (validationResults.sitemapHealth) {
            const sitemap = validationResults.sitemapHealth;
            markdown += `## SITEMAP HEALTH ANALYSIS\n\n`;
            markdown += `This analysis checked all ${sitemap.totalUrls} URLs from the documentation sitemap for accessibility and health.\n\n`;

            markdown += `### Health Summary\n\n`;
            markdown += `- **✅ Healthy URLs:** ${sitemap.healthyUrls} (${sitemap.healthPercentage}%)\n`;
            markdown += `- **🔴 Broken URLs (404):** ${sitemap.brokenUrls || 0}\n`;
            markdown += `- **🟡 Access Denied (403):** ${sitemap.accessDeniedUrls || 0}\n`;
            markdown += `- **🟠 Timeout Issues:** ${sitemap.timeoutUrls || 0}\n`;
            markdown += `- **⚫ Other Errors:** ${sitemap.otherErrorUrls || 0}\n\n`;

            if (sitemap.linkIssues.length > 0) {
                markdown += `### Link Issues Details\n\n`;

                const brokenLinks = sitemap.linkIssues.filter((issue: any) => issue.issueType === '404');
                const accessDeniedLinks = sitemap.linkIssues.filter((issue: any) => issue.issueType === 'access-denied');
                const timeoutLinks = sitemap.linkIssues.filter((issue: any) => issue.issueType === 'timeout');
                const otherErrors = sitemap.linkIssues.filter((issue: any) => issue.issueType === 'error');

                if (brokenLinks.length > 0) {
                    markdown += `#### 🔴 Broken Links (404) - ${brokenLinks.length}\n\n`;
                    brokenLinks.forEach((issue: any, i: number) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (accessDeniedLinks.length > 0) {
                    markdown += `#### 🟡 Access Denied (403) - ${accessDeniedLinks.length}\n\n`;
                    accessDeniedLinks.forEach((issue: any, i: number) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (timeoutLinks.length > 0) {
                    markdown += `#### 🟠 Timeout Issues - ${timeoutLinks.length}\n\n`;
                    timeoutLinks.forEach((issue: any, i: number) => {
                        markdown += `${i + 1}. \`${issue.url}\`\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }

                if (otherErrors.length > 0) {
                    markdown += `#### ⚫ Other Errors - ${otherErrors.length}\n\n`;
                    otherErrors.forEach((issue: any, i: number) => {
                        markdown += `${i + 1}. \`${issue.url}\` (${issue.status})\n`;
                        markdown += `   Error: ${issue.errorMessage}\n\n`;
                    });
                }
            } else {
                markdown += `### ✅ All Links Healthy\n\nNo broken links or accessibility issues found in the documentation sitemap!\n\n`;
            }
        }

        // Detailed Issue Analysis
        markdown += `## DETAILED ISSUE ANALYSIS\n\n`;

        validationResults.validationResults.forEach((result: any, index: number) => {
            const statusEmoji = result.status === 'resolved' ? '✅' :
                result.status === 'confirmed' ? '🔍' :
                    result.status === 'potential-gap' ? '⚠️' :
                        result.status === 'critical-gap' ? '❌' : '❓';

            markdown += `### ${index + 1}. ${statusEmoji} ${result.issueTitle}\n\n`;
            markdown += `**Status:** ${result.status.toUpperCase()}\n`;
            markdown += `**Confidence:** ${result.confidence}%\n\n`;

            // Evidence Analysis
            if (result.evidence && result.evidence.length > 0) {
                markdown += `**📄 Documentation Evidence (${result.evidence.length} pages analyzed):**\n\n`;
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
                markdown += `**💡 AI-Generated Recommendations:**\n\n`;
                result.recommendations.forEach((rec: string, idx: number) => {
                    // PRESERVE the full markdown formatting including code blocks
                    markdown += `${idx + 1}. ${rec}\n\n`;
                });
            }

            // Potential Gaps
            if (result.potentialGaps && result.potentialGaps.length > 0) {
                markdown += `**⚠️ Identified Gaps:**\n\n`;
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
            markdown += `### 🚨 Critical Priority (${criticalIssues.length} issues)\n\n`;
            criticalIssues.forEach((issue: any, idx: number) => {
                markdown += `${idx + 1}. **Create documentation for:** ${issue.issueTitle}\n`;
                markdown += `   - Developer Impact: High (no existing coverage)\n`;
                markdown += `   - Confidence: ${issue.confidence}%\n\n`;
            });
        }

        if (confirmedIssues.length > 0) {
            markdown += `### 🔍 High Priority (${confirmedIssues.length} confirmed gaps)\n\n`;
            confirmedIssues.forEach((issue: any, idx: number) => {
                markdown += `${idx + 1}. **Fix incomplete documentation for:** ${issue.issueTitle}\n`;
                markdown += `   - Developer Impact: High (docs exist but miss key info)\n`;
                markdown += `   - Confidence: ${issue.confidence}%\n\n`;
            });
        }

        if (potentialGaps.length > 0) {
            markdown += `### ⚠️ Medium Priority (${potentialGaps.length} issues)\n\n`;
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
                markdown += `⚠️ **Check Failed:** ${report.sitemapHealth.error}\n\n`;
            } else {
                markdown += `## LINK ISSUES\n\n✓ No broken links found - all URLs are healthy!\n\n`;
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
                    markdown += `⚠️ **Check Failed:** ${report.sitemapHealth.error}\n\n`;
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
                markdown += `- **llms.txt:** ${report.aiReadiness.llmsTxt.found ? '✅ Found' : '❌ Missing'}\n`;
                markdown += `- **llms-full.txt:** ${report.aiReadiness.llmsFullTxt.found ? '✅ Found' : '❌ Missing'}\n`;
                markdown += `- **Robots.txt AI Rules:** ${report.aiReadiness.robotsTxt.aiDirectives.length > 0 ? '✅ ' + report.aiReadiness.robotsTxt.aiDirectives.length + ' rules found' : '⚠️ No specific AI rules'}\n`;
                markdown += `- **Structured Data (JSON-LD):** ${report.aiReadiness.structuredData.hasJsonLd ? '✅ Found' : '❌ Missing'}\n`;

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
                markdown += `### URL Slug Issues (${urlSlugAnalysis.issues.length}) ⚠️\n\n`;
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
                    markdown += `${i + 1}. **${link.anchorText}** → \`${link.url}\`\n`;
                    markdown += `   Error: ${link.errorMessage}\n\n`;
                });
            }

            if (otherIssues.length > 0) {
                markdown += `#### Other Link Issues - ${otherIssues.length}\n\n`;
                otherIssues.forEach((link: any, i: number) => {
                    markdown += `${i + 1}. **${link.anchorText}** → \`${link.url}\` (${link.status})\n`;
                    markdown += `   Issue: ${link.errorMessage}\n`;
                    markdown += `   Type: ${link.issueType === 'access-denied' ? 'Access Denied (403)' : link.issueType === 'timeout' ? 'Timeout' : 'Error'}\n\n`;
                });
            }

            if (linkIssues.length === 0) {
                markdown += `✓ None found\n\n`;
            }

            // Deprecated Code
            const deprecatedCode = report.codeAnalysis.enhancedAnalysis?.deprecatedFindings || [];
            markdown += `### Deprecated Code (${deprecatedCode.length})\n\n`;
            if (deprecatedCode.length === 0) {
                markdown += `✓ None found\n\n`;
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
                markdown += `✓ None found\n\n`;
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
                    markdown += `⚠️ **Check Failed:** ${report.sitemapHealth.error}\n\n`;
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
    const exportUserGuidePdf = () => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const fn = 'PlusJakartaSans';
        doc.addFileToVFS('PlusJakartaSans-Regular.ttf', JAKARTA_REGULAR);
        doc.addFont('PlusJakartaSans-Regular.ttf', fn, 'normal');
        doc.addFileToVFS('PlusJakartaSans-Bold.ttf', JAKARTA_BOLD);
        doc.addFont('PlusJakartaSans-Bold.ttf', fn, 'bold');
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

    /** Export report as branded Perseverance AI PDF — Amazon narrative style */
    const exportPdfReport = (report: FinalReport) => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        // Register Plus Jakarta Sans font
        const fn = 'PlusJakartaSans';
        doc.addFileToVFS('PlusJakartaSans-Regular.ttf', JAKARTA_REGULAR);
        doc.addFont('PlusJakartaSans-Regular.ttf', fn, 'normal');
        doc.addFileToVFS('PlusJakartaSans-Bold.ttf', JAKARTA_BOLD);
        doc.addFont('PlusJakartaSans-Bold.ttf', fn, 'bold');
        doc.setFont(fn, 'normal');

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        const contentWidth = pageWidth - margin * 2;
        let y = 0;

        // --- Minimal palette: uniform dark text, matching user guide ---
        const c = {
            textDark: [30, 30, 30] as [number, number, number],
            textBody: [30, 30, 30] as [number, number, number],       // same as dark — uniform black
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
                    .replace(/\s*[—–]\s*/g, '. ')     // em dash, en dash to period+space
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

    return (
        <div className="App">
            <Container maxWidth={selectedMode === 'github-issues' && (analysisState.status === 'analyzing' || githubAnalysisResults) ? 'xl' : 'lg'} sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1, sm: 3 }, transition: 'max-width 0.3s ease' }}>

                <Paper sx={{ p: { xs: 2, sm: 4 }, mb: { xs: 2, sm: 4 } }}>
                    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3, alignItems: 'center' }}>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em', fontSize: { xs: '1.5rem', sm: '1.75rem' } }}>
                                Is your documentation visible to AI search?
                            </Typography>
                            <Typography variant="body1" sx={{ color: 'var(--text-secondary)', mt: 1, fontSize: '1rem', lineHeight: 1.6 }}>
                                Developers are finding documentation through ChatGPT, Perplexity, Claude, and other AI tools. Lensy checks if they can find yours.
                            </Typography>
                        </Box>
                    </Box>

                    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, alignItems: { xs: 'stretch', sm: 'flex-start' } }}>
                        <Box sx={{ flexGrow: 1, minWidth: 0, width: { xs: '100%', sm: 'auto' } }}>
                            {/* GitHub Issues mode removed — AI Readiness only */}
                            {selectedMode === 'github-issues' ? (
                                <>
                                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                                        <TextField
                                            sx={{ flexGrow: 1 }}
                                            label="GitHub Repository URL"
                                            variant="outlined"
                                            value={githubRepoUrl}
                                            onChange={(e) => {
                                                setGithubRepoUrl(e.target.value);
                                                if (githubIssues.length > 0 || githubFetchCompleted) {
                                                    setGithubIssues([]);
                                                    setSelectedGithubIssues([]);
                                                    setGithubAnalysisResults(null);
                                                    setGithubFetchCompleted(false);
                                                    setGithubFetchMeta(null);
                                                    setSuggestedDocsRepos([]);
                                                    setGithubDocsUrl('');
                                                    setShowManualDocsEntry(false);
                                                    setDocsContextHint(null);
                                                    setDocsContextReady(false);
                                                    setKbBuildState('idle');
                                                    setKbBuildProgress([]);
                                                    setKbInfo(null);
                                                }
                                            }}
                                            placeholder="https://github.com/owner/repo"
                                            disabled={analysisState.status === 'analyzing'}
                                            helperText="Enter a GitHub repository URL to scan open issues for documentation gaps"
                                        />
                                        <Button
                                            variant="contained"
                                            onClick={handleAnalyze}
                                            disabled={
                                                analysisState.status === 'analyzing' ||
                                                isFetchingGithubIssues ||
                                                (githubIssues.length > 0 && !docsContextReady) ||
                                                (githubIssues.length > 0 && docsContextReady && selectedGithubIssues.length === 0)
                                            }
                                            sx={{
                                                height: 56,
                                                minWidth: 120,
                                                px: 3,
                                                whiteSpace: 'nowrap',
                                                flexShrink: 0,
                                                // Inactive state when showing "Build KB First" or "Select Issues"
                                                // Lighter grey — looks like a button but not the primary CTA (white = active)
                                                ...((githubIssues.length > 0 && !docsContextReady && kbBuildState !== 'building') ||
                                                    (githubIssues.length > 0 && docsContextReady && selectedGithubIssues.length === 0)
                                                    ? {
                                                        bgcolor: 'var(--bg-tertiary)',
                                                        color: 'var(--text-muted)',
                                                        boxShadow: 'none',
                                                        border: '1px solid var(--border-default)',
                                                        '&:hover': { bgcolor: 'var(--bg-tertiary)', boxShadow: 'none' },
                                                        '&.Mui-disabled': {
                                                            backgroundColor: 'var(--bg-tertiary) !important',
                                                            color: 'var(--text-muted) !important',
                                                            border: '1px solid var(--border-default)',
                                                        }
                                                    }
                                                    : {
                                                        boxShadow: '0 0 20px rgba(59, 130, 246, 0.15)',
                                                        '&:hover': { boxShadow: '0 0 30px rgba(59, 130, 246, 0.25)' }
                                                    })
                                            }}
                                        >
                                            {analysisState.status === 'analyzing' ? (
                                                <CircularProgress size={20} color="inherit" />
                                            ) : isFetchingGithubIssues ? (
                                                <CircularProgress size={20} color="inherit" />
                                            ) : githubIssues.length === 0 ? 'Fetch Issues' :
                                                !docsContextReady ? (kbBuildState === 'building' ? 'Building KB...' : 'Build KB First') :
                                                    selectedGithubIssues.length > 0 ? `Analyze (${selectedGithubIssues.length})` : 'Select Issues'}
                                        </Button>
                                    </Box>
                                    {isFetchingGithubIssues && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mb: 1 }}>
                                            <CircularProgress size={16} sx={{ mr: 1.5 }} />
                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                                                Fetching open issues and discovering docs repos...
                                            </Typography>
                                        </Box>
                                    )}

                                    {/* ─── CASE A: Repos with REAL docs content found — show selectable radio list ─── */}
                                    {suggestedDocsRepos.some(r => r.hasDocsContent) && githubFetchCompleted && githubIssues.length > 0 && (
                                        <Alert
                                            severity="success"
                                            sx={{
                                                mt: 2,
                                                bgcolor: 'rgba(34, 197, 94, 0.08)',
                                                border: '1px solid rgba(34, 197, 94, 0.2)',
                                                '& .MuiAlert-icon': { color: '#22c55e' },
                                                '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                            }}
                                        >
                                            <Box>
                                                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                                                    Docs repo detected
                                                </Typography>
                                                {suggestedDocsRepos.filter(r => r.hasDocsContent).map((repoSuggestion) => (
                                                    <Box
                                                        key={repoSuggestion.fullName}
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 1,
                                                            mb: 0.5,
                                                            p: 0.75,
                                                            borderRadius: 1,
                                                            bgcolor: githubDocsUrl === repoSuggestion.fullName ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                                                            border: githubDocsUrl === repoSuggestion.fullName ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid transparent',
                                                            cursor: 'pointer',
                                                            '&:hover': { bgcolor: 'rgba(34, 197, 94, 0.08)' }
                                                        }}
                                                        onClick={() => {
                                                            setGithubDocsUrl(repoSuggestion.fullName);
                                                            setShowManualDocsEntry(false);
                                                            setDocsAsCodeConfirmation(null);
                                                            setNoDocsAsCode(false);
                                                            setCrawlUrl('');
                                                            setDocsContextReady(true);
                                                        }}
                                                    >
                                                        <Box sx={{
                                                            width: 16, height: 16, borderRadius: '50%',
                                                            border: githubDocsUrl === repoSuggestion.fullName ? '2px solid #22c55e' : '2px solid var(--border-strong)',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            flexShrink: 0
                                                        }}>
                                                            {githubDocsUrl === repoSuggestion.fullName && (
                                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e' }} />
                                                            )}
                                                        </Box>
                                                        <Box>
                                                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                                {repoSuggestion.fullName}
                                                            </Typography>
                                                            <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                                                {repoSuggestion.description || `${repoSuggestion.contentFileCount} docs files found`}
                                                            </Typography>
                                                        </Box>
                                                    </Box>
                                                ))}
                                                <Typography
                                                    variant="caption"
                                                    onClick={() => setShowManualDocsEntry(!showManualDocsEntry)}
                                                    sx={{
                                                        mt: 0.5,
                                                        display: 'inline-block',
                                                        fontSize: '0.65rem',
                                                        color: 'var(--text-muted)',
                                                        cursor: 'pointer',
                                                        '&:hover': { color: 'var(--text-secondary)' }
                                                    }}
                                                >
                                                    {showManualDocsEntry ? 'Hide' : 'Or enter a different docs repo URL'}
                                                </Typography>
                                                {showManualDocsEntry && (
                                                    <TextField
                                                        fullWidth
                                                        size="small"
                                                        variant="outlined"
                                                        value={!suggestedDocsRepos.some(r => r.fullName === githubDocsUrl) ? githubDocsUrl : ''}
                                                        onChange={(e) => setGithubDocsUrl(e.target.value)}
                                                        placeholder="owner/docs-repo"
                                                        disabled={analysisState.status === 'analyzing'}
                                                        sx={{
                                                            mt: 0.75,
                                                            '& .MuiOutlinedInput-root': {
                                                                fontSize: '0.8rem',
                                                                bgcolor: 'var(--bg-code-block)',
                                                                '& fieldset': { borderColor: 'rgba(34, 197, 94, 0.3)' }
                                                            },
                                                            '& .MuiInputBase-input': { color: 'var(--text-secondary)', py: 0.75 }
                                                        }}
                                                        helperText="e.g., owner/docs-repo or https://github.com/owner/docs-repo"
                                                        FormHelperTextProps={{ sx: { color: 'var(--text-muted)', fontSize: '0.65rem' } }}
                                                    />
                                                )}
                                            </Box>
                                        </Alert>
                                    )}

                                    {/* ─── CASE B: Repos found but NO docs content — Human-in-the-loop confirmation ─── */}
                                    {docsAsCodeConfirmation === 'pending' && githubFetchCompleted && githubIssues.length > 0 && (
                                        <Alert
                                            severity="warning"
                                            sx={{
                                                mt: 2,
                                                bgcolor: 'rgba(245, 158, 11, 0.08)',
                                                border: '1px solid rgba(245, 158, 11, 0.25)',
                                                '& .MuiAlert-icon': { color: '#f59e0b' },
                                                '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                            }}
                                        >
                                            <Box>
                                                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                                                    We found {suggestedDocsRepos.filter(r => !r.hasDocsContent).map(r => r.fullName).join(', ')} but no documentation content
                                                </Typography>
                                                <Typography variant="caption" sx={{ display: 'block', mb: 1.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                                    {suggestedDocsRepos.filter(r => !r.hasDocsContent).map(r =>
                                                        `${r.name}: ${r.codeFileCount} code files, ${r.contentFileCount < 0 ? 'has llms.txt' : `${r.contentFileCount} docs files`}`
                                                    ).join(' · ')}
                                                    <br />
                                                    This looks like website/app code, not documentation stored as markdown. <strong>Do you store your docs as code in GitHub?</strong>
                                                </Typography>
                                                <Box sx={{ display: 'flex', gap: 1 }}>
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        onClick={() => {
                                                            // User says YES docs are in code → pushback, but let them try
                                                            setDocsAsCodeConfirmation('yes');
                                                        }}
                                                        sx={{
                                                            borderColor: 'rgba(245, 158, 11, 0.4)',
                                                            color: '#f59e0b',
                                                            textTransform: 'none',
                                                            fontSize: '0.75rem',
                                                            '&:hover': { borderColor: '#f59e0b', bgcolor: 'rgba(245, 158, 11, 0.08)' }
                                                        }}
                                                    >
                                                        Yes, docs are in GitHub
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        onClick={() => {
                                                            // User says NO → go to website crawl path
                                                            setDocsAsCodeConfirmation('no');
                                                            setNoDocsAsCode(true);
                                                            setGithubDocsUrl('');
                                                        }}
                                                        sx={{
                                                            bgcolor: '#f59e0b',
                                                            color: 'var(--text-primary)',
                                                            fontWeight: 700,
                                                            textTransform: 'none',
                                                            fontSize: '0.75rem',
                                                            '&:hover': { bgcolor: '#d97706' }
                                                        }}
                                                    >
                                                        No, docs are on a website
                                                    </Button>
                                                </Box>
                                            </Box>
                                        </Alert>
                                    )}

                                    {/* ─── CASE B1: User said "Yes, docs are in GitHub" — pushback with repo selector + Search Docs ─── */}
                                    {docsAsCodeConfirmation === 'yes' && githubFetchCompleted && githubIssues.length > 0 && (
                                        <Alert
                                            severity="info"
                                            sx={{
                                                mt: 2,
                                                bgcolor: 'rgba(59, 130, 246, 0.08)',
                                                border: '1px solid rgba(59, 130, 246, 0.2)',
                                                '& .MuiAlert-icon': { color: '#3b82f6' },
                                                '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                            }}
                                        >
                                            <Box>
                                                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                                                    The repos we found don't appear to contain documentation files
                                                </Typography>
                                                <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                                    Select a repo and search for docs, or enter a different docs repo URL.
                                                </Typography>
                                                {suggestedDocsRepos.filter(r => !r.hasDocsContent).map((repoSuggestion) => (
                                                    <Box
                                                        key={repoSuggestion.fullName}
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 1,
                                                            mb: 0.5,
                                                            p: 0.75,
                                                            borderRadius: 1,
                                                            bgcolor: githubDocsUrl === repoSuggestion.fullName ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                                                            border: githubDocsUrl === repoSuggestion.fullName ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                                                            cursor: 'pointer',
                                                            '&:hover': { bgcolor: 'rgba(59, 130, 246, 0.08)' }
                                                        }}
                                                        onClick={() => setGithubDocsUrl(repoSuggestion.fullName)}
                                                    >
                                                        <Box sx={{
                                                            width: 16, height: 16, borderRadius: '50%',
                                                            border: githubDocsUrl === repoSuggestion.fullName ? '2px solid #3b82f6' : '2px solid var(--border-strong)',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            flexShrink: 0
                                                        }}>
                                                            {githubDocsUrl === repoSuggestion.fullName && (
                                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#3b82f6' }} />
                                                            )}
                                                        </Box>
                                                        <Box>
                                                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                                {repoSuggestion.fullName}
                                                            </Typography>
                                                            <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                                                {repoSuggestion.codeFileCount} code files, {repoSuggestion.contentFileCount} docs files
                                                            </Typography>
                                                        </Box>
                                                    </Box>
                                                ))}
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    variant="outlined"
                                                    value={!suggestedDocsRepos.some(r => r.fullName === githubDocsUrl) ? githubDocsUrl : ''}
                                                    onChange={(e) => setGithubDocsUrl(e.target.value)}
                                                    placeholder="owner/docs-repo"
                                                    disabled={analysisState.status === 'analyzing'}
                                                    sx={{
                                                        mt: 0.75,
                                                        '& .MuiOutlinedInput-root': {
                                                            fontSize: '0.8rem',
                                                            bgcolor: 'var(--bg-code-block)',
                                                            '& fieldset': { borderColor: 'rgba(59, 130, 246, 0.3)' }
                                                        },
                                                        '& .MuiInputBase-input': { color: 'var(--text-secondary)', py: 0.75 }
                                                    }}
                                                    helperText="Or enter a different docs repo (e.g., owner/docs-repo)"
                                                    FormHelperTextProps={{ sx: { color: 'var(--text-muted)', fontSize: '0.65rem' } }}
                                                />
                                                <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        disabled={!githubDocsUrl.trim()}
                                                        onClick={() => {
                                                            const selectedRepo = githubDocsUrl.trim();
                                                            // Check if it's a discovered repo (we already know it has no docs)
                                                            const isDiscoveredRepo = suggestedDocsRepos.some(r => r.fullName === selectedRepo);
                                                            if (isDiscoveredRepo) {
                                                                const repo = suggestedDocsRepos.find(r => r.fullName === selectedRepo);
                                                                // Show inline error, then reset back to CASE B after delay
                                                                setAnalysisState({
                                                                    status: 'error',
                                                                    error: `Only ${repo?.contentFileCount || 0} documentation file${(repo?.contentFileCount || 0) !== 1 ? 's' : ''} found in ${selectedRepo}. Minimum 5 needed for analysis.`,
                                                                    progressMessages: []
                                                                });
                                                                // Reset back to CASE B after a short delay
                                                                setTimeout(() => {
                                                                    setDocsAsCodeConfirmation('pending');
                                                                    setGithubDocsUrl('');
                                                                    setAnalysisState({ status: 'idle', progressMessages: [] });
                                                                }, 3000);
                                                            } else {
                                                                // Manually typed repo — accept optimistically
                                                                setGithubDocsUrl(selectedRepo);
                                                                setDocsContextReady(true);
                                                            }
                                                        }}
                                                        sx={{
                                                            bgcolor: '#3b82f6',
                                                            color: '#fff',
                                                            fontWeight: 700,
                                                            textTransform: 'none',
                                                            fontSize: '0.75rem',
                                                            '&:hover': { bgcolor: '#2563eb' },
                                                            '&:disabled': { bgcolor: 'rgba(59,130,246,0.3)', color: 'var(--text-muted)' }
                                                        }}
                                                    >
                                                        Search Docs
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        variant="text"
                                                        onClick={() => {
                                                            setDocsAsCodeConfirmation('pending');
                                                            setGithubDocsUrl('');
                                                        }}
                                                        sx={{ color: 'var(--text-muted)', textTransform: 'none', fontSize: '0.7rem' }}
                                                    >
                                                        Back
                                                    </Button>
                                                </Box>
                                            </Box>
                                        </Alert>
                                    )}

                                    {/* ─── CASE C: No docs repos found at all — show hint with manual entry ─── */}
                                    {docsContextHint && suggestedDocsRepos.length === 0 && githubFetchCompleted && githubIssues.length > 0 && (
                                        <Alert
                                            severity="info"
                                            sx={{
                                                mt: 2,
                                                bgcolor: 'rgba(59, 130, 246, 0.08)',
                                                border: '1px solid rgba(59, 130, 246, 0.2)',
                                                '& .MuiAlert-icon': { color: '#3b82f6' },
                                                '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                            }}
                                        >
                                            <Box>
                                                <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                                                    {docsContextHint} Provide a docs repo or website URL for more accurate analysis.
                                                </Typography>
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    variant="outlined"
                                                    value={githubDocsUrl}
                                                    onChange={(e) => setGithubDocsUrl(e.target.value)}
                                                    placeholder="owner/docs-repo"
                                                    disabled={analysisState.status === 'analyzing'}
                                                    sx={{
                                                        mt: 0.5,
                                                        '& .MuiOutlinedInput-root': {
                                                            fontSize: '0.8rem',
                                                            bgcolor: 'var(--bg-code-block)',
                                                            '& fieldset': { borderColor: 'rgba(59, 130, 246, 0.3)' }
                                                        },
                                                        '& .MuiInputBase-input': { color: 'var(--text-secondary)', py: 0.75 }
                                                    }}
                                                    helperText="GitHub docs repo URL (e.g., owner/docs-repo)"
                                                    FormHelperTextProps={{ sx: { color: 'var(--text-muted)', fontSize: '0.65rem' } }}
                                                />
                                                <Typography
                                                    variant="caption"
                                                    onClick={() => {
                                                        setNoDocsAsCode(true);
                                                        setDocsAsCodeConfirmation('no');
                                                    }}
                                                    sx={{
                                                        mt: 0.75,
                                                        display: 'inline-block',
                                                        fontSize: '0.65rem',
                                                        color: '#f59e0b',
                                                        cursor: 'pointer',
                                                        '&:hover': { color: '#fbbf24' }
                                                    }}
                                                >
                                                    Or provide a docs website URL instead (for non-code docs)
                                                </Typography>
                                            </Box>
                                        </Alert>
                                    )}

                                    {/* ─── KB Ready badge — shown when knowledge base is built ─── */}
                                    {kbBuildState === 'ready' && kbInfo && (
                                        <Box sx={{
                                            mt: 2, py: 1, px: 1.5, borderRadius: 1.5,
                                            bgcolor: 'rgba(34, 197, 94, 0.08)',
                                            border: '1px solid rgba(34, 197, 94, 0.2)',
                                            display: 'flex', alignItems: 'center', gap: 1
                                        }}>
                                            <CheckCircleIcon sx={{ fontSize: 16, color: '#22c55e' }} />
                                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#22c55e', fontSize: '0.7rem' }}>
                                                Knowledge base ready
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                                {kbInfo.pageCount} pages from {kbInfo.domain}
                                            </Typography>
                                            {analysisState.status !== 'analyzing' && !githubAnalysisResults && (
                                                <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.6rem', ml: 'auto' }}>
                                                    Select issues below to analyze
                                                </Typography>
                                            )}
                                        </Box>
                                    )}

                                    {/* ─── CASE D: Non-docs-as-code confirmed — domain input + preview confirmation ─── */}
                                    {noDocsAsCode && githubFetchCompleted && kbBuildState !== 'ready' && (
                                        <Box sx={{ mt: 2 }}>
                                            {/* Step 1: Enter docs website URL */}
                                            <Alert
                                                severity="warning"
                                                sx={{
                                                    bgcolor: 'rgba(245, 158, 11, 0.08)',
                                                    border: '1px solid rgba(245, 158, 11, 0.25)',
                                                    '& .MuiAlert-icon': { color: '#f59e0b' },
                                                    '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                                }}
                                            >
                                                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                                                    Enter your public docs website URL
                                                </Typography>
                                                <Typography variant="caption" sx={{ display: 'block', mb: 1.5, color: 'var(--text-muted)' }}>
                                                    We'll check for <code style={{ color: 'var(--text-code-inline)' }}>llms.txt</code> or <code style={{ color: 'var(--text-code-inline)' }}>sitemap.xml</code> to build a knowledge base for analysis.
                                                </Typography>
                                                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                                                    <TextField
                                                        size="small"
                                                        variant="outlined"
                                                        value={crawlUrl}
                                                        onChange={(e) => {
                                                            setCrawlUrl(e.target.value);
                                                            setPreviewDocs(null); // reset preview when URL changes
                                                            setManualLlmsUrl('');
                                                        }}
                                                        placeholder="docs.example.com"
                                                        disabled={analysisState.status === 'analyzing' || isPreviewingDocs}
                                                        sx={{
                                                            flexGrow: 1,
                                                            '& .MuiOutlinedInput-root': {
                                                                fontSize: '0.8rem',
                                                                bgcolor: 'var(--bg-code-block)',
                                                                '& fieldset': { borderColor: 'rgba(245, 158, 11, 0.3)' },
                                                                '&:hover fieldset': { borderColor: 'rgba(245, 158, 11, 0.5)' }
                                                            },
                                                            '& .MuiInputBase-input': { color: 'var(--text-secondary)', py: 0.75 }
                                                        }}
                                                    />
                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        onClick={handlePreviewDocs}
                                                        disabled={!crawlUrl.trim() || isPreviewingDocs}
                                                        sx={{
                                                            whiteSpace: 'nowrap',
                                                            height: 36,
                                                            bgcolor: 'var(--text-primary)',
                                                            color: 'var(--bg-primary)',
                                                            fontWeight: 600,
                                                            '&:hover': { bgcolor: 'var(--text-secondary)', color: 'var(--bg-primary)' },
                                                            '&.Mui-disabled': {
                                                                backgroundColor: 'var(--bg-tertiary) !important',
                                                                color: 'var(--text-muted) !important',
                                                            }
                                                        }}
                                                    >
                                                        {isPreviewingDocs ? <CircularProgress size={14} color="inherit" /> : 'Preview'}
                                                    </Button>
                                                </Box>
                                            </Alert>

                                            {/* Step 2a: Preview found docs — Phase 1: Show "Build Knowledge Base" button */}
                                            {previewDocs?.found && kbBuildState === 'idle' && (
                                                <Alert
                                                    severity="info"
                                                    sx={{
                                                        mt: 1.5,
                                                        bgcolor: 'rgba(59, 130, 246, 0.07)',
                                                        border: '1px solid rgba(59, 130, 246, 0.25)',
                                                        '& .MuiAlert-icon': { color: '#3b82f6' },
                                                        '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                                    }}
                                                >
                                                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                                                        Found <code style={{ color: 'var(--text-code-inline)' }}>{previewDocs.source}</code> at {previewDocs.domain}
                                                        {previewDocs.pageCount ? ` — ${previewDocs.pageCount} pages` : ''}
                                                    </Typography>
                                                    {previewDocs.categories && previewDocs.categories.length > 0 && (
                                                        <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', mb: 1 }}>
                                                            Categories: {previewDocs.categories.slice(0, 5).join(', ')}
                                                            {previewDocs.categories.length > 5 ? ` +${previewDocs.categories.length - 5} more` : ''}
                                                        </Typography>
                                                    )}
                                                    <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', mb: 1 }}>
                                                        Build a Knowledge Base from these docs to enable issue analysis. Crawls all pages, generates AI summaries, and caches for 7 days. Takes 1–2 min for new domains, instant if cached.
                                                    </Typography>
                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        onClick={handleBuildKb}
                                                        sx={{
                                                            bgcolor: '#3b82f6', color: '#fff', fontWeight: 700,
                                                            '&:hover': { bgcolor: '#2563eb' }
                                                        }}
                                                    >
                                                        Build Knowledge Base
                                                    </Button>
                                                </Alert>
                                            )}

                                            {/* Step 2a: Phase 2 — KB building in progress */}
                                            {previewDocs?.found && kbBuildState === 'building' && (
                                                <Alert
                                                    severity="info"
                                                    icon={<CircularProgress size={18} />}
                                                    sx={{
                                                        mt: 1.5,
                                                        bgcolor: 'rgba(59, 130, 246, 0.07)',
                                                        border: '1px solid rgba(59, 130, 246, 0.25)',
                                                        '& .MuiAlert-icon': { color: '#3b82f6', pt: 0.5 },
                                                        '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                                    }}
                                                >
                                                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                                                        Building Knowledge Base from {previewDocs.domain}...
                                                    </Typography>
                                                    <Box sx={{ maxHeight: 120, overflowY: 'auto', fontSize: '0.7rem' }}>
                                                        {kbBuildProgress.map((msg, idx) => (
                                                            <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                                                                {msg.type === 'success' ? <CheckCircleIcon sx={{ fontSize: 12, color: '#22c55e' }} /> :
                                                                    msg.type === 'error' ? <ErrorIcon sx={{ fontSize: 12, color: '#ef4444' }} /> :
                                                                        msg.type === 'cache-hit' ? <FlashOnIcon sx={{ fontSize: 12, color: '#f59e0b' }} /> :
                                                                            msg.type === 'cache-miss' ? <CachedIcon sx={{ fontSize: 12, color: 'var(--text-muted)' }} /> :
                                                                                <InfoIcon sx={{ fontSize: 12, color: 'var(--text-muted)' }} />}
                                                                <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                                                    {msg.message}
                                                                </Typography>
                                                            </Box>
                                                        ))}
                                                    </Box>
                                                </Alert>
                                            )}

                                            {/* Step 2a: Phase 4 — KB build error */}
                                            {kbBuildState === 'error' && (
                                                <Alert
                                                    severity="error"
                                                    sx={{
                                                        mt: 1.5,
                                                        bgcolor: 'rgba(239, 68, 68, 0.07)',
                                                        border: '1px solid rgba(239, 68, 68, 0.25)',
                                                        '& .MuiAlert-icon': { color: '#ef4444' },
                                                        '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                                    }}
                                                >
                                                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                                                        Knowledge Base build failed
                                                    </Typography>
                                                    {kbBuildProgress.filter(m => m.type === 'error').map((msg, idx) => (
                                                        <Typography key={idx} variant="caption" sx={{ display: 'block', color: '#ef4444', fontSize: '0.7rem' }}>
                                                            {msg.message}
                                                        </Typography>
                                                    ))}
                                                    <Button size="small" onClick={handleBuildKb} sx={{ mt: 1, color: '#ef4444', textTransform: 'none', fontSize: '0.7rem' }}>
                                                        Retry
                                                    </Button>
                                                </Alert>
                                            )}

                                            {/* Step 2b: BLOCKER — docs source not found, ask for manual URL */}
                                            {previewDocs && !previewDocs.found && (
                                                <Alert
                                                    severity="error"
                                                    sx={{
                                                        mt: 1.5,
                                                        bgcolor: 'rgba(239, 68, 68, 0.07)',
                                                        border: '1px solid rgba(239, 68, 68, 0.25)',
                                                        '& .MuiAlert-icon': { color: '#ef4444' },
                                                        '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                                    }}
                                                >
                                                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                                                        Could not find llms.txt or sitemap.xml at <strong>{previewDocs.domain}</strong>
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', mb: 1 }}>
                                                        Please provide the direct URL to your llms.txt or sitemap.xml to continue.
                                                    </Typography>
                                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                                        <TextField
                                                            size="small"
                                                            variant="outlined"
                                                            value={manualLlmsUrl}
                                                            onChange={(e) => setManualLlmsUrl(e.target.value)}
                                                            placeholder="https://docs.example.com/llms.txt"
                                                            disabled={analysisState.status === 'analyzing'}
                                                            sx={{
                                                                flexGrow: 1,
                                                                '& .MuiOutlinedInput-root': {
                                                                    fontSize: '0.8rem',
                                                                    bgcolor: 'var(--bg-code-block)',
                                                                    '& fieldset': { borderColor: 'rgba(239, 68, 68, 0.3)' }
                                                                },
                                                                '& .MuiInputBase-input': { color: 'var(--text-secondary)', py: 0.75 }
                                                            }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            onClick={handleConfirmManualUrl}
                                                            disabled={!manualLlmsUrl.trim()}
                                                            sx={{ borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444', whiteSpace: 'nowrap', height: 36 }}
                                                        >
                                                            Use This
                                                        </Button>
                                                    </Box>
                                                </Alert>
                                            )}
                                        </Box>
                                    )}

                                    {/* Zero issues found after fetch */}
                                    {githubFetchCompleted && githubIssues.length === 0 && !isFetchingGithubIssues && (
                                        <Box sx={{ mt: 3, p: 3, textAlign: 'center', bgcolor: 'var(--bg-card-dim)', borderRadius: 2, border: '1px solid var(--border-subtle)' }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'var(--text-primary)' }}>
                                                No open issues found
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                                                This repository has no open issues, or the issues could not be retrieved. Try a different repository.
                                            </Typography>
                                        </Box>
                                    )}

                                    {/* Zero docs-related issues found */}
                                    {githubFetchCompleted && githubIssues.length > 0 && githubIssues.filter(i => i.isDocsRelated).length === 0 && (
                                        <Box sx={{ mt: 3, p: 3, textAlign: 'center', bgcolor: 'rgba(34, 197, 94, 0.05)', borderRadius: 2, border: '1px solid rgba(34, 197, 94, 0.15)' }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'var(--text-primary)' }}>
                                                No documentation-related issues found
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                                                Found {githubIssues.length} open issue{githubIssues.length !== 1 ? 's' : ''}, but none appear to be related to documentation gaps. Great docs!
                                            </Typography>
                                        </Box>
                                    )}

                                    {/* ─── Issues count badge (shown when docs context is NOT ready) ─── */}
                                    {githubIssues.length > 0 && githubIssues.filter(i => i.isDocsRelated).length > 0 && !docsContextReady && (
                                        <Box sx={{
                                            mt: 2, p: 1.5, borderRadius: 1.5,
                                            bgcolor: 'rgba(59, 130, 246, 0.06)',
                                            border: '1px solid rgba(59, 130, 246, 0.15)',
                                            display: 'flex', alignItems: 'center', gap: 1.5
                                        }}>
                                            <Box sx={{
                                                width: 28, height: 28, borderRadius: '50%',
                                                bgcolor: 'rgba(59, 130, 246, 0.15)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0
                                            }}>
                                                <Typography variant="caption" sx={{ fontWeight: 800, color: '#3b82f6', fontSize: '0.7rem' }}>
                                                    {githubIssues.filter(i => i.isDocsRelated).length}
                                                </Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'block', lineHeight: 1.3 }}>
                                                    {githubIssues.filter(i => i.isDocsRelated).length} docs-related issue{githubIssues.filter(i => i.isDocsRelated).length !== 1 ? 's' : ''} found
                                                    {githubFetchMeta && <> · {githubFetchMeta.totalFetched} scanned ({githubFetchMeta.dateRange})</>}
                                                </Typography>
                                                <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                                    {previewDocs?.found && kbBuildState === 'idle'
                                                        ? 'Build the Knowledge Base above to unlock issue selection'
                                                        : kbBuildState === 'building'
                                                            ? 'Knowledge Base is being built...'
                                                            : 'Resolve documentation source above to select and analyze issues'
                                                    }
                                                </Typography>
                                            </Box>
                                        </Box>
                                    )}

                                    {/* ─── Full issues list (shown when docs context IS ready) ─── */}
                                    {githubIssues.length > 0 && githubIssues.filter(i => i.isDocsRelated).length > 0 && docsContextReady && (
                                        <Box sx={{ mt: 3 }}>
                                            {/* Two-column layout: issues left, results/progress right */}
                                            <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>

                                                {/* LEFT COLUMN: Issues list */}
                                                <Box sx={{ flex: (analysisState.status === 'analyzing' || githubAnalysisResults) ? '0 0 38%' : '1 1 100%', minWidth: 0, transition: 'flex 0.3s ease' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                                        <Box>
                                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                                                {githubIssues.filter(i => i.isDocsRelated).length} docs-related issues found
                                                            </Typography>
                                                            {githubFetchMeta && (
                                                                <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                                                    Scanned {githubFetchMeta.totalFetched} open issues · {githubFetchMeta.dateRange} · AI-classified
                                                                </Typography>
                                                            )}
                                                        </Box>
                                                        {/* Select All / Unselect All */}
                                                        <Button
                                                            size="small"
                                                            variant="text"
                                                            onClick={() => {
                                                                const docsIssueNumbers = githubIssues.filter(i => i.isDocsRelated).map(i => i.number);
                                                                if (selectedGithubIssues.length === docsIssueNumbers.length) {
                                                                    setSelectedGithubIssues([]);
                                                                } else {
                                                                    setSelectedGithubIssues(docsIssueNumbers);
                                                                }
                                                            }}
                                                            disabled={analysisState.status === 'analyzing'}
                                                            sx={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'none', color: '#3b82f6', minWidth: 'auto', px: 1 }}
                                                        >
                                                            {selectedGithubIssues.length === githubIssues.filter(i => i.isDocsRelated).length ? 'Unselect all' : 'Select all'}
                                                        </Button>
                                                    </Box>
                                                    <Box ref={issuesListRef} sx={{
                                                        border: '1px solid',
                                                        borderColor: 'var(--border-subtle)',
                                                        borderRadius: 2,
                                                        overflow: 'hidden',
                                                        maxHeight: (analysisState.status === 'analyzing' || githubAnalysisResults) ? 600 : 'none',
                                                        overflowY: 'auto',
                                                        position: 'relative',
                                                        /* Hidden scrollbar by default, visible on hover */
                                                        '&::-webkit-scrollbar': { width: 6 },
                                                        '&::-webkit-scrollbar-track': { background: 'transparent' },
                                                        '&::-webkit-scrollbar-thumb': { background: 'transparent', borderRadius: 3, transition: 'background 0.2s' },
                                                        '&:hover::-webkit-scrollbar-thumb': { background: 'var(--border-default)' },
                                                        '&:hover::-webkit-scrollbar-thumb:hover': { background: 'var(--border-strong)' },
                                                        scrollbarWidth: 'thin',
                                                        scrollbarColor: 'transparent transparent',
                                                        '&:hover': { scrollbarColor: 'var(--border-default) transparent' },
                                                    }}>
                                                        {githubIssues
                                                            .filter(i => i.isDocsRelated)
                                                            .sort((a, b) => (b.docsConfidence || 0) - (a.docsConfidence || 0))
                                                            .map((issue, index, arr) => (
                                                                <Box
                                                                    key={issue.number}
                                                                    sx={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        px: 1.5,
                                                                        py: 0.75,
                                                                        borderBottom: index < arr.length - 1 ? '1px solid' : 'none',
                                                                        borderBottomColor: 'var(--border-subtle)',
                                                                        bgcolor: selectedGithubIssues.includes(issue.number) ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                                                                        '&:hover': { bgcolor: 'var(--bg-card-dim)' },
                                                                        cursor: 'pointer',
                                                                        transition: 'all 0.2s'
                                                                    }}
                                                                    onClick={() => {
                                                                        if (selectedGithubIssues.includes(issue.number)) {
                                                                            setSelectedGithubIssues(selectedGithubIssues.filter(n => n !== issue.number));
                                                                        } else {
                                                                            setSelectedGithubIssues([...selectedGithubIssues, issue.number]);
                                                                        }
                                                                    }}
                                                                >
                                                                    <Checkbox
                                                                        checked={selectedGithubIssues.includes(issue.number)}
                                                                        disabled={analysisState.status === 'analyzing'}
                                                                        size="small"
                                                                        sx={{ mr: 1 }}
                                                                    />
                                                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                                                                            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', flex: 1, minWidth: 0 }}>
                                                                                #{issue.number}: {issue.title}
                                                                            </Typography>
                                                                            {(issue.docsConfidence ?? 0) > 0 && (
                                                                                <Chip
                                                                                    label={`${issue.docsConfidence}%`}
                                                                                    size="small"
                                                                                    sx={{
                                                                                        height: 20,
                                                                                        fontSize: '0.6rem',
                                                                                        fontWeight: 800,
                                                                                        flexShrink: 0,
                                                                                        bgcolor: (issue.docsConfidence || 0) >= 80 ? 'rgba(34, 197, 94, 0.12)' : (issue.docsConfidence || 0) >= 60 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(107, 114, 128, 0.10)',
                                                                                        color: (issue.docsConfidence || 0) >= 80 ? '#22c55e' : (issue.docsConfidence || 0) >= 60 ? '#f59e0b' : '#737373',
                                                                                        border: '1px solid',
                                                                                        borderColor: (issue.docsConfidence || 0) >= 80 ? 'rgba(34, 197, 94, 0.25)' : (issue.docsConfidence || 0) >= 60 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(107, 114, 128, 0.20)',
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </Box>
                                                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.25 }}>
                                                                            {(issue.docsCategories || []).map(cat => (
                                                                                <Chip key={cat} label={cat} size="small"
                                                                                    sx={{ height: 18, fontSize: '0.55rem', fontWeight: 700, bgcolor: 'rgba(59, 130, 246, 0.10)', color: 'var(--accent-hover)', border: '1px solid rgba(59, 130, 246, 0.20)', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }} />
                                                                            ))}
                                                                            {issue.labels.slice(0, 2).map(l => (
                                                                                <Chip key={l.name} label={l.name} size="small"
                                                                                    sx={{ height: 18, fontSize: '0.55rem', fontWeight: 700, maxWidth: 150, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }} />
                                                                            ))}
                                                                            {issue.labels.length > 2 && (
                                                                                <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'var(--text-secondary)', lineHeight: '18px' }}>
                                                                                    +{issue.labels.length - 2}
                                                                                </Typography>
                                                                            )}
                                                                        </Box>
                                                                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem', lineHeight: 1.3, mt: 0.25 }}>
                                                                            {issue.body ? issue.body.substring(0, 80).replace(/\n/g, ' ') + '...' : 'No description'}
                                                                        </Typography>
                                                                        <Box sx={{ display: 'flex', gap: 1.5, mt: 0.25 }}>
                                                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                                                                💬 {issue.comments} comments
                                                                            </Typography>
                                                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                                                                <a href={issue.html_url} target="_blank" rel="noopener noreferrer"
                                                                                    style={{ color: 'inherit', textDecoration: 'underline' }}
                                                                                    onClick={(e) => e.stopPropagation()}>
                                                                                    View on GitHub ↗
                                                                                </a>
                                                                            </Typography>
                                                                        </Box>
                                                                    </Box>
                                                                </Box>
                                                            ))}
                                                    </Box>
                                                    {/* Down arrow scroll indicator — only when list has overflow and not scrolled to bottom */}
                                                    {showScrollIndicator && (
                                                        <Box sx={{
                                                            display: 'flex',
                                                            justifyContent: 'center',
                                                            py: 0.75,
                                                            animation: 'bounceArrow 1.5s ease-in-out infinite',
                                                            '@keyframes bounceArrow': {
                                                                '0%, 100%': { transform: 'translateY(0)' },
                                                                '50%': { transform: 'translateY(3px)' },
                                                            }
                                                        }}>
                                                            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                                                ▼ scroll for more
                                                            </Typography>
                                                        </Box>
                                                    )}
                                                </Box>

                                                {/* RIGHT COLUMN: Progress (while analyzing) or Results (when done) */}
                                                {(analysisState.status === 'analyzing' || githubAnalysisResults) && (
                                                    <Box sx={{ flex: '0 0 60%', minWidth: 0, overflow: 'hidden' }}>

                                                        {/* Progress indicator — only while analyzing */}
                                                        {analysisState.status === 'analyzing' && (
                                                            <Box sx={{ p: 3, bgcolor: 'rgba(59, 130, 246, 0.05)', borderRadius: 2, border: '1px solid rgba(59, 130, 246, 0.15)' }}>
                                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                                    <CircularProgress size={18} sx={{ mr: 1.5 }} />
                                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.85rem' }}>
                                                                        Analyzing {selectedGithubIssues.length} issue{selectedGithubIssues.length !== 1 ? 's' : ''}...
                                                                    </Typography>
                                                                </Box>
                                                                <Typography variant="caption" sx={{ color: 'var(--text-muted)', display: 'block', mb: 1.5, fontSize: '0.75rem' }}>
                                                                    Fetching repo docs and running AI analysis. This takes 5-15 seconds per issue.
                                                                </Typography>
                                                                {/* Inline progress messages */}
                                                                {analysisState.progressMessages.length > 0 && (
                                                                    <Box sx={{ borderTop: '1px solid rgba(59, 130, 246, 0.1)', pt: 1 }}>
                                                                        {analysisState.progressMessages.map((msg, index) => (
                                                                            <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                                                                <Box sx={{
                                                                                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                                                                    bgcolor: msg.type === 'error' ? '#ef4444' : msg.type === 'success' ? '#22c55e' : msg.type === 'warning' ? '#f59e0b' : '#3b82f6'
                                                                                }} />
                                                                                <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                                                                    {msg.message}
                                                                                </Typography>
                                                                            </Box>
                                                                        ))}
                                                                    </Box>
                                                                )}
                                                            </Box>
                                                        )}

                                                        {/* Fallback: Analysis returned noDocsAsCode — scroll up to use website crawl */}
                                                        {noDocsAsCode && analysisState.status !== 'analyzing' && !crawlUrl && (
                                                            <Alert
                                                                severity="warning"
                                                                sx={{
                                                                    mb: 2,
                                                                    bgcolor: 'rgba(245, 158, 11, 0.08)',
                                                                    border: '1px solid rgba(245, 158, 11, 0.2)',
                                                                    '& .MuiAlert-icon': { color: '#f59e0b' },
                                                                    '& .MuiAlert-message': { color: 'var(--text-secondary)', width: '100%' }
                                                                }}
                                                            >
                                                                <Box>
                                                                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                                                                        No documentation files found in {githubDocsUrl}
                                                                    </Typography>
                                                                    <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                                                        It looks like this repo contains website code, not documentation files. Scroll up and enter your docs website URL to use the website crawl path instead.
                                                                    </Typography>
                                                                </Box>
                                                            </Alert>
                                                        )}

                                                        {/* Results — shown after analysis completes */}
                                                        {githubAnalysisResults && githubAnalysisResults.length > 0 && analysisState.status !== 'analyzing' && (
                                                            <Box>
                                                                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700, color: 'var(--text-primary)' }}>
                                                                    Recommended Changes ({githubAnalysisResults.length})
                                                                </Typography>
                                                                {githubAnalysisResults.map((result: any, idx: number) => (
                                                                    <Card key={idx} sx={{
                                                                        mb: 2.5,
                                                                        border: '1px solid',
                                                                        borderColor: 'var(--border-subtle)',
                                                                        borderLeft: '3px solid',
                                                                        borderLeftColor: '#3b82f6',
                                                                        overflow: 'hidden'
                                                                    }}>
                                                                        <CardContent sx={{ pb: '12px !important', p: 2 }}>
                                                                            {/* Header: issue title + link */}
                                                                            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.75 }}>
                                                                                <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, fontSize: '0.9rem' }}>
                                                                                    #{result.number}: {result.title}
                                                                                </Typography>
                                                                                <a href={result.html_url} target="_blank" rel="noopener noreferrer"
                                                                                    style={{ marginLeft: 8, color: 'var(--text-muted)', display: 'inline-flex' }}
                                                                                    title="View issue on GitHub">
                                                                                    <OpenInNewIcon sx={{ fontSize: 18, '&:hover': { color: '#3b82f6' } }} />
                                                                                </a>
                                                                            </Box>

                                                                            {/* Gap type + confidence badge */}
                                                                            <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                                                                                <Chip
                                                                                    label={result.docsGap?.gapType?.replace('-', ' ') || 'analysis pending'}
                                                                                    size="small"
                                                                                    variant="outlined"
                                                                                    sx={{ fontWeight: 600, textTransform: 'capitalize', fontSize: '0.7rem', borderColor: 'rgba(59, 130, 246, 0.20)', color: 'var(--accent-hover)' }}
                                                                                />
                                                                                <Chip
                                                                                    label={`${result.docsGap?.confidence || 0}%`}
                                                                                    size="small"
                                                                                    sx={{
                                                                                        fontWeight: 700,
                                                                                        fontSize: '0.65rem',
                                                                                        bgcolor: (result.docsGap?.confidence || 0) >= 80 ? 'rgba(34, 197, 94, 0.12)' : (result.docsGap?.confidence || 0) >= 60 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(107, 114, 128, 0.10)',
                                                                                        color: (result.docsGap?.confidence || 0) >= 80 ? '#22c55e' : (result.docsGap?.confidence || 0) >= 60 ? '#f59e0b' : '#737373',
                                                                                        border: '1px solid',
                                                                                        borderColor: (result.docsGap?.confidence || 0) >= 80 ? 'rgba(34, 197, 94, 0.25)' : (result.docsGap?.confidence || 0) >= 60 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(107, 114, 128, 0.20)',
                                                                                    }}
                                                                                />
                                                                            </Box>

                                                                            {/* Section context */}
                                                                            {result.docsGap?.section && (
                                                                                <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                                                                    {result.docsGap.section}{result.docsGap.lineContext ? ` · ${result.docsGap.lineContext}` : ''}
                                                                                </Typography>
                                                                            )}

                                                                            {/* Affected pages & reasoning */}
                                                                            {result.docsGap?.affectedDocs?.length > 0 && (
                                                                                <Box sx={{
                                                                                    mb: 1, py: 1, px: 1.5,
                                                                                    bgcolor: 'rgba(96, 165, 250, 0.06)',
                                                                                    border: '1px solid rgba(96, 165, 250, 0.15)',
                                                                                    borderRadius: 1,
                                                                                    display: 'flex', flexDirection: 'column', gap: 0.75,
                                                                                }}>
                                                                                    {/* Page URLs */}
                                                                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'baseline' }}>
                                                                                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                                                                            Page URLs:
                                                                                        </Typography>
                                                                                        {result.docsGap.affectedDocs.map((doc: string, docIdx: number) => (
                                                                                            doc.startsWith('http') ? (
                                                                                                <a
                                                                                                    key={docIdx}
                                                                                                    href={doc}
                                                                                                    target="_blank"
                                                                                                    rel="noopener noreferrer"
                                                                                                    style={{
                                                                                                        color: 'var(--accent-hover)',
                                                                                                        fontSize: '0.8rem',
                                                                                                        textDecoration: 'underline',
                                                                                                        wordBreak: 'break-all'
                                                                                                    }}
                                                                                                >
                                                                                                    {new URL(doc).pathname}
                                                                                                </a>
                                                                                            ) : (
                                                                                                <Typography key={docIdx} variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                                                                                    {doc}
                                                                                                </Typography>
                                                                                            )
                                                                                        ))}
                                                                                    </Box>
                                                                                    {/* Reasoning */}
                                                                                    {result.docsGap?.affectedDocsReason && (
                                                                                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline' }}>
                                                                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', flexShrink: 0 }}>
                                                                                                Reasoning:
                                                                                            </Typography>
                                                                                            <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                                                                                                {result.docsGap.affectedDocsReason}
                                                                                            </Typography>
                                                                                        </Box>
                                                                                    )}
                                                                                </Box>
                                                                            )}

                                                                            {/* Before / After text blocks */}
                                                                            {result.docsGap?.originalText && result.docsGap?.correctedText && (
                                                                                <Box sx={{ mb: 1 }}>
                                                                                    {/* Before */}
                                                                                    <Box sx={{ mb: 1 }}>
                                                                                        <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>
                                                                                            Before
                                                                                        </Typography>
                                                                                        <Box sx={{
                                                                                            bgcolor: 'var(--bg-card-dim)',
                                                                                            border: '1px solid var(--border-card-dim)',
                                                                                            borderRadius: 1,
                                                                                            p: 1.5,
                                                                                            overflow: 'auto',
                                                                                            wordBreak: 'break-word',
                                                                                            '& h1, & h2, & h3, & h4, & h5, & h6': { color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700, mt: 1, mb: 0.5, '&:first-of-type': { mt: 0 } },
                                                                                            '& p': { color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.6, mb: 0.75, '&:last-child': { mb: 0 } },
                                                                                            '& code': { bgcolor: 'var(--bg-code-inline)', color: 'var(--text-code-inline)', px: 0.5, py: 0.25, borderRadius: '3px', fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all' },
                                                                                            '& pre': { bgcolor: 'var(--bg-code-block)', border: '1px solid var(--border-code)', borderRadius: 1, p: 1.5, overflow: 'auto', mb: 0.75, maxWidth: '100%', '& code': { bgcolor: 'transparent', p: 0, color: 'var(--text-code-block)', wordBreak: 'normal' } },
                                                                                            '& ul, & ol': { color: 'var(--text-secondary)', fontSize: '0.8rem', pl: 2.5, mb: 0.75 },
                                                                                            '& li': { mb: 0.25 },
                                                                                            '& a': { color: 'var(--accent-hover)', textDecoration: 'underline' },
                                                                                            '& blockquote': { borderLeft: '3px solid var(--border-default)', pl: 1.5, ml: 0, color: 'var(--text-muted)' },
                                                                                        }}>
                                                                                            <ReactMarkdown>{result.docsGap.originalText}</ReactMarkdown>
                                                                                        </Box>
                                                                                    </Box>
                                                                                    {/* After */}
                                                                                    <Box>
                                                                                        <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>
                                                                                            After
                                                                                        </Typography>
                                                                                        <Box sx={{
                                                                                            bgcolor: 'var(--bg-card-dim)',
                                                                                            border: '1px solid var(--border-card-dim)',
                                                                                            borderRadius: 1,
                                                                                            p: 1.5,
                                                                                            overflow: 'auto',
                                                                                            wordBreak: 'break-word',
                                                                                            '& h1, & h2, & h3, & h4, & h5, & h6': { color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700, mt: 1, mb: 0.5, '&:first-of-type': { mt: 0 } },
                                                                                            '& p': { color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.6, mb: 0.75, '&:last-child': { mb: 0 } },
                                                                                            '& code': { bgcolor: 'var(--bg-code-inline)', color: 'var(--text-code-inline)', px: 0.5, py: 0.25, borderRadius: '3px', fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all' },
                                                                                            '& pre': { bgcolor: 'var(--bg-code-block)', border: '1px solid var(--border-code)', borderRadius: 1, p: 1.5, overflow: 'auto', mb: 0.75, maxWidth: '100%', '& code': { bgcolor: 'transparent', p: 0, color: 'var(--text-code-block)', wordBreak: 'normal' } },
                                                                                            '& ul, & ol': { color: 'var(--text-secondary)', fontSize: '0.8rem', pl: 2.5, mb: 0.75 },
                                                                                            '& li': { mb: 0.25 },
                                                                                            '& a': { color: 'var(--accent-hover)', textDecoration: 'underline' },
                                                                                            '& blockquote': { borderLeft: '3px solid var(--border-default)', pl: 1.5, ml: 0, color: 'var(--text-muted)' },
                                                                                        }}>
                                                                                            <ReactMarkdown>{result.docsGap.correctedText}</ReactMarkdown>
                                                                                        </Box>
                                                                                    </Box>
                                                                                </Box>
                                                                            )}

                                                                            {/* Source References — prove recommendation is grounded */}
                                                                            {result.docsGap?.sourceReferences?.length > 0 && (
                                                                                <Box sx={{ mb: 1 }}>
                                                                                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>
                                                                                        Sources
                                                                                    </Typography>
                                                                                    <Box sx={{
                                                                                        bgcolor: 'rgba(139, 92, 246, 0.04)',
                                                                                        border: '1px solid rgba(139, 92, 246, 0.12)',
                                                                                        borderRadius: 1,
                                                                                        p: 1,
                                                                                    }}>
                                                                                        {result.docsGap.sourceReferences.map((ref: any, refIdx: number) => (
                                                                                            <Box key={refIdx} sx={{ display: 'flex', gap: 0.75, mb: refIdx < result.docsGap.sourceReferences.length - 1 ? 0.75 : 0, alignItems: 'flex-start' }}>
                                                                                                <Chip
                                                                                                    label={ref.type === 'docs-page' ? 'DOCS' : 'ISSUE'}
                                                                                                    size="small"
                                                                                                    sx={{
                                                                                                        height: 18,
                                                                                                        fontSize: '0.5rem',
                                                                                                        fontWeight: 800,
                                                                                                        flexShrink: 0,
                                                                                                        mt: 0.25,
                                                                                                        bgcolor: ref.type === 'docs-page' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                                                                                                        color: ref.type === 'docs-page' ? 'var(--accent-hover)' : '#fbbf24',
                                                                                                        border: '1px solid',
                                                                                                        borderColor: ref.type === 'docs-page' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(245, 158, 11, 0.25)',
                                                                                                    }}
                                                                                                />
                                                                                                <Box sx={{ minWidth: 0 }}>
                                                                                                    <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.4, display: 'block', fontStyle: 'italic' }}>
                                                                                                        "{ref.excerpt}"
                                                                                                    </Typography>
                                                                                                    {ref.url && (
                                                                                                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                                                                                                            <a href={ref.url} target="_blank" rel="noopener noreferrer"
                                                                                                                style={{ color: 'inherit', textDecoration: 'underline' }}
                                                                                                                onClick={(e: any) => e.stopPropagation()}>
                                                                                                                {ref.url.length > 60 ? ref.url.substring(0, 60) + '...' : ref.url}
                                                                                                            </a>
                                                                                                        </Typography>
                                                                                                    )}
                                                                                                </Box>
                                                                                            </Box>
                                                                                        ))}
                                                                                    </Box>
                                                                                </Box>
                                                                            )}

                                                                            {/* Action buttons row */}
                                                                            {result.docsGap?.correctedText && (
                                                                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                                                                                    <Button
                                                                                        size="small"
                                                                                        variant="outlined"
                                                                                        startIcon={copiedFixIndex === idx ? <CheckIcon /> : <ContentCopyIcon />}
                                                                                        onClick={() => {
                                                                                            navigator.clipboard.writeText(result.docsGap.correctedText);
                                                                                            setCopiedFixIndex(idx);
                                                                                            setTimeout(() => setCopiedFixIndex(null), 2000);
                                                                                        }}
                                                                                        sx={{
                                                                                            fontWeight: 600,
                                                                                            fontSize: '0.7rem',
                                                                                            whiteSpace: 'nowrap',
                                                                                            color: copiedFixIndex === idx ? '#22c55e' : '#3b82f6',
                                                                                            borderColor: copiedFixIndex === idx ? '#22c55e' : '#3b82f6',
                                                                                            '&:hover': { borderColor: copiedFixIndex === idx ? '#22c55e' : '#2563eb', bgcolor: 'rgba(59,130,246,0.05)' }
                                                                                        }}
                                                                                    >
                                                                                        {copiedFixIndex === idx ? 'Copied!' : 'Copy corrected text'}
                                                                                    </Button>
                                                                                    {result.docsGap?.affectedDocs?.length > 0 && docsSource !== 'website' && (() => {
                                                                                        const isPrCreated = prUrls[result.number];
                                                                                        const isCreating = creatingPrIndex === idx;

                                                                                        if (isPrCreated) {
                                                                                            return (
                                                                                                <Button
                                                                                                    size="small"
                                                                                                    variant="outlined"
                                                                                                    startIcon={<CheckIcon />}
                                                                                                    href={prUrls[result.number]}
                                                                                                    target="_blank"
                                                                                                    rel="noopener noreferrer"
                                                                                                    sx={{
                                                                                                        fontWeight: 600,
                                                                                                        fontSize: '0.7rem',
                                                                                                        whiteSpace: 'nowrap',
                                                                                                        color: '#22c55e',
                                                                                                        borderColor: '#22c55e',
                                                                                                        '&:hover': { borderColor: '#16a34a', bgcolor: 'rgba(34,197,94,0.05)' }
                                                                                                    }}
                                                                                                >
                                                                                                    View PR
                                                                                                </Button>
                                                                                            );
                                                                                        }

                                                                                        return (
                                                                                            <Button
                                                                                                size="small"
                                                                                                variant="outlined"
                                                                                                disabled={isCreating}
                                                                                                startIcon={isCreating ? <CircularProgress size={14} /> : <OpenInNewIcon />}
                                                                                                onClick={async () => {
                                                                                                    setCreatingPrIndex(idx);
                                                                                                    setPrError(null);
                                                                                                    try {
                                                                                                        const urlStr = githubRepoUrl.trim();
                                                                                                        let owner = '', repo = '';
                                                                                                        if (urlStr.includes('github.com')) {
                                                                                                            const parts = urlStr.replace(/https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, '').split('/');
                                                                                                            owner = parts[0];
                                                                                                            repo = parts[1]?.replace(/\.git$/, '') || '';
                                                                                                        } else if (urlStr.includes('/')) {
                                                                                                            [owner, repo] = urlStr.split('/');
                                                                                                        }
                                                                                                        const filePath = result.docsGap.affectedDocs[0].replace(/^\//, '');

                                                                                                        const response = await fetch(`${API_BASE_URL}/github-issues/create-pr`, {
                                                                                                            method: 'POST',
                                                                                                            headers: { 'Content-Type': 'application/json' },
                                                                                                            body: JSON.stringify({
                                                                                                                owner,
                                                                                                                repo,
                                                                                                                filePath,
                                                                                                                originalText: result.docsGap.originalText || '',
                                                                                                                correctedText: result.docsGap.correctedText,
                                                                                                                issueNumber: result.number,
                                                                                                                issueTitle: result.title,
                                                                                                                gapType: result.docsGap.gapType,
                                                                                                                confidence: result.docsGap.confidence
                                                                                                            })
                                                                                                        });

                                                                                                        if (!response.ok) {
                                                                                                            const errorData = await response.json().catch(() => ({}));
                                                                                                            throw new Error(errorData.message || `Failed to create PR (HTTP ${response.status})`);
                                                                                                        }

                                                                                                        const prData = await response.json();
                                                                                                        if (prData.prUrl) {
                                                                                                            setPrUrls(prev => ({ ...prev, [result.number]: prData.prUrl }));
                                                                                                        }
                                                                                                    } catch (err: any) {
                                                                                                        console.error('PR creation failed:', err);
                                                                                                        setPrError(err.message || 'Failed to create PR');
                                                                                                    } finally {
                                                                                                        setCreatingPrIndex(null);
                                                                                                    }
                                                                                                }}
                                                                                                sx={{
                                                                                                    fontWeight: 600,
                                                                                                    fontSize: '0.7rem',
                                                                                                    whiteSpace: 'nowrap',
                                                                                                    color: 'var(--text-code-inline)',
                                                                                                    borderColor: 'var(--accent-primary)',
                                                                                                    '&:hover': { borderColor: 'var(--accent-hover)', bgcolor: 'rgba(139,92,246,0.05)' }
                                                                                                }}
                                                                                            >
                                                                                                {isCreating ? 'Creating PR...' : 'Open PR'}
                                                                                            </Button>
                                                                                        );
                                                                                    })()}
                                                                                </Box>
                                                                            )}
                                                                            {prError && creatingPrIndex === null && (
                                                                                <Typography variant="caption" sx={{ color: '#ef4444', mt: 0.5, display: 'block' }}>
                                                                                    {prError}
                                                                                </Typography>
                                                                            )}
                                                                        </CardContent>
                                                                    </Card>
                                                                ))}
                                                            </Box>
                                                        )}

                                                        {/* Empty state */}
                                                        {githubAnalysisResults && githubAnalysisResults.length === 0 && analysisState.status !== 'analyzing' && (
                                                            <Box sx={{ p: 3, textAlign: 'center', bgcolor: 'rgba(34, 197, 94, 0.05)', borderRadius: 2, border: '1px solid rgba(34, 197, 94, 0.15)' }}>
                                                                <CheckCircleIcon sx={{ fontSize: 40, color: '#22c55e', mb: 1 }} />
                                                                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                                                                    No documentation gaps found
                                                                </Typography>
                                                                <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                                                                    Great docs! The selected issues don't reveal documentation problems.
                                                                </Typography>
                                                            </Box>
                                                        )}
                                                    </Box>
                                                )}
                                            </Box>
                                        </Box>
                                    )}
                                </>
                            ) : selectedMode === 'issue-discovery' ? (
                                <>
                                    <TextField
                                        fullWidth
                                        label="Company Domain (e.g. stripe.com)"
                                        variant="outlined"
                                        value={companyDomain}
                                        onChange={(e) => {
                                            setCompanyDomain(e.target.value);
                                            if (discoveredIssues.length > 0) {
                                                setDiscoveredIssues([]);
                                                setSelectedIssues([]);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === 'Tab') {
                                                if (companyDomain.trim().length > 3) {
                                                    searchForDeveloperIssues(companyDomain.trim());
                                                }
                                            }
                                        }}
                                        onBlur={() => {
                                            if (companyDomain.trim().length > 3) {
                                                searchForDeveloperIssues(companyDomain.trim());
                                            }
                                        }}
                                        placeholder="example.com or docs.example.com"
                                        disabled={analysisState.status === 'analyzing'}
                                        helperText="Domain to investigate"
                                    />

                                    {isSearchingIssues && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mb: 1 }}>
                                            <CircularProgress size={16} sx={{ mr: 1.5 }} />
                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                                                Searching for developer complaints online...
                                            </Typography>
                                        </Box>
                                    )}

                                    {discoveredIssues.length > 0 && (
                                        <Box sx={{ mt: 3, mb: 1 }}>
                                            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                                                Top Issues Found ({discoveredIssues.length}) — Select to analyze:
                                            </Typography>
                                            <Box sx={{ border: '1px solid', borderColor: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                                                {discoveredIssues.map((issue, index) => (
                                                    <Box
                                                        key={issue.id}
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            p: 1.5,
                                                            borderBottom: index < discoveredIssues.length - 1 ? '1px solid' : 'none',
                                                            borderBottomColor: 'var(--border-subtle)',
                                                            bgcolor: selectedIssues.includes(issue.id) ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                                                            '&:hover': {
                                                                bgcolor: 'var(--bg-card-dim)',
                                                            },
                                                            cursor: 'pointer',
                                                            transition: 'all 0.2s'
                                                        }}
                                                        onClick={() => {
                                                            if (selectedIssues.includes(issue.id)) {
                                                                setSelectedIssues(selectedIssues.filter(id => id !== issue.id));
                                                            } else {
                                                                setSelectedIssues([...selectedIssues, issue.id]);
                                                            }
                                                        }}
                                                    >
                                                        <Checkbox
                                                            checked={selectedIssues.includes(issue.id)}
                                                            disabled={analysisState.status === 'analyzing'}
                                                            size="small"
                                                            sx={{ mr: 1 }}
                                                        />
                                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                                                                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, fontSize: '0.875rem' }}>
                                                                    {issue.title}
                                                                </Typography>
                                                                <Chip
                                                                    label={`${issue.frequency}`}
                                                                    size="small"
                                                                    sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700 }}
                                                                />
                                                            </Box>
                                                            <Typography variant="caption" sx={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>
                                                                {issue.description}
                                                            </Typography>
                                                        </Box>
                                                    </Box>
                                                ))}
                                            </Box>
                                        </Box>
                                    )}
                                </>
                            ) : (
                                <TextField
                                    fullWidth
                                    variant="outlined"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && url.trim()) {
                                            e.preventDefault();
                                            handleAnalyze();
                                        }
                                    }}
                                    placeholder="Documentation Page URL"
                                    autoFocus
                                    disabled={analysisState.status === 'analyzing'}
                                    sx={{
                                        '& .MuiOutlinedInput-root': {
                                            borderRadius: '12px',
                                            bgcolor: 'var(--bg-secondary)',
                                            '& fieldset': {
                                                borderColor: 'var(--border-default)',
                                            },
                                            '&:hover fieldset': {
                                                borderColor: 'var(--border-strong)',
                                            },
                                            '&.Mui-focused fieldset': {
                                                borderColor: 'var(--border-strong)',
                                                borderWidth: '1px',
                                            },
                                        },
                                        '& .MuiInputBase-input': {
                                            fontSize: '1rem',
                                            py: 2,
                                        },
                                        '& .MuiInputBase-input::placeholder': {
                                            color: 'var(--text-muted)',
                                            opacity: 1,
                                        },
                                        '& .MuiInputBase-input.Mui-disabled': {
                                            WebkitTextFillColor: 'var(--text-primary)',
                                            opacity: 0.7,
                                        },
                                    }}
                                />
                            )}
                        </Box>

                        {selectedMode !== 'github-issues' && <Button
                            variant="contained"
                            onClick={handleAnalyze}
                            disabled={
                                (analysisState.status === 'analyzing' && analysisState.sourceMode !== 'github-issues') ||
                                isFetchingGithubIssues ||
                                usageRemaining === 0
                            }
                            sx={{
                                height: 56,
                                minWidth: 120,
                                px: 4,
                                width: { xs: '100%', sm: 'auto' },
                                whiteSpace: 'nowrap',
                                boxShadow: '0 0 20px rgba(59, 130, 246, 0.15)',
                                '&:hover': {
                                    boxShadow: '0 0 30px rgba(59, 130, 246, 0.25)',
                                }
                            }}
                        >
                            {(analysisState.status === 'analyzing' && analysisState.sourceMode !== 'github-issues') ? (
                                <><CircularProgress size={16} color="inherit" sx={{ mr: 1 }} /> Analyzing Readiness...</>
                            ) : analysisState.status === 'generating' ? (
                                'Generating...'
                            ) : analysisState.status === 'applying' ? (
                                'Applying...'
                            ) : (fixSuccessMessage || (!analysisState.report && currentSessionId)) ? (
                                'Re-scan'
                            ) : usageRemaining === 0 ? (
                                'Limit Reached'
                            ) : (
                                'Check Readiness'
                            )}
                        </Button>}
                    </Box>

                    {/* Advanced Options removed — all auto-detected in AI readiness pipeline */}

                    {/* AI Model Selection hidden per branding guidelines */}
                    <input type="hidden" name="selectedModel" value={selectedModel} />

                    {/* Waitlist CTA — shown when no audits remaining and not already rate-limited */}
                    {usageRemaining === 0 && (analysisState.status as string) !== 'rate-limited' && analysisState.status !== 'analyzing' && (
                        <Box sx={{
                            mt: 2,
                            py: 1.5,
                            px: 2,
                            borderRadius: '10px',
                            border: '1px solid rgba(99, 102, 241, 0.2)',
                            background: 'linear-gradient(to right, rgba(99, 102, 241, 0.05), transparent)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            flexWrap: 'wrap',
                        }}>
                            <AutoAwesomeIcon sx={{ color: '#6366f1', fontSize: 18, flexShrink: 0 }} />
                            <Typography sx={{
                                fontSize: '0.875rem',
                                color: 'var(--text-primary)',
                                fontWeight: 500,
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                flex: 1,
                                minWidth: 0,
                            }}>
                                Daily limit reached.{' '}
                                <Typography component="span" sx={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                                    Join our waitlist to unlock unlimited scans.
                                </Typography>
                            </Typography>
                            <a
                                href="/contact?waitlist"
                                style={{
                                    fontSize: '0.8125rem',
                                    fontWeight: 600,
                                    color: '#fff',
                                    background: 'var(--accent-primary, #6366f1)',
                                    borderRadius: '6px',
                                    padding: '0.375rem 0.875rem',
                                    textDecoration: 'none',
                                    fontFamily: 'var(--font-sans, var(--font-ui))',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                }}
                            >
                                Join Waitlist
                            </a>
                        </Box>
                    )}

                    {analysisState.status === 'error' && analysisState.sourceMode !== 'github-issues' && (() => {
                        const error = analysisState.error || '';
                        // Classify error into branded messaging
                        const errorConfig = error.includes('does not appear to be') || error.includes('not a documentation page') || error.includes('non-documentation-page')
                            ? {
                                title: "This page doesn't look like technical documentation",
                                description: 'Lensy is designed for developer docs, API references, SDK guides, and technical tutorials. Try entering a specific documentation page URL instead.',
                                showUrl: true,
                                actionLabel: 'Try another URL',
                                actionType: 'reset' as const,
                            }
                            : error.includes('unreachable') || error.includes('unable to access') || error.includes('unable to fetch')
                            ? {
                                title: 'This URL could not be reached',
                                description: 'Lensy was unable to fetch content from this page. This can happen if the URL is incorrect, the site is down, or it blocks automated access. Double-check the URL and try again.',
                                showUrl: true,
                                actionLabel: 'Try again',
                                actionType: 'reset' as const,
                            }
                            : error.includes('timed out') || error.includes('timeout')
                            ? {
                                title: 'Analysis timed out',
                                description: 'The analysis took longer than expected. This can happen with very large pages or slow-responding servers. You can try again — it often works on the second attempt.',
                                showUrl: false,
                                actionLabel: 'Retry',
                                actionType: 'retry' as const,
                            }
                            : error.includes('rate') || error.includes('throttl')
                            ? {
                                title: 'Too many requests',
                                description: 'Please wait a moment before running another analysis.',
                                showUrl: false,
                                actionLabel: 'Try again',
                                actionType: 'reset' as const,
                            }
                            : error.includes('Please enter') || error.includes('Please select') || error.includes('Invalid')
                            ? {
                                title: error,
                                description: '',
                                showUrl: false,
                                actionLabel: '',
                                actionType: 'none' as const,
                            }
                            : {
                                title: 'Something went wrong',
                                description: error || 'An unexpected error occurred during analysis. Please try again or reach out if the issue persists.',
                                showUrl: false,
                                actionLabel: 'Try again',
                                actionType: 'reset' as const,
                            };

                        // Validation errors — compact inline style
                        if (errorConfig.actionType === 'none') {
                            return (
                                <Box sx={{
                                    mt: 2, p: 1.5, borderRadius: '8px',
                                    border: '1px solid rgba(239,68,68,0.3)',
                                    background: 'rgba(239,68,68,0.05)',
                                }}>
                                    <Typography sx={{ fontSize: '0.875rem', color: 'rgb(239,68,68)', fontFamily: 'var(--font-sans, var(--font-ui))' }}>
                                        {errorConfig.title}
                                    </Typography>
                                </Box>
                            );
                        }

                        return (
                            <Box sx={{
                                mt: 3, p: 3, borderRadius: '12px',
                                border: '1px solid var(--border-default)',
                                background: 'var(--bg-secondary)', textAlign: 'center',
                            }}>
                                <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', mb: 1, fontFamily: 'var(--font-sans, var(--font-ui))' }}>
                                    {errorConfig.title}
                                </Typography>
                                {errorConfig.showUrl && (rejectedUrl || url) && (
                                    <Typography component="a" href={rejectedUrl || url} target="_blank" rel="noopener noreferrer" sx={{ display: 'block', fontSize: '0.8rem', color: 'var(--accent-primary)', mb: 1.5, fontFamily: 'var(--font-mono)', wordBreak: 'break-all', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                        {rejectedUrl || url}
                                    </Typography>
                                )}
                                {errorConfig.description && (
                                    <Typography sx={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans, var(--font-ui))', lineHeight: 1.6, mb: errorConfig.actionLabel ? 2.5 : 0 }}>
                                        {errorConfig.description}
                                    </Typography>
                                )}
                                {errorConfig.actionLabel && (
                                    <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                                        <button
                                            onClick={() => {
                                                trackEvent('try_another_url_clicked', { action: errorConfig.actionType, error: errorConfig.title });
                                                if (errorConfig.actionType === 'retry') {
                                                    handleAnalyze();
                                                } else {
                                                    setAnalysisState({ status: 'idle', progressMessages: [] });
                                                    setRejectedUrl(null);
                                                    setUrl('');
                                                    setCurrentSessionId(null);
                                                    setTimeout(() => { document.querySelector<HTMLInputElement>('input[placeholder*="URL"]')?.focus(); }, 100);
                                                }
                                            }}
                                            style={{
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                color: '#fff',
                                                background: 'var(--accent-primary, #6366f1)',
                                                border: 'none',
                                                borderRadius: '8px',
                                                padding: '0.625rem 1.5rem',
                                                cursor: 'pointer',
                                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                            }}
                                        >
                                            {errorConfig.actionLabel}
                                        </button>
                                        <a
                                            href="/contact?ref=feedback"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                color: 'var(--text-secondary)',
                                                background: 'var(--bg-tertiary)',
                                                border: '1px solid var(--border-default)',
                                                borderRadius: '8px',
                                                padding: '0.625rem 1.5rem',
                                                textDecoration: 'none',
                                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                            }}
                                        >
                                            Report an issue
                                        </a>
                                    </Box>
                                )}
                            </Box>
                        );
                    })()}

                    {(analysisState.status as string) === 'rate-limited' && (
                        <Box sx={{
                            mt: 3,
                            p: 3,
                            borderRadius: '12px',
                            border: '1px solid rgba(239,68,68,0.2)',
                            background: 'var(--bg-secondary)',
                            textAlign: 'center',
                        }}>
                            <Typography sx={{
                                fontSize: '1.25rem',
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                                mb: 0.5,
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                            }}>
                                You've used all your free audits for today
                            </Typography>
                            <Typography sx={{
                                fontSize: '0.9375rem',
                                color: 'var(--text-secondary)',
                                mb: 2.5,
                                fontFamily: 'var(--font-sans, var(--font-ui))',
                                lineHeight: 1.6,
                            }}>
                                Free tier includes 3 audits per day. Want more? Join the waitlist for early access to higher limits.
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                                <a
                                    href="/contact?waitlist"
                                    style={{
                                        display: 'inline-block',
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: '#fff',
                                        background: 'var(--accent-primary, #6366f1)',
                                        border: 'none',
                                        borderRadius: '8px',
                                        padding: '0.625rem 1.5rem',
                                        textDecoration: 'none',
                                        fontFamily: 'var(--font-sans, var(--font-ui))',
                                    }}
                                >
                                    Join Waitlist
                                </a>
                                <button
                                    onClick={() => setAnalysisState({ status: 'idle', progressMessages: [] })}
                                    style={{
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: 'var(--text-secondary)',
                                        background: 'var(--bg-tertiary)',
                                        border: '1px solid var(--border-default)',
                                        borderRadius: '8px',
                                        padding: '0.625rem 1.5rem',
                                        cursor: 'pointer',
                                        fontFamily: 'var(--font-sans, var(--font-ui))',
                                    }}
                                >
                                    Come back tomorrow
                                </button>
                            </Box>
                        </Box>
                    )}
                </Paper>

                {/* Progress Messages — only visible while actively analyzing, hidden on all error states */}
                {analysisState.status === 'analyzing' && analysisState.progressMessages.length > 0 && selectedMode !== 'github-issues' && analysisState.sourceMode !== 'github-issues' && (
                    <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                            <Typography variant="h6">
                                Analysis Progress ({analysisState.progressMessages.length})
                            </Typography>
                            <IconButton
                                onClick={() => setProgressExpanded(!progressExpanded)}
                                size="small"
                            >
                                {progressExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </IconButton>
                        </Box>

                        <Collapse in={progressExpanded}>
                            <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                                <List>
                                    {analysisState.progressMessages.map((msg, index) => (
                                        <ListItem key={index} sx={{ py: 0.5 }}>
                                            <ListItemIcon sx={{ minWidth: 40 }}>
                                                {getProgressIcon(msg.type)}
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={msg.message}
                                                secondary={new Date(msg.timestamp).toLocaleTimeString()}
                                                primaryTypographyProps={{
                                                    sx: {
                                                        color: msg.type === 'error' ? '#dc2626' : 'var(--text-primary)'
                                                    }
                                                }}
                                                secondaryTypographyProps={{
                                                    sx: { color: 'var(--text-muted)' }
                                                }}
                                            />
                                        </ListItem>
                                    ))}
                                    <div ref={progressEndRef} />
                                </List>
                            </Box>
                        </Collapse>
                    </Paper>
                )}

                {/* Fix Success Message (Standalone) */}
                {fixSuccessMessage && (
                    <Alert
                        severity="success"
                        variant="standard"
                        sx={{ mb: 4, '& .MuiAlert-message': { width: '100%' } }}
                        icon={<CheckCircleIcon fontSize="inherit" />}
                    >
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                            Fixes Applied Successfully
                        </Typography>
                        <Typography variant="body2">
                            {fixSuccessMessage}
                        </Typography>
                        {lastModifiedFile && (
                            <Box sx={{ mt: 2 }}>
                                <Button
                                    variant="outlined"
                                    color="success"
                                    size="small"
                                    endIcon={<OpenInNewIcon />}
                                    href={`https://d9gphnvbmrso2.cloudfront.net/${lastModifiedFile.replace(/\.md$/, '.html')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    View as HTML
                                </Button>
                            </Box>
                        )}
                    </Alert>
                )}

                {/* Results */}
                {analysisState.status === 'completed' && validationResults && (
                    <Paper elevation={3} sx={{ p: 4, mb: 3 }}>
                        <Typography variant="h5" gutterBottom>
                            Issue Validation Results
                        </Typography>

                        {/* Summary Cards */}
                        <Grid container spacing={3} sx={{ mb: 4 }}>
                            <Grid item xs={12} md={3}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" sx={{ color: 'var(--accent-success)' }}>
                                            {validationResults.summary.resolved}
                                        </Typography>
                                        <Typography variant="h6">✅ Resolved</Typography>
                                        <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                                            Documentation is complete
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" sx={{ color: 'var(--accent-warning)' }}>
                                            {validationResults.summary.potentialGaps}
                                        </Typography>
                                        <Typography variant="h6">⚠️ Potential Gaps</Typography>
                                        <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                                            Pages exist but incomplete
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" sx={{ color: 'var(--accent-error)' }}>
                                            {validationResults.summary.criticalGaps}
                                        </Typography>
                                        <Typography variant="h6">❌ Critical Gaps</Typography>
                                        <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                                            No relevant pages found
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" sx={{ color: 'var(--accent-primary)' }}>
                                            {validationResults.processingTime}ms
                                        </Typography>
                                        <Typography variant="h6">Processing Time</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                        </Grid>

                        {/* Sitemap Health Summary (if available) */}
                        {validationResults.sitemapHealth && (
                            <>
                                <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
                                    📊 Sitemap Health Analysis
                                </Typography>
                                <Grid container spacing={3} sx={{ mb: 4 }}>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" sx={{ color: 'var(--accent-primary)' }}>
                                                    {validationResults.sitemapHealth.totalUrls}
                                                </Typography>
                                                <Typography variant="h6">Total URLs</Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" sx={{ color: 'var(--accent-success)' }}>
                                                    {validationResults.sitemapHealth.healthyUrls}
                                                </Typography>
                                                <Typography variant="h6">Healthy</Typography>
                                                <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                                                    {validationResults.sitemapHealth.healthPercentage}%
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" sx={{ color: 'var(--accent-error)' }}>
                                                    {validationResults.sitemapHealth.brokenUrls || 0}
                                                </Typography>
                                                <Typography variant="h6">Broken (404)</Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" sx={{ color: 'var(--accent-warning)' }}>
                                                    {(validationResults.sitemapHealth.accessDeniedUrls || 0) +
                                                        (validationResults.sitemapHealth.timeoutUrls || 0) +
                                                        (validationResults.sitemapHealth.otherErrorUrls || 0)}
                                                </Typography>
                                                <Typography variant="h6">Other Issues</Typography>
                                                <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                                                    {validationResults.sitemapHealth.accessDeniedUrls || 0} access denied, {' '}
                                                    {validationResults.sitemapHealth.timeoutUrls || 0} timeout, {' '}
                                                    {validationResults.sitemapHealth.otherErrorUrls || 0} errors
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                </Grid>

                                {/* Expandable Broken URLs List */}
                                {validationResults.sitemapHealth.linkIssues.length > 0 && (
                                    <Card sx={{ mb: 4 }}>
                                        <CardContent>
                                            <Typography variant="h6" gutterBottom>
                                                🔗 Link Issues Details ({validationResults.sitemapHealth.linkIssues.length})
                                            </Typography>
                                            <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                                                {validationResults.sitemapHealth.linkIssues.map((issue: any, index: number) => (
                                                    <Box key={index} sx={{ mb: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                                            {issue.issueType === '404' ? '🔴' :
                                                                issue.issueType === 'access-denied' ? '🟡' :
                                                                    issue.issueType === 'timeout' ? '🟠' : '⚫'} {issue.url}
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                                                            {issue.errorMessage}
                                                        </Typography>
                                                    </Box>
                                                ))}
                                            </Box>
                                        </CardContent>
                                    </Card>
                                )}
                            </>
                        )}

                        {/* Detailed Results */}
                        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
                            Detailed Validation Results
                        </Typography>
                        {validationResults.validationResults.map((result: any, index: number) => (
                            <Card key={result.issueId} sx={{ mb: 2 }}>
                                <CardContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                        <Chip
                                            label={result.status.toUpperCase()}
                                            color={
                                                result.status === 'resolved' ? 'success' :
                                                    result.status === 'confirmed' ? 'info' :
                                                        result.status === 'potential-gap' ? 'warning' :
                                                            result.status === 'critical-gap' ? 'error' : 'default'
                                            }
                                            sx={{ mr: 2 }}
                                        />
                                        <Typography variant="h6" sx={{ flex: 1 }}>
                                            {result.issueTitle}
                                        </Typography>
                                        <Chip
                                            label={`${result.confidence}%`}
                                            size="small"
                                            sx={{
                                                fontWeight: 700,
                                                fontSize: '0.7rem',
                                                bgcolor: (result.confidence || 0) >= 80 ? 'rgba(34, 197, 94, 0.12)' : (result.confidence || 0) >= 60 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(107, 114, 128, 0.10)',
                                                color: (result.confidence || 0) >= 80 ? '#22c55e' : (result.confidence || 0) >= 60 ? '#f59e0b' : '#737373',
                                                border: '1px solid',
                                                borderColor: (result.confidence || 0) >= 80 ? 'rgba(34, 197, 94, 0.25)' : (result.confidence || 0) >= 60 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(107, 114, 128, 0.20)',
                                            }}
                                        />
                                    </Box>

                                    {/* Evidence */}
                                    {result.evidence && result.evidence.length > 0 && (
                                        <Box sx={{ mt: 2 }}>
                                            <Typography variant="subtitle2" gutterBottom>
                                                📄 Evidence ({result.evidence.length} pages analyzed):
                                            </Typography>
                                            {result.evidence.map((evidence: any, idx: number) => (
                                                <Box key={idx} sx={{ ml: 2, mb: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <Typography variant="body2">
                                                            <strong>{evidence.pageUrl}</strong> - {evidence.pageTitle}
                                                        </Typography>
                                                        {evidence.semanticScore !== undefined && (
                                                            <Chip
                                                                label={`${(evidence.semanticScore * 100).toFixed(0)}% match`}
                                                                size="small"
                                                                color={evidence.semanticScore > 0.7 ? 'success' : evidence.semanticScore > 0.5 ? 'warning' : 'default'}
                                                                sx={{ ml: 1 }}
                                                            />
                                                        )}
                                                    </Box>
                                                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                                                        {evidence.codeExamples} code examples •
                                                        {evidence.productionGuidance ? ' Production guidance ✓' : ' No production guidance'}
                                                        {evidence.contentGaps.length > 0 && ` • Missing: ${evidence.contentGaps.join(', ')}`}
                                                    </Typography>
                                                </Box>
                                            ))}
                                        </Box>
                                    )}

                                    {/* Recommendations for Best Match */}
                                    {result.recommendations && result.recommendations.length > 0 && (
                                        <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                                            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold', mb: 2 }}>
                                                💡 Gap Recommendations for Best Match:
                                            </Typography>
                                            {result.recommendations.map((rec: string, idx: number) => (
                                                <Box key={idx} sx={{ mb: 3, pb: 2, borderBottom: idx < result.recommendations.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
                                                    <ReactMarkdown
                                                        components={{
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
                                                        }}
                                                    >
                                                        {rec}
                                                    </ReactMarkdown>
                                                </Box>
                                            ))}
                                        </Box>
                                    )}

                                    {/* Potential Gaps */}
                                    {result.potentialGaps && result.potentialGaps.length > 0 && (
                                        <Box sx={{ mt: 2 }}>
                                            <Typography variant="subtitle2" gutterBottom sx={{ color: 'var(--accent-warning)' }}>
                                                ⚠️ Potential Gaps:
                                            </Typography>
                                            {result.potentialGaps.map((gap: any, idx: number) => (
                                                <Box key={idx} sx={{ ml: 2, mb: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                                    <Typography variant="body2">
                                                        <strong>{gap.pageUrl}</strong>
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                                                        {gap.reasoning}
                                                    </Typography>
                                                </Box>
                                            ))}
                                        </Box>
                                    )}
                                </CardContent>
                            </Card>
                        ))}

                        {/* Export Button for Validation Results */}
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() => exportValidationReport(validationResults)}
                                sx={{ minWidth: 200 }}
                            >
                                📄 Export Report (Markdown)
                            </Button>
                        </Box>
                    </Paper>
                )}

                {/* ══════════════════════════════════════════════════════════
                    ASYNC CARD LOADING — Shows cards as data arrives via WebSocket
                    Even before the full report is complete
                   ══════════════════════════════════════════════════════════ */}
                {(analysisState.status === 'analyzing' || analysisState.status === 'completed') && selectedMode !== 'github-issues' && selectedMode !== 'issue-discovery' && (
                    <Paper elevation={3} sx={{ p: 4, mb: 4 }}>
                        <Typography variant="h5" gutterBottom sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
                            AI Readiness Results
                        </Typography>

                        {/* ── Content Health Check Counter ── */}
                        {(() => {
                            let chPassed = 0, chTotal = 0;
                            if (asyncCards.discoverability) {
                                const d = asyncCards.discoverability;
                                const checks = [d.llmsTxt.found, d.llmsFullTxt.found, d.sitemapXml.found, d.canonical.found, !d.metaRobots.blocksIndexing];
                                chTotal += checks.length; chPassed += checks.filter(Boolean).length;
                            }
                            if (asyncCards.consumability) {
                                const c = asyncCards.consumability;
                                const checks = [c.textToHtmlRatio.status === 'good', !c.jsRendered, c.headingHierarchy.h1Count === 1, c.markdownAvailable.found, !c.codeBlocks.hasCode || c.codeBlocks.withLanguageHints > 0, c.internalLinkDensity.status === 'good'];
                                chTotal += checks.length; chPassed += checks.filter(Boolean).length;
                            }
                            if (asyncCards.structuredData) {
                                const s = asyncCards.structuredData;
                                const checks = [s.jsonLd.found, s.schemaCompleteness.status !== 'missing', s.openGraphCompleteness.score !== 'missing', s.breadcrumbs.found];
                                chTotal += checks.length; chPassed += checks.filter(Boolean).length;
                            }
                            const chHasData = !!(asyncCards.discoverability || asyncCards.consumability || asyncCards.structuredData);

                            // Recommendations helpers
                            const recs = analysisState.report?.recommendations || [];
                            const quickWins = recs.filter((r: any) => r.priority === 'high');
                            const deeperImprovements = recs.filter((r: any) => r.priority !== 'high');
                            const topRecs = [...quickWins, ...deeperImprovements].slice(0, 3);
                            const getImpactLabel = (rec: any) => rec.priority === 'high' ? 'High impact' : rec.priority === 'medium' ? 'Medium impact' : 'Low impact';
                            const getEffortLabel = (rec: any) => rec.codeSnippet ? 'Medium effort' : 'Low effort';

                            const getLetterGrade = (score: number): string => {
                                if (score >= 95) return 'A+';
                                if (score >= 90) return 'A';
                                if (score >= 85) return 'B+';
                                if (score >= 75) return 'B';
                                if (score >= 60) return 'C';
                                if (score >= 40) return 'D';
                                return 'F';
                            };

                            const getGradeLabel = (score: number, recCount: number): string => {
                                if (recCount === 0) return 'Great \u2014 no issues found';
                                if (score >= 90) return `Great \u2014 ${recCount} minor improvement${recCount > 1 ? 's' : ''}`;
                                if (score >= 75) return `Good \u2014 ${recCount} opportunit${recCount > 1 ? 'ies' : 'y'} to improve`;
                                if (score >= 60) return `Fair \u2014 ${recCount} thing${recCount > 1 ? 's' : ''} to fix`;
                                return `Needs work \u2014 ${recCount} issue${recCount > 1 ? 's' : ''} found`;
                            };

                            // AI Discoverability helpers for card
                            const aiDisc = asyncCards.aiDiscoverability;
                            const aiTotalQueries = aiDisc?.queries.length || 0;
                            const aiPerplexityFound = aiDisc?.engines.perplexity?.results?.filter(r => r.cited).length || 0;
                            const aiBestFound = aiPerplexityFound;
                            const aiHasEngines = aiDisc?.engines.perplexity?.available;

                            const renderRec = (rec: any, i: number) => (
                                <Box key={i} sx={{
                                    mb: 2, p: 2, borderRadius: 1,
                                    borderLeft: '3px solid var(--text-primary)',
                                    bgcolor: 'var(--bg-tertiary)',
                                }}>
                                    <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5, color: 'var(--text-primary)' }}>{rec.issue}</Typography>
                                    <Box sx={{ display: 'flex', gap: 0.75, mb: 1, flexWrap: 'wrap' }}>
                                        <Chip label={getImpactLabel(rec)} size="small" sx={{
                                            height: 20, fontSize: '0.65rem', fontWeight: 600,
                                            bgcolor: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                                            border: '1px solid var(--border-default)',
                                        }} />
                                        <Chip label={getEffortLabel(rec)} size="small" sx={{
                                            height: 20, fontSize: '0.65rem', fontWeight: 600,
                                            bgcolor: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)',
                                        }} />
                                        <Chip label={rec.category} size="small" sx={{
                                            height: 20, fontSize: '0.6rem', fontWeight: 600,
                                            bgcolor: 'rgba(59,130,246,0.12)', color: 'var(--accent-hover)', border: '1px solid rgba(59,130,246,0.2)',
                                        }} />
                                    </Box>
                                    <Typography variant="body2" sx={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5 }}>{rec.fix}</Typography>
                                    {rec.issue?.toLowerCase().includes('llms.txt') && (
                                        <Typography variant="caption" component="a" href="/contact?ref=llmstxt" target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-block', mt: 0.5, fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-primary)', textDecoration: 'underline', '&:hover': { opacity: 0.8 } }}>
                                            We can help you generate one →
                                        </Typography>
                                    )}
                                    {rec.issue?.toLowerCase().includes('markdown') && !rec.issue?.toLowerCase().includes('llms.txt') && (
                                        <Typography variant="caption" component="a" href="/contact?ref=markdown" target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-block', mt: 0.5, fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-primary)', textDecoration: 'underline', '&:hover': { opacity: 0.8 } }}>
                                            We can help you generate markdown →
                                        </Typography>
                                    )}
                                    {rec.codeSnippet && (
                                        <Box sx={{ mt: 1.5, p: 1.5, bgcolor: 'var(--bg-code-block)', color: 'var(--text-code-block)', borderRadius: 1, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'pre-wrap', overflowX: 'auto', border: '1px solid var(--border-subtle)' }}>
                                            {rec.codeSnippet}
                                        </Box>
                                    )}
                                </Box>
                            );

                            return (
                                <>
                                    {/* ═══ HERO BOXES: AI Readiness (left) + AI Citations (right) ═══ */}
                                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2, mb: 2 }}>
                                        {/* ── Left Hero: AI Readiness ── */}
                                        <Card
                                            onClick={() => setHeroTab('readiness')}
                                            sx={{
                                                cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                height: { xs: 'auto', md: 150 },
                                                border: (heroTab === 'readiness' || heroTab === 'recommendations') ? '2px solid var(--accent-primary)' : '1px solid var(--border-default)',
                                                boxShadow: (heroTab === 'readiness' || heroTab === 'recommendations') ? '0 0 0 1px var(--accent-primary), 0 4px 12px rgba(59,130,246,0.15)' : 'none',
                                                '&:hover': {
                                                    borderColor: (heroTab === 'readiness' || heroTab === 'recommendations') ? 'var(--accent-primary)' : 'var(--border-strong)',
                                                    transform: 'translateY(-2px)',
                                                    boxShadow: (heroTab === 'readiness' || heroTab === 'recommendations') ? '0 0 0 1px var(--accent-primary), 0 8px 24px rgba(59,130,246,0.2)' : '0 8px 24px rgba(0,0,0,0.1)',
                                                },
                                            }}
                                        >
                                            <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', py: 3, px: 3, '&:last-child': { pb: 3 } }}>
                                                {asyncCards.overallScore ? (
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                        <Typography sx={{ fontSize: '3rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                                                            {getLetterGrade(asyncCards.overallScore.overallScore)}
                                                        </Typography>
                                                        <Box>
                                                            <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.1rem', lineHeight: 1.2 }}>
                                                                AI Readiness
                                                            </Typography>
                                                            <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontSize: '0.85rem', mt: 0.25 }}>
                                                                {asyncCards.overallScore.overallScore}/100
                                                            </Typography>
                                                            <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'block', mt: 0.5 }}>
                                                                {getGradeLabel(asyncCards.overallScore.overallScore, recs.length)}
                                                            </Typography>
                                                        </Box>
                                                    </Box>
                                                ) : (
                                                    <Box sx={{ textAlign: 'center' }}>
                                                        <CircularProgress size={32} sx={{ opacity: 0.3, mb: 1 }} />
                                                        <Typography variant="body2" sx={{
                                                            color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 500,
                                                            '@keyframes pulse': { '0%, 100%': { opacity: 0.4 }, '50%': { opacity: 1 } },
                                                            animation: 'pulse 1.5s ease-in-out infinite',
                                                        }}>
                                                            Calculating score...
                                                        </Typography>
                                                    </Box>
                                                )}
                                            </CardContent>
                                        </Card>

                                        {/* ── Right Hero: AI Citations (disabled until readiness completes) ── */}
                                        {(() => {
                                            const citationsReady = analysisState.status === 'completed' || !!asyncCards.overallScore;
                                            const citationsDisabled = !citationsReady && !aiDisc;
                                            return (
                                                <Card
                                                    onClick={() => {
                                                        if (citationsDisabled) return;
                                                        setHeroTab('citations');
                                                        // Auto-trigger citation check on first click
                                                        if (!aiDisc && !citationsLoading) handleRunCitations();
                                                    }}
                                                    sx={{
                                                        cursor: citationsDisabled ? 'not-allowed' : 'pointer',
                                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                        height: { xs: 'auto', md: 150 },
                                                        opacity: citationsDisabled ? 0.5 : 1,
                                                        border: heroTab === 'citations' ? '2px solid var(--accent-primary)' : '1px solid var(--border-default)',
                                                        boxShadow: heroTab === 'citations' ? '0 0 0 1px var(--accent-primary), 0 4px 12px rgba(59,130,246,0.15)' : 'none',
                                                        '&:hover': citationsDisabled ? {} : {
                                                            borderColor: heroTab === 'citations' ? 'var(--accent-primary)' : 'var(--border-strong)',
                                                            transform: 'translateY(-2px)',
                                                            boxShadow: heroTab === 'citations' ? '0 0 0 1px var(--accent-primary), 0 8px 24px rgba(59,130,246,0.2)' : '0 8px 24px rgba(0,0,0,0.1)',
                                                        },
                                                    }}
                                                >
                                                    <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', py: 3, px: 3, '&:last-child': { pb: 3 } }}>
                                                        {aiDisc ? (
                                                            /* ── Citations complete: show score ── */
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                                <Typography sx={{ fontSize: '3rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                                                                    {aiBestFound}/{aiTotalQueries}
                                                                </Typography>
                                                                <Box>
                                                                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.1rem', lineHeight: 1.2 }}>
                                                                        AI Citations
                                                                    </Typography>
                                                                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'block', mt: 0.5 }}>
                                                                        Cited in {aiBestFound} of {aiTotalQueries} synthetic queries
                                                                    </Typography>
                                                                </Box>
                                                            </Box>
                                                        ) : citationsLoading ? (
                                                            /* ── Citations running: show spinner ── */
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                                                                <CircularProgress size={40} thickness={3} sx={{ color: 'var(--accent-primary)' }} />
                                                                <Box>
                                                                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem', lineHeight: 1.2 }}>
                                                                        AI Citations
                                                                    </Typography>
                                                                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'block', mt: 0.5 }}>
                                                                        Testing synthetic queries...
                                                                    </Typography>
                                                                </Box>
                                                            </Box>
                                                        ) : (
                                                            /* ── Citations idle: show play icon ── */
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                                                                <Box sx={{
                                                                    width: 44, height: 44, borderRadius: '50%',
                                                                    border: `2px solid ${citationsDisabled ? 'var(--border-default)' : 'var(--accent-primary)'}`,
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    opacity: citationsDisabled ? 0.4 : 1,
                                                                    transition: 'all 0.2s',
                                                                }}>
                                                                    <Typography sx={{ fontSize: '1.2rem', lineHeight: 1, ml: '3px', color: citationsDisabled ? 'var(--text-muted)' : 'var(--accent-primary)' }}>&#9654;</Typography>
                                                                </Box>
                                                                <Box>
                                                                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem', lineHeight: 1.2 }}>
                                                                        AI Citations
                                                                    </Typography>
                                                                    <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block', mt: 0.5 }}>
                                                                        {citationsDisabled ? 'Available after readiness check' : 'Run citation check'}
                                                                    </Typography>
                                                                </Box>
                                                            </Box>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            );
                                        })()}
                                    </Box>

                                    {/* ── Doc Confidence + View Recommendations (between hero and detail) ── */}
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                                        {asyncCards.overallScore?.docConfidence ? (() => {
                                            const conf = asyncCards.overallScore.docConfidence;
                                            const pct = Math.round(conf.score * 100);
                                            const label = pct >= 80 ? 'Likely a doc page' : pct >= 60 ? 'May be a doc page' : 'Might not be a doc page';
                                            return (
                                                <>
                                                    <Tooltip title="How confident we are that this is a documentation page vs. a marketing page, blog, or homepage" arrow enterTouchDelay={0} leaveTouchDelay={3000}>
                                                        <Chip label={`${label} (${pct}%)`} size="small" sx={{
                                                            fontWeight: 600, fontSize: '0.7rem', height: 22,
                                                            bgcolor: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                                                            border: '1px solid var(--border-default)', cursor: 'help',
                                                        }} />
                                                    </Tooltip>
                                                    <Tooltip title={<Box component="ul" sx={{ m: 0, pl: 2, py: 0.5, listStyle: 'disc' }}>{conf.signals.map((s: string, i: number) => <li key={i} style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>{s}</li>)}</Box>} arrow enterTouchDelay={0} leaveTouchDelay={3000}>
                                                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', cursor: 'help', textDecoration: 'underline dotted', fontSize: '0.7rem' }}>
                                                            {conf.signals.length} signal{conf.signals.length !== 1 ? 's' : ''}
                                                        </Typography>
                                                    </Tooltip>
                                                </>
                                            );
                                        })() : null}
                                        {recs.length > 0 && (
                                            <>
                                                <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>·</Typography>
                                                <Typography
                                                    variant="caption"
                                                    onClick={() => { const next = heroTab === 'recommendations' ? 'readiness' : 'recommendations'; if (next === 'recommendations') trackEvent('recommendations_viewed'); setHeroTab(next); }}
                                                    sx={{
                                                        color: 'var(--accent-primary)',
                                                        cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem',
                                                        '&:hover': { textDecoration: 'underline' },
                                                    }}
                                                >
                                                    {heroTab === 'recommendations' ? '← Back to details' : `View all ${recs.length} recommendations →`}
                                                </Typography>
                                            </>
                                        )}
                                    </Box>

                                    {/* ═══ DETAIL AREA: Tab-driven content ═══ */}
                                    <Box sx={{ mb: 3, mt: 1 }}>
                                        {/* ── Readiness Tab: 2x2 Grid ── */}
                                        {heroTab === 'readiness' && (
                                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
                                                {/* ── Cell 1: Bot Access (condensed) ── */}
                                                <Box sx={{ p: 2, border: '1px solid var(--border-default)', borderRadius: 2, bgcolor: 'var(--bg-secondary)' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
                                                            Bot Access
                                                        </Typography>
                                                        {asyncCards.overallScore && (
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                                                    {asyncCards.botAccess ? `${asyncCards.botAccess.allowedCount}/${asyncCards.botAccess.bots.length}` : `${asyncCards.overallScore.scoreBreakdown.botAccess}/15`}
                                                                </Typography>
                                                                {(asyncCards.botAccess ? asyncCards.botAccess.blockedCount === 0 : asyncCards.overallScore.scoreBreakdown.botAccess >= 13) ? <CheckCircleIcon sx={{ color: 'var(--text-muted)', fontSize: 16 }} /> : <WarningIcon sx={{ color: 'var(--text-muted)', fontSize: 16 }} />}
                                                            </Box>
                                                        )}
                                                    </Box>
                                                    {asyncCards.botAccess ? (
                                                        <>
                                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                                            {asyncCards.botAccess.bots.map((bot, i) => {
                                                                const isAllowed = bot.status === 'allowed' || bot.status === 'not-mentioned';
                                                                return (
                                                                    <Tooltip key={i} title={`${bot.name} (${bot.userAgent}) — ${isAllowed ? 'Allowed' : 'Blocked'}`} arrow placement="top" enterTouchDelay={0} leaveTouchDelay={3000}>
                                                                        <Chip
                                                                            icon={isAllowed ? <CheckCircleIcon sx={{ fontSize: '14px !important' }} /> : <ErrorIcon sx={{ fontSize: '14px !important' }} />}
                                                                            label={bot.name.replace(/\s*\(.*\)/, '')}
                                                                            size="small"
                                                                            sx={{
                                                                                height: 24, fontSize: '0.65rem', fontWeight: 600, cursor: 'help',
                                                                                bgcolor: isAllowed ? 'var(--bg-tertiary)' : 'rgba(239,68,68,0.08)',
                                                                                color: isAllowed ? 'var(--text-secondary)' : '#ef4444',
                                                                                border: `1px solid ${isAllowed ? 'var(--border-default)' : 'rgba(239,68,68,0.2)'}`,
                                                                                '& .MuiChip-icon': { color: isAllowed ? 'var(--text-muted)' : '#ef4444' },
                                                                            }}
                                                                        />
                                                                    </Tooltip>
                                                                );
                                                            })}
                                                        </Box>
                                                        {/* Source link to robots.txt */}
                                                        {(() => {
                                                            try {
                                                                const parsedUrl = new URL(url || (analysisState.report as any)?.url || '');
                                                                const robotsUrl = `${parsedUrl.origin}/robots.txt`;
                                                                return (
                                                                    <Typography variant="caption" sx={{ mt: 1, display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                                                        Source: <a href={robotsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
                                                                            robots.txt
                                                                        </a>
                                                                        {asyncCards.botAccess && !asyncCards.botAccess.robotsTxtFound && (
                                                                            <span> (not found — bots allowed by default)</span>
                                                                        )}
                                                                    </Typography>
                                                                );
                                                            } catch (e) { return null; }
                                                        })()}
                                                        </>
                                                    ) : (
                                                        <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={20} sx={{ opacity: 0.3 }} /></Box>
                                                    )}
                                                </Box>

                                                {/* ── Cell 2: Structured Data ── */}
                                                <Box sx={{ p: 2, border: '1px solid var(--border-default)', borderRadius: 2, bgcolor: 'var(--bg-secondary)' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
                                                            Structured Data
                                                        </Typography>
                                                        {asyncCards.overallScore && (
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                                                    {asyncCards.overallScore.scoreBreakdown.structuredData}/20
                                                                </Typography>
                                                                {asyncCards.overallScore.scoreBreakdown.structuredData >= 16 ? <CheckCircleIcon sx={{ color: 'var(--text-muted)', fontSize: 16 }} /> : <WarningIcon sx={{ color: 'var(--text-muted)', fontSize: 16 }} />}
                                                            </Box>
                                                        )}
                                                    </Box>
                                                    {asyncCards.structuredData ? (() => {
                                                        const s = asyncCards.structuredData!;
                                                        const items = [
                                                            { label: 'JSON-LD', pass: s.jsonLd.found || s.schemaCompleteness.status !== 'missing', detail: s.jsonLd.found ? `Found ${s.jsonLd.types.join(', ')} markup${s.schemaCompleteness.status === 'complete' ? '. Schema is complete.' : '.'}` : 'Not found. JSON-LD tells AI exactly what type of content this is.', info: 'Gives AI explicit type signals so it can accurately categorize your page.', pts: 7 },
                                                            { label: 'Schema Completeness', pass: s.schemaCompleteness.status === 'complete', detail: s.schemaCompleteness.status === 'complete' ? 'Schema is complete.' : 'Schema is incomplete or missing.', info: 'Complete schemas help AI understand your content structure.', pts: 4 },
                                                            { label: 'OpenGraph', pass: s.openGraphCompleteness.score !== 'missing', detail: s.openGraphCompleteness.score === 'complete' ? 'All required tags present.' : s.openGraphCompleteness.score === 'partial' ? `Missing ${s.openGraphCompleteness.missingTags.slice(0, 2).join(', ')}.` : 'Not found.', info: 'Controls the preview card when your link is shared on social channels.', pts: 5 },
                                                            { label: 'Breadcrumbs', pass: s.breadcrumbs.found, detail: s.breadcrumbs.found ? 'BreadcrumbList schema found.' : 'No BreadcrumbList schema found.', info: 'BreadcrumbList schema tells AI where this page sits in your site hierarchy.', pts: 4 },
                                                        ];
                                                        return items.map((item, i) => (
                                                            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                                                                {item.pass ? <CheckCircleIcon sx={{ color: 'var(--text-muted)', fontSize: 16, mt: 0.2 }} /> : <ErrorIcon sx={{ color: 'var(--text-muted)', fontSize: 16, mt: 0.2 }} />}
                                                                <Box sx={{ flex: 1 }}>
                                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.3, color: 'var(--text-primary)' }}>{item.label}</Typography>
                                                                        {!item.pass && <Typography component="span" sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--accent-primary)' }}>+{item.pts} pts</Typography>}
                                                                        <Tooltip title={item.info} arrow placement="top" enterTouchDelay={0} leaveTouchDelay={3000}>
                                                                            <InfoIcon sx={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'help', opacity: 0.5, '&:hover': { opacity: 1 } }} />
                                                                        </Tooltip>
                                                                    </Box>
                                                                    <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.2, wordBreak: 'break-word' }}>{item.detail}</Typography>
                                                                </Box>
                                                            </Box>
                                                        ));
                                                    })() : <CircularProgress size={20} sx={{ opacity: 0.3 }} />}
                                                </Box>

                                                {/* ── Cell 3: Discoverability ── */}
                                                <Box sx={{ p: 2, border: '1px solid var(--border-default)', borderRadius: 2, bgcolor: 'var(--bg-secondary)' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
                                                            Discoverability
                                                        </Typography>
                                                        {asyncCards.overallScore && (
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                                                    {asyncCards.overallScore.scoreBreakdown.discoverability}/20
                                                                </Typography>
                                                                {asyncCards.overallScore.scoreBreakdown.discoverability >= 16 ? <CheckCircleIcon sx={{ color: 'var(--text-muted)', fontSize: 16 }} /> : <WarningIcon sx={{ color: 'var(--text-muted)', fontSize: 16 }} />}
                                                            </Box>
                                                        )}
                                                    </Box>
                                                    {asyncCards.discoverability ? (() => {
                                                        const d = asyncCards.discoverability!;
                                                        const items: Array<{ label: string; status: 'pass' | 'fail' | 'neutral'; detail: string; info?: string; waitlist?: boolean; waitlistLabel?: string; pts: number }> = [
                                                            { label: 'llms.txt', status: d.llmsTxt.found ? 'pass' : 'fail', detail: d.llmsTxt.found ? `Found. AI coding tools can consume your docs directly.` : `Not found. llms.txt helps AI coding tools consume your docs faster.`, info: 'A markdown table of contents for your docs. Helps AI coding tools find and consume your content at inference time.', waitlist: !d.llmsTxt.found, pts: 10 },
                                                            { label: 'Sitemap', status: d.sitemapXml.found ? 'pass' : 'fail', detail: d.sitemapXml.found ? `Found. Crawlers can discover all your pages.` : 'Not found. Crawlers may miss deeper pages.', info: 'Lists every page on your site so crawlers don\'t have to guess.', pts: 5 },
                                                            { label: 'Canonical URL', status: d.canonical.found ? 'pass' : 'fail', detail: d.canonical.found ? `Set. Prevents duplicate indexing.` : 'Not set. Search engines may index duplicate versions.', info: 'Tells search engines which URL is the authoritative version of this page.', pts: 5 },
                                                            ...(d.metaRobots.blocksIndexing ? [{ label: 'Meta Robots', status: 'fail' as const, detail: `Set to "${d.metaRobots.content}". Blocks indexing.`, info: 'Your meta robots tag is preventing indexing.', pts: 5 }] : []),
                                                        ];
                                                        return items.map((item, i) => (
                                                            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                                                                {item.status === 'pass' ? <CheckCircleIcon sx={{ color: 'var(--text-muted)', fontSize: 16, mt: 0.2 }} /> : item.status === 'neutral' ? <InfoIcon sx={{ color: 'var(--text-muted)', fontSize: 16, mt: 0.2 }} /> : <ErrorIcon sx={{ color: 'var(--text-muted)', fontSize: 16, mt: 0.2 }} />}
                                                                <Box sx={{ flex: 1 }}>
                                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.3, color: 'var(--text-primary)' }}>{item.label}</Typography>
                                                                        {item.status === 'fail' && <Typography component="span" sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--accent-primary)' }}>+{item.pts} pts</Typography>}
                                                                        {item.info && (
                                                                            <Tooltip title={item.info} arrow placement="top" enterTouchDelay={0} leaveTouchDelay={3000}>
                                                                                <InfoIcon sx={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'help', opacity: 0.5, '&:hover': { opacity: 1 } }} />
                                                                            </Tooltip>
                                                                        )}
                                                                    </Box>
                                                                    <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.2, wordBreak: 'break-word' }}>{item.detail}</Typography>
                                                                    {item.waitlist && (
                                                                        <Typography variant="caption" component="a" href="/contact?ref=llmstxt" sx={{ display: 'block', color: 'var(--accent-primary)', fontSize: '0.7rem', fontWeight: 600, mt: 0.3, textDecoration: 'underline', '&:hover': { opacity: 0.8 } }}>
                                                                            {item.waitlistLabel || 'We can help you generate one →'}
                                                                        </Typography>
                                                                    )}
                                                                </Box>
                                                            </Box>
                                                        ));
                                                    })() : <CircularProgress size={20} sx={{ opacity: 0.3 }} />}
                                                </Box>

                                                {/* ── Cell 4: Content Quality ── */}
                                                <Box sx={{ p: 2, border: '1px solid var(--border-default)', borderRadius: 2, bgcolor: 'var(--bg-secondary)' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
                                                            Content Quality
                                                        </Typography>
                                                        {asyncCards.overallScore && (
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                                                    {asyncCards.overallScore.scoreBreakdown.consumability}/45
                                                                </Typography>
                                                                {asyncCards.overallScore.scoreBreakdown.consumability >= 36 ? <CheckCircleIcon sx={{ color: 'var(--text-muted)', fontSize: 16 }} /> : <WarningIcon sx={{ color: 'var(--text-muted)', fontSize: 16 }} />}
                                                            </Box>
                                                        )}
                                                    </Box>
                                                    {asyncCards.consumability ? (() => {
                                                        const c = asyncCards.consumability!;
                                                        const h2Count = c.headingHierarchy.h2Count || 0;
                                                        const h3Count = c.headingHierarchy.h3Count || 0;
                                                        const wordCount = c.wordCount || 0;
                                                        const items: { label: string; pass: boolean; detail: string; fix?: string; neutral?: boolean; info?: string; waitlist?: boolean; waitlistLabel?: string; pts: number }[] = [
                                                            ...(!c.jsRendered ? [] : [{
                                                                label: 'Client-Side Rendered',
                                                                pass: false,
                                                                detail: 'Page relies on JavaScript to render. AI crawlers see a blank page.',
                                                                info: 'Most AI bots don\'t run JavaScript. Client-side rendered pages appear empty to them.',
                                                                pts: 10,
                                                            }]),
                                                            {
                                                                label: `Headings: ${c.headingHierarchy.h1Count} H1, ${h2Count} H2, ${h3Count} H3`,
                                                                pass: c.headingHierarchy.h1Count === 1 && h2Count >= 1,
                                                                detail: c.headingHierarchy.hasProperNesting
                                                                    ? `Well-structured. AI can split into ${h2Count} chunks.`
                                                                    : (() => {
                                                                        if (c.headingHierarchy.h1Count === 0) return 'No H1 found.';
                                                                        if (c.headingHierarchy.h1Count > 1) return `${c.headingHierarchy.h1Count} H1 tags. Use exactly one.`;
                                                                        if (h2Count === 0) return 'No H2s. Content is one big block.';
                                                                        return 'Heading nesting inconsistent.';
                                                                    })(),
                                                                fix: h2Count === 0 ? 'Add sections like ## Getting Started' : (!c.headingHierarchy.hasProperNesting ? 'Restructure: H1 > H2 > H3.' : undefined),
                                                                info: 'AI splits pages at heading boundaries. Each H2 becomes a separately retrievable unit.',
                                                                pts: c.headingHierarchy.h1Count === 1 ? 8 : 10,
                                                            },
                                                            ...(wordCount > 0 ? [{
                                                                label: `Word count: ${wordCount.toLocaleString()}`,
                                                                pass: wordCount >= 500 && wordCount <= 2000,
                                                                detail: wordCount < 500
                                                                    ? `Only ${wordCount} words. Pages under 500 often lack context for AI.`
                                                                    : (wordCount > 2000
                                                                        ? `${wordCount.toLocaleString()} words. Consider splitting.`
                                                                        : `${wordCount.toLocaleString()} words. Good depth.`),
                                                                info: 'Sweet spot is 500-2,000 words.',
                                                                pts: 5,
                                                            }] : []),
                                                            {
                                                                label: 'Markdown',
                                                                pass: c.markdownAvailable.found,
                                                                detail: c.markdownAvailable.found
                                                                    ? (c.markdownAvailable.discoverable ? 'Available and discoverable by coding agents.' : 'Available but not easily discoverable.')
                                                                    : 'No markdown version found.',
                                                                fix: !c.markdownAvailable.found ? 'Serve a .md version alongside HTML.' : undefined,
                                                                waitlist: !c.markdownAvailable.found,
                                                                waitlistLabel: 'Join the waitlist for markdown generation →',
                                                                info: 'AI coding agents work better with markdown (up to 80% fewer tokens).',
                                                                pts: c.markdownAvailable.discoverable ? 8 : 4,
                                                            },
                                                            {
                                                                label: `Links: ${c.internalLinkDensity.count}`,
                                                                pass: c.internalLinkDensity.status === 'good',
                                                                detail: c.internalLinkDensity.status === 'good'
                                                                    ? `${c.internalLinkDensity.count} internal links. Good cross-referencing.`
                                                                    : `Only ${c.internalLinkDensity.count} internal links.`,
                                                                fix: c.internalLinkDensity.status === 'sparse' ? 'Add "See also" links to related pages.' : undefined,
                                                                info: 'Internal links help AI understand how your pages relate.',
                                                                pts: 4,
                                                            },
                                                        ];

                                                        return items.map((item, i) => (
                                                            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                                                                {(item as any).neutral ? <InfoIcon sx={{ color: 'var(--text-muted)', fontSize: 16, mt: 0.2 }} /> : item.pass ? <CheckCircleIcon sx={{ color: 'var(--text-muted)', fontSize: 16, mt: 0.2 }} /> : <WarningIcon sx={{ color: 'var(--text-muted)', fontSize: 16, mt: 0.2 }} />}
                                                                <Box sx={{ flex: 1 }}>
                                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.3, color: 'var(--text-primary)' }}>{item.label}</Typography>
                                                                        {!item.pass && !(item as any).neutral && <Typography component="span" sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--accent-primary)' }}>+{item.pts} pts</Typography>}
                                                                        {item.info && (
                                                                            <Tooltip title={item.info} arrow placement="top" enterTouchDelay={0} leaveTouchDelay={3000}>
                                                                                <InfoIcon sx={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'help', opacity: 0.5, '&:hover': { opacity: 1 } }} />
                                                                            </Tooltip>
                                                                        )}
                                                                    </Box>
                                                                    <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.2, wordBreak: 'break-word' }}>{item.detail}</Typography>
                                                                    {item.fix && (
                                                                        <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.65rem', lineHeight: 1.3, mt: 0.25, fontWeight: 500 }}>
                                                                            → {item.fix}
                                                                        </Typography>
                                                                    )}
                                                                    {item.waitlist && (
                                                                        <Typography variant="caption" component="a" href="/contact?ref=markdown" sx={{ display: 'block', color: 'var(--accent-primary)', fontSize: '0.7rem', fontWeight: 600, mt: 0.3, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                                                            {item.waitlistLabel || 'We can help →'}
                                                                        </Typography>
                                                                    )}
                                                                </Box>
                                                            </Box>
                                                        ));
                                                    })() : <CircularProgress size={20} sx={{ opacity: 0.3 }} />}
                                                </Box>
                                            </Box>
                                        )}

                                        {/* ── Citations Tab: Queries Table ── */}
                                        {heroTab === 'citations' && (
                                            <Box>
                                                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5, fontSize: '1rem' }}>
                                                    Where Am I Invisible?
                                                </Typography>
                                                <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontSize: '0.8rem', mb: 2 }}>
                                                    AI-generated synthetic queries tested against Perplexity — is your content being cited?
                                                </Typography>
                                                {asyncCards.aiDiscoverability ? (() => {
                                                    const disc = asyncCards.aiDiscoverability!;
                                                    const totalQueries = disc.queries.length;
                                                    const queryTypes: string[] = disc.queryTypes || disc.queries.map(() => 'low');
                                                    const hasPerplexity = disc.engines.perplexity?.available;
                                                    const hasEngines = hasPerplexity;
                                                    const perplexityResults = disc.engines.perplexity?.results || [];

                                                    const highIndices = queryTypes.map((t: string, i: number) => t === 'high' ? i : -1).filter(i => i >= 0);
                                                    const midIndices = queryTypes.map((t: string, i: number) => t === 'mid' ? i : -1).filter(i => i >= 0);
                                                    const lowIndices = queryTypes.map((t: string, i: number) => (t === 'low' || t === 'context-free') ? i : -1).filter(i => i >= 0);
                                                    const totalCited = perplexityResults.filter((r: any) => r?.cited).length;

                                                    return (
                                                        <>
                                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2.5 }}>
                                                                {hasEngines ? (
                                                                    <Chip label={`Cited: ${totalCited}/${totalQueries} synthetic queries`} size="small" sx={{
                                                                        fontWeight: 700, fontSize: '0.75rem',
                                                                        bgcolor: 'var(--bg-tertiary)',
                                                                        color: 'var(--text-secondary)',
                                                                        border: '1px solid var(--border-default)',
                                                                    }} />
                                                                ) : (
                                                                    <Chip label="Engines not configured" size="small" sx={{ bgcolor: 'var(--bg-secondary)', border: '1px solid var(--border-default)', color: 'var(--text-muted)', fontSize: '0.7rem' }} />
                                                                )}
                                                            </Box>

                                                            {(() => {
                                                                const renderEngineRow = (query: string, qi: number, intentLabel: string) => {
                                                                    const pResult = perplexityResults[qi];
                                                                    const isCited = pResult?.cited;
                                                                    const competing = new Set<string>();
                                                                    if (!isCited) {
                                                                        pResult?.competingDomains?.forEach((d: string) => competing.add(d));
                                                                    }
                                                                    return (
                                                                        <tr key={qi}>
                                                                            <td style={{ padding: '10px 14px', fontSize: '0.8rem', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>
                                                                                <span style={{
                                                                                    display: 'inline-block',
                                                                                    fontSize: '0.65rem',
                                                                                    fontWeight: 700,
                                                                                    textTransform: 'uppercase',
                                                                                    letterSpacing: '0.04em',
                                                                                    color: 'var(--text-muted)',
                                                                                    marginBottom: 3,
                                                                                }}>
                                                                                    {intentLabel} intent
                                                                                </span>
                                                                                <div style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>"{query}"</div>
                                                                                {competing.size > 0 && (
                                                                                    <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                                                        Cited instead: {Array.from(competing).map((d, i) => (
                                                                                            <span key={i} style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{i > 0 ? ', ' : ''}{d}</span>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </td>
                                                                            <td style={{ padding: '10px 14px', textAlign: 'center', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle', width: '120px' }}>
                                                                                <Chip label={isCited ? 'Cited' : 'Not Cited'} size="small" sx={{
                                                                                    bgcolor: isCited ? 'rgba(34,197,94,0.1)' : 'var(--bg-tertiary)',
                                                                                    color: isCited ? '#16a34a' : 'var(--text-muted)',
                                                                                    fontWeight: 700,
                                                                                    fontSize: '0.7rem',
                                                                                    border: `1px solid ${isCited ? 'rgba(34,197,94,0.2)' : 'var(--border-default)'}`,
                                                                                }} />
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                };

                                                                return (
                                                                    <Box sx={{
                                                                        overflowX: 'auto',
                                                                        border: '1px solid var(--border-default)',
                                                                        borderRadius: '10px',
                                                                        bgcolor: 'var(--bg-secondary)',
                                                                    }}>
                                                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                                            <thead>
                                                                                <tr style={{ borderBottom: '2px solid var(--border-default)' }}>
                                                                                    <th style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Query</th>
                                                                                    <th style={{ textAlign: 'center', padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', width: '120px' }}>Perplexity</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {highIndices.map((i: number) => renderEngineRow(disc.queries[i], i, 'High'))}
                                                                                {midIndices.map((i: number) => renderEngineRow(disc.queries[i], i, 'Mid'))}
                                                                                {lowIndices.map((i: number) => renderEngineRow(disc.queries[i], i, 'Low'))}
                                                                            </tbody>
                                                                        </table>
                                                                    </Box>
                                                                );
                                                            })()}
                                                        </>
                                                    );
                                                })() : (
                                                    <Box sx={{ textAlign: 'center', py: 4 }}>
                                                        {citationsLoading ? (
                                                            <>
                                                                <CircularProgress size={32} sx={{ opacity: 0.3, mb: 1 }} />
                                                                <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                                                                    Testing synthetic queries on Perplexity...
                                                                </Typography>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 500, mb: 1 }}>
                                                                    Click the AI Citations card above to start
                                                                </Typography>
                                                                <Button
                                                                    variant="outlined"
                                                                    size="small"
                                                                    onClick={handleRunCitations}
                                                                    sx={{ fontSize: '0.75rem', textTransform: 'none', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                                                                >
                                                                    Run citation check
                                                                </Button>
                                                            </>
                                                        )}
                                                    </Box>
                                                )}
                                            </Box>
                                        )}

                                        {/* ── Recommendations Tab ── */}
                                        {heroTab === 'recommendations' && recs.length > 0 && (
                                            <Box>
                                                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5, fontSize: '1rem' }}>
                                                    All Recommendations ({recs.length})
                                                </Typography>
                                                <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontSize: '0.8rem', mb: 2 }}>
                                                    Prioritized fixes to improve your AI Readiness score
                                                </Typography>
                                                <Grid container spacing={2}>
                                                    <Grid item xs={12} md={6}>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1.5, fontSize: '0.7rem' }}>
                                                            Quick Wins
                                                        </Typography>
                                                        {recs.filter((r: any) => r.priority === 'high').map(renderRec)}
                                                        {recs.filter((r: any) => r.priority === 'high').length === 0 && (
                                                            <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No high-priority issues ✅</Typography>
                                                        )}
                                                    </Grid>
                                                    <Grid item xs={12} md={6}>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1.5, fontSize: '0.7rem' }}>
                                                            Deeper Improvements
                                                        </Typography>
                                                        {recs.filter((r: any) => r.priority !== 'high').map(renderRec)}
                                                    </Grid>
                                                </Grid>
                                            </Box>
                                        )}
                                    </Box>

                                    {/* Grade Mapping Reference */}
                                    {(heroTab === 'readiness' || heroTab === 'recommendations') && asyncCards.overallScore && (
                                        <Box sx={{ mt: 3, p: 2, borderRadius: 2, bgcolor: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem', display: 'block', mb: 1.5 }}>
                                                Score Grading Scale
                                            </Typography>
                                            {(() => {
                                                const currentScore = asyncCards.overallScore!.overallScore;
                                                const grades = [
                                                    { grade: 'F', start: 0, end: 39 },
                                                    { grade: 'D', start: 40, end: 59 },
                                                    { grade: 'C', start: 60, end: 74 },
                                                    { grade: 'B', start: 75, end: 84 },
                                                    { grade: 'B+', start: 85, end: 89 },
                                                    { grade: 'A', start: 90, end: 94 },
                                                    { grade: 'A+', start: 95, end: 100 },
                                                ];
                                                return (
                                                    <Box>
                                                        {/* Bar with grade labels */}
                                                        <Box sx={{ display: 'flex', height: 28, borderRadius: 1, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
                                                            {grades.map((g, i) => {
                                                                const width = g.end - g.start + 1;
                                                                const isActive = currentScore >= g.start && currentScore <= g.end;
                                                                return (
                                                                    <Box key={g.grade} sx={{
                                                                        flex: width,
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                        bgcolor: isActive ? '#fff' : 'var(--bg-secondary)',
                                                                        borderRight: i < grades.length - 1 ? '1px solid var(--border-default)' : 'none',
                                                                        transition: 'all 0.3s',
                                                                        position: 'relative',
                                                                    }}>
                                                                        <Typography sx={{
                                                                            fontSize: '0.75rem', fontWeight: 900, letterSpacing: '0.02em',
                                                                            color: isActive ? '#000000 !important' : 'var(--text-muted)',
                                                                            opacity: 1,
                                                                        }}>
                                                                            {g.grade}
                                                                        </Typography>
                                                                    </Box>
                                                                );
                                                            })}
                                                        </Box>
                                                        {/* Range labels below each segment */}
                                                        <Box sx={{ display: 'flex', mt: 0.5 }}>
                                                            {grades.map((g) => {
                                                                const width = g.end - g.start + 1;
                                                                const isActive = currentScore >= g.start && currentScore <= g.end;
                                                                return (
                                                                    <Box key={g.grade} sx={{ flex: width, textAlign: 'center' }}>
                                                                        <Typography sx={{
                                                                            fontSize: '0.55rem',
                                                                            color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                                                                            fontWeight: isActive ? 700 : 400,
                                                                            opacity: isActive ? 1 : 0.6,
                                                                        }}>
                                                                            {isActive ? `▲ ${currentScore}` : `${g.start}–${g.end}`}
                                                                        </Typography>
                                                                    </Box>
                                                                );
                                                            })}
                                                        </Box>
                                                    </Box>
                                                );
                                            })()}
                                        </Box>
                                    )}

                                    {/* Disclaimer */}
                                    <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)' }}>
                                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.5 }}>
                                            This analysis is AI-generated and may not be 100% accurate. Results are directional and intended to guide improvements, not serve as a definitive audit. Lensy is currently in Beta — please verify recommendations before implementing. <a href="/contact?ref=feedback" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}>Share feedback</a>
                                        </Typography>
                                    </Box>

                                    {/* Analysis time */}
                                    {analysisState.report && (
                                        <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'var(--text-muted)', textAlign: 'right', fontSize: '0.65rem' }}>
                                            {heroTab === 'citations' && aiDisc
                                                ? `${aiTotalQueries} synthetic queries tested in ${(analysisState.report.analysisTime / 1000).toFixed(1)}s`
                                                : `Readiness analysis completed in ${(analysisState.report.analysisTime / 1000).toFixed(1)}s`
                                            }
                                        </Typography>
                                    )}
                                </>
                            );
                        })()}
                    </Paper>
                )}

                {/* ──── HOW IT WORKS SECTION ──── */}
                <Paper id="how-it-works" elevation={0} sx={{
                    p: { xs: 3, sm: 5 },
                    mb: { xs: 2, sm: 4 },
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '16px',
                    scrollMarginTop: '96px',
                }}>
                    <Typography variant="h2" sx={{
                        fontWeight: 700,
                        textAlign: 'center',
                        mb: 1,
                        letterSpacing: '-0.02em',
                        fontSize: '1.5rem',
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                        color: 'var(--text-primary)',
                    }}>
                        How It Works
                    </Typography>
                    <Typography sx={{
                        textAlign: 'center',
                        mb: 4,
                        fontSize: '0.9375rem',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-sans, var(--font-ui))',
                    }}>
                        Lensy analyzes your documentation page and tells you how visible it is to AI tools
                    </Typography>

                    <Box sx={{
                        display: 'flex',
                        flexDirection: { xs: 'column', md: 'row' },
                        gap: { xs: 3, md: 5 },
                        alignItems: { xs: 'stretch', md: 'flex-start' },
                    }}>
                        {/* Left: Steps */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            {[
                                {
                                    step: '1',
                                    title: 'Paste your doc URL',
                                    desc: 'Enter any documentation page — API references, SDK guides, tutorials, or developer portals.',
                                },
                                {
                                    step: '2',
                                    title: 'AI agent analyzes your page',
                                    desc: 'Lensy checks bot access rules, structured data, discoverability signals, and content quality in real time.',
                                },
                                {
                                    step: '3',
                                    title: 'See your AI readiness score',
                                    desc: 'Get a detailed breakdown across 4 dimensions with a score out of 100 and specific recommendations.',
                                },
                                {
                                    step: '4',
                                    title: 'Check AI citations',
                                    desc: 'See if AI search engines like Perplexity are already finding and citing your documentation.',
                                },
                            ].map((item) => (
                                <Box key={item.step} sx={{
                                    display: 'flex',
                                    gap: 2,
                                    mb: 3,
                                    '&:last-child': { mb: 0 },
                                }}>
                                    <Box sx={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: '50%',
                                        background: 'var(--text-secondary)',
                                        color: 'var(--bg-primary, #fff)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontWeight: 700,
                                        fontSize: '0.875rem',
                                        fontFamily: 'var(--font-sans, var(--font-ui))',
                                        flexShrink: 0,
                                        mt: 0.25,
                                    }}>
                                        {item.step}
                                    </Box>
                                    <Box>
                                        <Typography sx={{
                                            fontWeight: 600,
                                            fontSize: '0.9375rem',
                                            color: 'var(--text-primary)',
                                            fontFamily: 'var(--font-sans, var(--font-ui))',
                                            mb: 0.25,
                                        }}>
                                            {item.title}
                                        </Typography>
                                        <Typography sx={{
                                            fontSize: '0.8125rem',
                                            color: 'var(--text-secondary)',
                                            fontFamily: 'var(--font-sans, var(--font-ui))',
                                            lineHeight: 1.5,
                                        }}>
                                            {item.desc}
                                        </Typography>
                                    </Box>
                                </Box>
                            ))}
                        </Box>

                        {/* Right: Mermaid-style flow diagram as SVG */}
                        <Box sx={{
                            flex: 1,
                            minWidth: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <svg viewBox="0 0 340 420" style={{ width: '100%', maxWidth: 340 }}>
                                {/* Node styles */}
                                <defs>
                                    <linearGradient id="nodeGrad" x1="0" y1="0" x2="1" y2="1">
                                        <stop offset="0%" stopColor="var(--text-secondary)" stopOpacity="0.12" />
                                        <stop offset="100%" stopColor="var(--text-secondary)" stopOpacity="0.04" />
                                    </linearGradient>
                                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                                        <stop offset="0%" stopColor="var(--text-secondary)" stopOpacity="0.18" />
                                        <stop offset="100%" stopColor="var(--text-secondary)" stopOpacity="0.06" />
                                    </linearGradient>
                                </defs>

                                {/* Node 1: Paste URL */}
                                <rect x="70" y="10" width="200" height="48" rx="10" fill="url(#nodeGrad)" stroke="var(--border-default)" strokeWidth="1.5" />
                                <text x="170" y="30" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="600" fontFamily="var(--font-sans, system-ui)">Paste Documentation URL</text>
                                <text x="170" y="46" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="var(--font-sans, system-ui)">docs.example.com/api</text>

                                {/* Arrow 1→2 */}
                                <line x1="170" y1="58" x2="170" y2="85" stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="4,3" />
                                <polygon points="164,82 170,92 176,82" fill="var(--text-secondary)" />

                                {/* Node 2: Content Gate */}
                                <rect x="70" y="92" width="200" height="48" rx="10" fill="url(#nodeGrad)" stroke="var(--border-default)" strokeWidth="1.5" />
                                <text x="170" y="112" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="600" fontFamily="var(--font-sans, system-ui)">Content Validation</text>
                                <text x="170" y="128" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="var(--font-sans, system-ui)">Is this technical documentation?</text>

                                {/* Arrow 2→3 */}
                                <line x1="170" y1="140" x2="170" y2="167" stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="4,3" />
                                <polygon points="164,164 170,174 176,164" fill="var(--text-secondary)" />

                                {/* Node 3: AI Analysis (wider, 4 sub-items) */}
                                <rect x="30" y="174" width="280" height="90" rx="10" fill="url(#nodeGrad)" stroke="var(--border-default)" strokeWidth="1.5" />
                                <text x="170" y="194" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="600" fontFamily="var(--font-sans, system-ui)">AI Readiness Analysis</text>
                                {/* Sub-items in 2x2 grid */}
                                <text x="100" y="216" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="var(--font-sans, system-ui)">Bot Access</text>
                                <text x="240" y="216" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="var(--font-sans, system-ui)">Structured Data</text>
                                <text x="100" y="236" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="var(--font-sans, system-ui)">Discoverability</text>
                                <text x="240" y="236" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="var(--font-sans, system-ui)">Content Quality</text>
                                {/* Dots between items */}
                                <circle cx="100" cy="210" r="2" fill="var(--text-secondary)" opacity="0.5" />
                                <circle cx="240" cy="210" r="2" fill="var(--text-secondary)" opacity="0.5" />
                                <circle cx="100" cy="230" r="2" fill="var(--text-secondary)" opacity="0.5" />
                                <circle cx="240" cy="230" r="2" fill="var(--text-secondary)" opacity="0.5" />
                                {/* Separator dots */}
                                <rect x="55" y="247" width="230" height="1" fill="var(--border-subtle)" opacity="0.5" />
                                <text x="170" y="258" textAnchor="middle" fill="var(--text-secondary)" fontSize="8" fontFamily="var(--font-sans, system-ui)" opacity="0.7">parallel analysis</text>

                                {/* Arrow 3→4 */}
                                <line x1="170" y1="264" x2="170" y2="291" stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="4,3" />
                                <polygon points="164,288 170,298 176,288" fill="var(--text-secondary)" />

                                {/* Node 4: Citation Check */}
                                <rect x="70" y="298" width="200" height="48" rx="10" fill="url(#nodeGrad)" stroke="var(--border-default)" strokeWidth="1.5" />
                                <text x="170" y="318" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="600" fontFamily="var(--font-sans, system-ui)">AI Citation Check</text>
                                <text x="170" y="334" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="var(--font-sans, system-ui)">Perplexity AI Search</text>

                                {/* Arrow 4→5 */}
                                <line x1="170" y1="346" x2="170" y2="373" stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="4,3" />
                                <polygon points="164,370 170,380 176,370" fill="var(--text-secondary)" />

                                {/* Node 5: Score (green accent) */}
                                <rect x="70" y="380" width="200" height="36" rx="10" fill="url(#scoreGrad)" stroke="var(--text-primary)" strokeWidth="1.5" />
                                <text x="170" y="403" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="700" fontFamily="var(--font-sans, system-ui)">Score + Recommendations</text>
                            </svg>
                        </Box>
                    </Box>
                </Paper>

            </Container>

        </div >
    );
}

export default LensyApp;
