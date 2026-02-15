import React, { useState, useEffect, useRef } from 'react';
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
    Divider
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
import FixReviewPanel, { Fix } from './components/FixReviewPanel';
import jsPDF from 'jspdf';
import { JAKARTA_REGULAR, JAKARTA_BOLD } from './jakartaFonts';

// [NEW] Collapsible Component Helper
const CollapsibleCard = ({ title, children, defaultExpanded = true, count = 0, color = "default" }: any) => {
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
            bgcolor: expanded ? 'rgba(0,0,0,0.2)' : (color !== 'default' ? statusColor.bg : 'var(--bg-secondary)'),
            border: expanded ? '1px solid rgba(255,255,255,0.08)' : '1px solid var(--border-subtle)',
            boxShadow: expanded ? '0 8px 32px rgba(0,0,0,0.4)' : 'none',
            overflow: 'hidden'
        }}>
            <Box
                sx={{
                    p: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    bgcolor: expanded ? 'rgba(255,255,255,0.02)' : 'transparent',
                    '&:hover': {
                        bgcolor: 'rgba(255,255,255,0.05)'
                    }
                }}
                onClick={() => setExpanded(!expanded)}
            >
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
                <IconButton size="small" sx={{ color: 'var(--text-muted)' }}>
                    {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
            </Box>
            <Collapse in={expanded}>
                <Divider sx={{ borderColor: 'rgba(255,255,255,0.05)' }} />
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
    dimensionsAnalyzed: number;
    dimensionsTotal: number;
    confidence: 'high' | 'medium' | 'low';
    modelUsed: string;
    dimensions: Record<string, DimensionResult>;
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
    analysisTime: number;
    retryCount: number;
    aiReadiness?: AIReadinessResult;
}

interface ProgressMessage {
    type: 'info' | 'success' | 'error' | 'warning' | 'progress' | 'cache-hit' | 'cache-miss';
    message: string;
    timestamp: number;
    phase?: 'url-processing' | 'structure-detection' | 'dimension-analysis' | 'report-generation' | 'fix-generation';
    metadata?: {
        dimension?: string;
        score?: number;
        processingTime?: number;
        cacheStatus?: 'hit' | 'miss';
        contentType?: string;
        contextPages?: number;
        [key: string]: any;
    };
}

interface AnalysisState {
    status: 'idle' | 'analyzing' | 'generating' | 'applying' | 'completed' | 'error';
    report?: FinalReport;
    error?: string;
    executionArn?: string;
    progressMessages: ProgressMessage[];
}

const API_BASE_URL = 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';
const WEBSOCKET_URL = 'wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod';

function LensyApp() {
    const [url, setUrl] = useState('');
    const [selectedModel, setSelectedModel] = useState<'claude' | 'titan' | 'llama' | 'auto'>('claude');
    const [contextAnalysisEnabled, setContextAnalysisEnabled] = useState(false);
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
    const [githubIssues, setGithubIssues] = useState<Array<{
        number: number;
        title: string;
        body: string;
        html_url: string;
        labels: Array<{ name: string }>;
        created_at: string;
        comments: number;
        isDocsRelated: boolean;
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
    const [fixSuccessMessage, setFixSuccessMessage] = useState<string | null>(null);
    const [lastModifiedFile, setLastModifiedFile] = useState<string | null>(null);

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

    // Auto-scroll to latest progress message
    useEffect(() => {
        if (progressEndRef.current && analysisState.status === 'analyzing') {
            progressEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [analysisState.progressMessages, analysisState.status]);

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

    // Auto-collapse progress when analysis completes
    useEffect(() => {
        if (analysisState.status === 'completed' || analysisState.status === 'error') {
            setProgressExpanded(false);
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
        // If already connected and ready, just return the existing socket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            console.log('Reusing existing WebSocket connection');
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

                    console.log('Progress update:', message);

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

        try {
            console.log(`Fetching GitHub issues for ${owner}/${repo}...`);

            // Call our backend endpoint for github issues
            const response = await fetch(`${API_BASE_URL}/github-issues`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner, repo, maxIssues: 30 })
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
            console.log(`Fetched ${result.issues?.length || 0} issues, ${result.docsRelatedCount || 0} docs-related`);

            setGithubIssues(result.issues || []);
            setGithubFetchCompleted(true);

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

    const handleAnalyzeGithubIssues = async () => {
        if (selectedGithubIssues.length === 0) {
            setAnalysisState({ status: 'error', error: 'Please select at least one issue to analyze', progressMessages: [] });
            return;
        }

        // Parse owner/repo
        const urlStr = githubRepoUrl.trim();
        const parts = urlStr.replace(/https?:\/\/github\.com\//, '').replace(/\/$/, '').split('/');
        const owner = parts[0], repo = parts[1];

        setAnalysisState({
            status: 'analyzing',
            progressMessages: [{ type: 'info', message: 'Analyzing selected issues against documentation...', timestamp: Date.now() }]
        });

        try {
            const issuesToAnalyze = githubIssues.filter(i => selectedGithubIssues.includes(i.number));

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
                    sessionId: `github-${Date.now()}`
                })
            });

            if (!response.ok) {
                if (response.status === 429) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || 'GitHub API rate limit exceeded. Please wait and try again.');
                }
                throw new Error(`HTTP ${response.status}`);
            }
            const results = await response.json();

            setGithubAnalysisResults(results.analyses || []);
            setCopiedFixIndex(null);
            setAnalysisState({
                status: 'completed',
                progressMessages: [
                    ...analysisState.progressMessages,
                    { type: 'success', message: `Analysis complete: ${results.analyses?.length || 0} issues analyzed`, timestamp: Date.now() }
                ]
            });
        } catch (error) {
            console.error('Error analyzing GitHub issues:', error);
            setAnalysisState({
                status: 'error',
                error: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                progressMessages: []
            });
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

    const handleAnalyze = async () => {
        setFixSuccessMessage(null);
        setLastModifiedFile(null);
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

            try {
                new URL(url);
            } catch {
                setAnalysisState({ status: 'error', error: 'Please enter a valid URL', progressMessages: [] });
                return;
            }
        }

        setAnalysisState({
            status: 'analyzing',
            progressMessages: [
                { type: 'info', message: 'Starting analysis...', timestamp: Date.now() }
            ]
        });

        const sessionId = `session-${Date.now()}`;
        setCurrentSessionId(sessionId); // Store session ID for later use
        const finalInputType = manualModeOverride || selectedMode;

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
                    url: url,
                    selectedModel,
                    sessionId,
                    inputType: finalInputType,
                    contextAnalysis: (contextAnalysisEnabled && finalInputType === 'doc') ? {
                        enabled: true,
                        maxContextPages: 5
                    } : undefined,
                    cacheControl: {
                        enabled: forceFreshScan ? false : cacheEnabled
                    }
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
                    throw new Error(`HTTP ${response.status}`);
                }

                const result = await response.json();

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
                return <CheckCircleIcon sx={{ color: 'success.main' }} />;
            case 'error':
                return <ErrorIcon sx={{ color: 'error.main' }} />;
            case 'warning':
                return <WarningIcon sx={{ color: 'warning.main' }} />;
            case 'cache-hit':
                return <FlashOnIcon sx={{ color: 'success.main' }} />;
            case 'cache-miss':
                return <CachedIcon sx={{ color: 'info.main' }} />;
            case 'progress':
                return <HourglassEmptyIcon sx={{ color: 'action.active' }} />;
            default:
                return <InfoIcon sx={{ color: 'info.main' }} />;
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
            Object.entries(report.dimensions).forEach(([dimension, result]) => {
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
            const spellingIssues = report.dimensions.clarity?.spellingIssues || [];
            if (spellingIssues.length > 0) {
                markdown += `\n## SPELLING & TYPOS (${spellingIssues.length})\n\n`;
                markdown += `| Incorrect | Correct | Context |\n`;
                markdown += `|-----------|---------|---------|\n`;
                spellingIssues.forEach(m => {
                    markdown += `| ${m.incorrect} | **${m.correct}** | ...${m.context.replace(/\|/g, '-').replace(/\n/g, ' ')}... |\n`;
                });
            }

            // Configuration & Code Issues
            const configIssues = report.dimensions.accuracy?.codeIssues || [];
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
            const linkIssues = report.linkAnalysis.linkValidation?.linkIssueFindings || [];
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
            Object.entries(report.dimensions).forEach(([dimension, result]) => {
                if (result.recommendations.length > 0) {
                    markdown += `### ${dimension.charAt(0).toUpperCase() + dimension.slice(1)}\n\n`;
                    result.recommendations.forEach((rec, i) => {
                        markdown += `${i + 1}. **${rec.priority.toUpperCase()}:** ${rec.action}\n`;
                        markdown += `   Impact: ${rec.impact}\n\n`;
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
        gy = 45;
        doc.setFont(fn, 'normal');
        doc.setFontSize(18);
        const gLogoText = '{  P  }';
        doc.setFont(fn, 'bold');
        const gLogoW = doc.getTextWidth(gLogoText);
        const gLogoX = pw / 2 - gLogoW / 2;
        doc.setFont(fn, 'normal');
        doc.setTextColor(...gColor.light);
        doc.text('{', gLogoX, gy);
        doc.setFont(fn, 'bold');
        doc.setFontSize(20);
        doc.setTextColor(...gColor.dark);
        doc.text('P', pw / 2 - doc.getTextWidth('P') / 2, gy);
        doc.setFont(fn, 'normal');
        doc.setFontSize(18);
        doc.setTextColor(...gColor.light);
        doc.text('}', gLogoX + gLogoW - doc.getTextWidth('}'), gy);

        gy += 10;
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

        // Logo: { P }
        y = 55;
        doc.setFont(fn, 'normal');
        doc.setFontSize(18);
        const logoText = '{  P  }';
        doc.setFont(fn, 'bold');
        const logoW = doc.getTextWidth(logoText);
        const logoX = pageWidth / 2 - logoW / 2;
        doc.setFont(fn, 'normal');
        doc.setTextColor(...c.textLight);
        doc.text('{', logoX, y);
        doc.setFont(fn, 'bold');
        doc.setFontSize(20);
        doc.setTextColor(...c.textDark);
        const pX = pageWidth / 2 - doc.getTextWidth('P') / 2;
        doc.text('P', pX, y);
        doc.setFont(fn, 'normal');
        doc.setFontSize(18);
        doc.setTextColor(...c.textLight);
        doc.text('}', logoX + logoW - doc.getTextWidth('}'), y);

        y += 12;
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
            para(
                `The sitemap contains ${sh.totalUrls} URLs in total, of which ${sh.healthyUrls} are healthy (${sh.healthPercentage}%). ` +
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
            const dimEntries = Object.entries(report.dimensions);
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
            const linkIssueCountSummary = report.linkAnalysis.linkValidation?.linkIssueFindings?.length || 0;
            const deprecatedCountSummary = report.codeAnalysis.enhancedAnalysis?.deprecatedFindings?.length || 0;
            const spellingCountSummary = (report.dimensions.clarity?.spellingIssues || []).length;
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
                    para(
                        `The domain-level sitemap contains ${sh.totalUrls} URLs. Of these, ${sh.healthyUrls} (${sh.healthPercentage}%) are healthy. ` +
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
            const linkIssueCount = report.linkAnalysis.linkValidation?.linkIssueFindings?.length || 0;
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
            const spellingIssues = report.dimensions.clarity?.spellingIssues || [];
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
            const configIssues = report.dimensions.accuracy?.codeIssues || [];
            if (configIssues.length > 0) {
                heading('Configuration and Code Issues');
                para(`${configIssues.length} code or configuration issue${configIssues.length !== 1 ? 's were' : ' was'} identified.`);
                configIssues.forEach((issue, i) => {
                    subheading(`${i + 1}. ${issue.type.toUpperCase()}`);
                    para(issue.description);
                    labelValue('Location:', issue.location);
                });
            }

            // --- A5: Link Issues ---
            const linkIssues = report.linkAnalysis.linkValidation?.linkIssueFindings || [];
            if (linkIssues.length > 0) {
                heading('Link Issues');
                para(`${linkIssues.length} link issue${linkIssues.length !== 1 ? 's were' : ' was'} found during validation.`);
                linkIssues.forEach((link: any, i: number) => {
                    checkPage(lh);
                    doc.setFontSize(sz);
                    doc.setFont(fn, 'normal');
                    doc.setTextColor(...c.textBody);
                    const linkLine = `${i + 1}. [${link.issueType}] "${link.anchorText || 'Link'}" links to ${link.url}`;
                    doc.text(linkLine.length > 100 ? linkLine.substring(0, 97) + '...' : linkLine, margin, y);
                    y += lh;
                });
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
            const allRecsRaw = Object.entries(report.dimensions)
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
                    y += lh + 1;
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
            {/* Secondary service bar — Lensy-specific context (like AWS "Amazon S3" bar) */}
            <Box sx={{
                borderBottom: '1px solid var(--border-subtle)',
                bgcolor: 'var(--bg-secondary)',
                px: 3,
                py: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
            }}>
                <span style={{ fontSize: '1rem' }} role="img" aria-label="Lensy">🔍</span>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                    Lensy
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    Documentation Quality Auditor
                </Typography>
            </Box>

            <Container maxWidth={selectedMode === 'github-issues' && (analysisState.status === 'analyzing' || githubAnalysisResults) ? 'xl' : 'lg'} sx={{ py: 4, transition: 'max-width 0.3s ease' }}>

                <Paper sx={{ p: 4, mb: 4 }}>
                    <Box sx={{ display: 'flex', gap: 1, mb: 3, alignItems: 'center' }}>
                        <Chip
                            label="Doc Audit"
                            onClick={() => { setSelectedMode('doc'); setManualModeOverride('doc'); }}
                            color={selectedMode === 'doc' ? 'primary' : 'default'}
                            variant={selectedMode === 'doc' ? 'filled' : 'outlined'}
                            sx={{ fontWeight: 600 }}
                        />
                        <Chip
                            label="GitHub Issues"
                            onClick={() => { setSelectedMode('github-issues'); setManualModeOverride('github-issues'); }}
                            color={selectedMode === 'github-issues' ? 'primary' : 'default'}
                            variant={selectedMode === 'github-issues' ? 'filled' : 'outlined'}
                            sx={{ fontWeight: 600 }}
                        />
                        <Box sx={{ flex: 1 }} />
                        <Typography
                            variant="caption"
                            sx={{
                                fontWeight: 700,
                                fontSize: '0.6rem',
                                color: '#818cf8',
                                bgcolor: 'rgba(129, 140, 248, 0.1)',
                                border: '1px solid rgba(129, 140, 248, 0.25)',
                                borderRadius: '4px',
                                px: 0.75,
                                py: 0.25,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                lineHeight: 1,
                            }}
                        >
                            Beta
                        </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                        <Box sx={{ flexGrow: 1 }}>
                            {selectedMode === 'github-issues' ? (
                                <>
                                    <TextField
                                        fullWidth
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
                                            }
                                        }}
                                        placeholder="https://github.com/resend/react-email"
                                        disabled={analysisState.status === 'analyzing'}
                                        helperText="Enter a GitHub repository URL to scan open issues for documentation gaps"
                                    />

                                    {isFetchingGithubIssues && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mb: 1 }}>
                                            <CircularProgress size={16} sx={{ mr: 1.5 }} />
                                            <Typography variant="caption" color="text.secondary">
                                                Fetching open issues and analyzing docs context...
                                            </Typography>
                                        </Box>
                                    )}

                                    {/* Zero issues found after fetch */}
                                    {githubFetchCompleted && githubIssues.length === 0 && !isFetchingGithubIssues && (
                                        <Box sx={{ mt: 3, p: 3, textAlign: 'center', bgcolor: 'rgba(255, 255, 255, 0.03)', borderRadius: 2, border: '1px solid var(--border-subtle)' }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'var(--text-primary)' }}>
                                                No open issues found
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
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
                                            <Typography variant="caption" color="text.secondary">
                                                Found {githubIssues.length} open issue{githubIssues.length !== 1 ? 's' : ''}, but none appear to be related to documentation gaps. Great docs!
                                            </Typography>
                                        </Box>
                                    )}

                                    {githubIssues.length > 0 && githubIssues.filter(i => i.isDocsRelated).length > 0 && (
                                        <Box sx={{ mt: 3 }}>
                                            {/* Two-column layout: issues left, results/progress right */}
                                            <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>

                                                {/* LEFT COLUMN: Issues list */}
                                                <Box sx={{ flex: (analysisState.status === 'analyzing' || githubAnalysisResults) ? '0 0 38%' : '1 1 100%', minWidth: 0, transition: 'flex 0.3s ease' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                                            {githubIssues.filter(i => i.isDocsRelated).length} docs-related issues found
                                                        </Typography>
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
                                                        '&:hover::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.15)' },
                                                        '&:hover::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.3)' },
                                                        scrollbarWidth: 'thin',
                                                        scrollbarColor: 'transparent transparent',
                                                        '&:hover': { scrollbarColor: 'rgba(255,255,255,0.15) transparent' },
                                                    }}>
                                                        {githubIssues.filter(i => i.isDocsRelated).map((issue, index, arr) => (
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
                                                                    '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.02)' },
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
                                                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', mb: 0.25 }}>
                                                                        #{issue.number}: {issue.title}
                                                                    </Typography>
                                                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.25 }}>
                                                                        {issue.labels.slice(0, 3).map(l => (
                                                                            <Chip key={l.name} label={l.name} size="small"
                                                                                sx={{ height: 18, fontSize: '0.55rem', fontWeight: 700, maxWidth: 150, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }} />
                                                                        ))}
                                                                        {issue.labels.length > 3 && (
                                                                            <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'var(--text-secondary)', lineHeight: '18px' }}>
                                                                                +{issue.labels.length - 3}
                                                                            </Typography>
                                                                        )}
                                                                    </Box>
                                                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem', lineHeight: 1.3, mt: 0.25 }}>
                                                                        {issue.body ? issue.body.substring(0, 80).replace(/\n/g, ' ') + '...' : 'No description'}
                                                                    </Typography>
                                                                    <Box sx={{ display: 'flex', gap: 1.5, mt: 0.25 }}>
                                                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                                                            💬 {issue.comments} comments
                                                                        </Typography>
                                                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
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
                                                            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 500 }}>
                                                                ▼ scroll for more
                                                            </Typography>
                                                        </Box>
                                                    )}
                                                </Box>

                                                {/* RIGHT COLUMN: Progress (while analyzing) or Results (when done) */}
                                                {(analysisState.status === 'analyzing' || githubAnalysisResults) && (
                                                    <Box sx={{ flex: '0 0 60%', minWidth: 0 }}>

                                                        {/* Progress indicator — only while analyzing */}
                                                        {analysisState.status === 'analyzing' && (
                                                            <Box sx={{ p: 3, bgcolor: 'rgba(59, 130, 246, 0.05)', borderRadius: 2, border: '1px solid rgba(59, 130, 246, 0.15)' }}>
                                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                                    <CircularProgress size={18} sx={{ mr: 1.5 }} />
                                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.85rem' }}>
                                                                        Analyzing {selectedGithubIssues.length} issue{selectedGithubIssues.length !== 1 ? 's' : ''}...
                                                                    </Typography>
                                                                </Box>
                                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, fontSize: '0.75rem' }}>
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

                                                        {/* Results — shown after analysis completes */}
                                                        {githubAnalysisResults && githubAnalysisResults.length > 0 && analysisState.status !== 'analyzing' && (
                                                            <Box>
                                                                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700, color: 'var(--text-primary)' }}>
                                                                    Documentation Gaps Found ({githubAnalysisResults.length})
                                                                </Typography>
                                                                {githubAnalysisResults.map((result: any, idx: number) => (
                                                                    <Card key={idx} sx={{
                                                                        mb: 2.5,
                                                                        border: '1px solid',
                                                                        borderColor: 'rgba(255,255,255,0.1)',
                                                                        borderLeft: '3px solid',
                                                                        borderLeftColor: '#6366f1',
                                                                        overflow: 'visible'
                                                                    }}>
                                                                        <CardContent sx={{ pb: '12px !important', p: 2 }}>
                                                                            {/* Header: issue title + link */}
                                                                            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.75 }}>
                                                                                <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, fontSize: '0.9rem' }}>
                                                                                    #{result.number}: {result.title}
                                                                                </Typography>
                                                                                <a href={result.html_url} target="_blank" rel="noopener noreferrer"
                                                                                    style={{ marginLeft: 8, color: '#94a3b8', display: 'inline-flex' }}
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
                                                                                    sx={{ fontWeight: 600, textTransform: 'capitalize', fontSize: '0.7rem', borderColor: 'rgba(255,255,255,0.15)', color: '#94a3b8' }}
                                                                                />
                                                                                <Chip
                                                                                    label={`${result.docsGap?.confidence || 0}% confidence`}
                                                                                    size="small"
                                                                                    variant="outlined"
                                                                                    sx={{ fontWeight: 600, fontSize: '0.7rem', borderColor: 'rgba(255,255,255,0.15)', color: '#94a3b8' }}
                                                                                />
                                                                                {result.docsGap?.affectedDocs?.length > 0 && (
                                                                                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                                                                                        {result.docsGap.affectedDocs.join(', ')}
                                                                                    </Typography>
                                                                                )}
                                                                            </Box>

                                                                            {/* Section context */}
                                                                            {result.docsGap?.section && (
                                                                                <Typography variant="caption" sx={{ display: 'block', mb: 1, color: '#64748b', fontSize: '0.7rem' }}>
                                                                                    {result.docsGap.section}{result.docsGap.lineContext ? ` · ${result.docsGap.lineContext}` : ''}
                                                                                </Typography>
                                                                            )}

                                                                            {/* Before / After text blocks */}
                                                                            {result.docsGap?.originalText && result.docsGap?.correctedText && (
                                                                                <Box sx={{ mb: 1 }}>
                                                                                    {/* Before */}
                                                                                    <Box sx={{ mb: 1 }}>
                                                                                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#94a3b8', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>
                                                                                            Before
                                                                                        </Typography>
                                                                                        <Box sx={{
                                                                                            bgcolor: 'rgba(255,255,255,0.03)',
                                                                                            border: '1px solid rgba(255,255,255,0.06)',
                                                                                            borderRadius: 1,
                                                                                            p: 1.5,
                                                                                        }}>
                                                                                            <Typography variant="body2" sx={{
                                                                                                fontSize: '0.8rem',
                                                                                                lineHeight: 1.6,
                                                                                                color: '#cbd5e1',
                                                                                                whiteSpace: 'pre-wrap',
                                                                                                wordBreak: 'break-word',
                                                                                                fontFamily: 'inherit',
                                                                                            }}>
                                                                                                {result.docsGap.originalText}
                                                                                            </Typography>
                                                                                        </Box>
                                                                                    </Box>
                                                                                    {/* After */}
                                                                                    <Box>
                                                                                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#94a3b8', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>
                                                                                            After
                                                                                        </Typography>
                                                                                        <Box sx={{
                                                                                            bgcolor: 'rgba(255,255,255,0.03)',
                                                                                            border: '1px solid rgba(255,255,255,0.06)',
                                                                                            borderRadius: 1,
                                                                                            p: 1.5,
                                                                                        }}>
                                                                                            <Typography variant="body2" sx={{
                                                                                                fontSize: '0.8rem',
                                                                                                lineHeight: 1.6,
                                                                                                color: '#e2e8f0',
                                                                                                whiteSpace: 'pre-wrap',
                                                                                                wordBreak: 'break-word',
                                                                                                fontFamily: 'inherit',
                                                                                            }}>
                                                                                                {result.docsGap.correctedText}
                                                                                            </Typography>
                                                                                        </Box>
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
                                                                                    {result.docsGap?.affectedDocs?.length > 0 && (() => {
                                                                                        // Build GitHub edit URL from repo URL + first affected doc
                                                                                        let editUrl = '';
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
                                                                                            if (owner && repo && filePath) {
                                                                                                editUrl = `https://github.com/${owner}/${repo}/edit/main/${filePath}`;
                                                                                            }
                                                                                        } catch { /* ignore */ }
                                                                                        return editUrl ? (
                                                                                            <Button
                                                                                                size="small"
                                                                                                variant="outlined"
                                                                                                startIcon={<OpenInNewIcon />}
                                                                                                href={editUrl}
                                                                                                target="_blank"
                                                                                                rel="noopener noreferrer"
                                                                                                sx={{
                                                                                                    fontWeight: 600,
                                                                                                    fontSize: '0.7rem',
                                                                                                    whiteSpace: 'nowrap',
                                                                                                    color: '#a78bfa',
                                                                                                    borderColor: '#a78bfa',
                                                                                                    '&:hover': { borderColor: '#8b5cf6', bgcolor: 'rgba(139,92,246,0.05)' }
                                                                                                }}
                                                                                            >
                                                                                                Open PR
                                                                                            </Button>
                                                                                        ) : null;
                                                                                    })()}
                                                                                </Box>
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
                                                                <Typography variant="caption" color="text.secondary">
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
                                        placeholder="resend.com, liveblocks.io, or docs.knock.app"
                                        disabled={analysisState.status === 'analyzing'}
                                        helperText="Domain to investigate"
                                    />

                                    {isSearchingIssues && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mb: 1 }}>
                                            <CircularProgress size={16} sx={{ mr: 1.5 }} />
                                            <Typography variant="caption" color="text.secondary">
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
                                                                bgcolor: 'rgba(255, 255, 255, 0.02)',
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
                                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.75rem' }}>
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
                                    label={selectedMode === 'sitemap' ? "Sitemap URL" : "Documentation URL"}
                                    variant="outlined"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder={selectedMode === 'sitemap' ? "https://example.com/sitemap.xml" : "https://docs.example.com/getting-started"}
                                    disabled={analysisState.status === 'analyzing'}
                                />
                            )}
                        </Box>

                        <Button
                            variant="contained"
                            onClick={handleAnalyze}
                            disabled={
                                analysisState.status === 'analyzing' ||
                                isFetchingGithubIssues ||
                                (selectedMode === 'github-issues' && githubIssues.length > 0 && selectedGithubIssues.length === 0)
                            }
                            sx={{
                                height: 56,
                                minWidth: 120,
                                px: 4,
                                whiteSpace: 'nowrap',
                                boxShadow: '0 0 20px rgba(59, 130, 246, 0.15)',
                                '&:hover': {
                                    boxShadow: '0 0 30px rgba(59, 130, 246, 0.25)',
                                }
                            }}
                        >
                            {analysisState.status === 'analyzing' ? (
                                <CircularProgress size={20} color="inherit" />
                            ) : isFetchingGithubIssues ? (
                                <CircularProgress size={20} color="inherit" />
                            ) : analysisState.status === 'generating' ? (
                                'Generating...'
                            ) : analysisState.status === 'applying' ? (
                                'Applying...'
                            ) : selectedMode === 'github-issues' ? (
                                githubIssues.length === 0 ? 'Fetch Issues' :
                                selectedGithubIssues.length > 0 ? `Analyze (${selectedGithubIssues.length})` : 'Select Issues'
                            ) : (fixSuccessMessage || (!analysisState.report && currentSessionId)) ? (
                                'Re-scan'
                            ) : (
                                'Start'
                            )}
                        </Button>
                    </Box>

                    {/* AI Model Selection hidden per branding guidelines */}
                    <input type="hidden" name="selectedModel" value={selectedModel} />

                    {analysisState.status === 'error' && (
                        <Alert severity="error" sx={{ mt: 3 }}>
                            {analysisState.error}
                        </Alert>
                    )}
                </Paper>

                {/* Progress Messages — hidden for github-issues mode (shown inline in right column) */}
                {analysisState.progressMessages.length > 0 && selectedMode !== 'github-issues' && (
                    <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                            <Typography variant="h6">
                                Real-time Progress ({analysisState.progressMessages.length} messages)
                            </Typography>
                            <IconButton
                                onClick={() => setProgressExpanded(!progressExpanded)}
                                size="small"
                            >
                                {progressExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </IconButton>
                        </Box>

                        <Collapse in={progressExpanded}>
                            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
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
                                                        color: msg.type === 'error' ? 'error.main' :
                                                            msg.type === 'success' ? 'success.main' :
                                                                msg.type === 'cache-hit' ? 'success.main' :
                                                                    msg.type === 'warning' ? 'warning.main' :
                                                                        'text.primary'
                                                    }
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
                                        <Typography variant="h3" color="success.main">
                                            {validationResults.summary.resolved}
                                        </Typography>
                                        <Typography variant="h6">✅ Resolved</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            Documentation is complete
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" color="warning.main">
                                            {validationResults.summary.potentialGaps}
                                        </Typography>
                                        <Typography variant="h6">⚠️ Potential Gaps</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            Pages exist but incomplete
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" color="error.main">
                                            {validationResults.summary.criticalGaps}
                                        </Typography>
                                        <Typography variant="h6">❌ Critical Gaps</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            No relevant pages found
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" color="primary">
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
                                                <Typography variant="h3" color="primary">
                                                    {validationResults.sitemapHealth.totalUrls}
                                                </Typography>
                                                <Typography variant="h6">Total URLs</Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" color="success.main">
                                                    {validationResults.sitemapHealth.healthyUrls}
                                                </Typography>
                                                <Typography variant="h6">Healthy</Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    {validationResults.sitemapHealth.healthPercentage}%
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" color="error.main">
                                                    {validationResults.sitemapHealth.brokenUrls || 0}
                                                </Typography>
                                                <Typography variant="h6">Broken (404)</Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" color="warning.main">
                                                    {(validationResults.sitemapHealth.accessDeniedUrls || 0) +
                                                        (validationResults.sitemapHealth.timeoutUrls || 0) +
                                                        (validationResults.sitemapHealth.otherErrorUrls || 0)}
                                                </Typography>
                                                <Typography variant="h6">Other Issues</Typography>
                                                <Typography variant="body2" color="text.secondary">
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
                                                        <Typography variant="body2" color="text.secondary">
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
                                        <Chip label={`${result.confidence}% confidence`} variant="outlined" />
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
                                                    <Typography variant="caption" color="text.secondary">
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
                                                                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                                                        padding: '2px 6px',
                                                                        borderRadius: '3px',
                                                                        fontFamily: 'monospace',
                                                                        fontSize: '0.9em',
                                                                        color: '#60a5fa'
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
                                            <Typography variant="subtitle2" gutterBottom color="warning.main">
                                                ⚠️ Potential Gaps:
                                            </Typography>
                                            {result.potentialGaps.map((gap: any, idx: number) => (
                                                <Box key={idx} sx={{ ml: 2, mb: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                                    <Typography variant="body2">
                                                        <strong>{gap.pageUrl}</strong>
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
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

                {/* Results */}
                {analysisState.status === 'completed' && analysisState.report && (
                    <Paper elevation={3} sx={{ p: 4 }}>
                        <Typography variant="h5" gutterBottom>
                            Analysis Results
                        </Typography>

                        <Grid container spacing={3} sx={{ mb: 4 }}>
                            <Grid item xs={12} md={4}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" color={getScoreColor(analysisState.report.overallScore)}>
                                            {analysisState.report.overallScore}
                                        </Typography>
                                        <Typography variant="h6">Overall Score</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Typography variant="h4">
                                            {analysisState.report.dimensionsAnalyzed}/{analysisState.report.dimensionsTotal}
                                        </Typography>
                                        <Typography variant="h6">Dimensions</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Chip
                                            label={analysisState.report.confidence.toUpperCase()}
                                            color={getConfidenceColor(analysisState.report.confidence)}
                                        />
                                        <Typography variant="h6" sx={{ mt: 1 }}>Confidence</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                        </Grid>

                        {/* Sitemap Health Summary (only for sitemap mode or if doc mode has health data) */}
                        {analysisState.report.sitemapHealth && (
                            <CollapsibleCard
                                title="Sitemap Health Summary"
                                defaultExpanded={true}
                                color={analysisState.report.sitemapHealth.error ? 'error' : ((analysisState.report.sitemapHealth.healthPercentage || 0) < 100 ? 'warning' : 'success')}
                            >
                                {analysisState.report.sitemapHealth.error ? (
                                    <Alert severity="error" sx={{ mb: 2 }}>
                                        <Typography variant="subtitle1" fontWeight="bold">Sitemap Check Failed</Typography>
                                        <Typography variant="body2">{analysisState.report.sitemapHealth.error}</Typography>
                                    </Alert>
                                ) : (
                                    <>
                                        <Grid container spacing={3}>
                                            <Grid item xs={12} md={3}>
                                                <Card variant="outlined">
                                                    <CardContent sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h3" color="primary">
                                                            {analysisState.report.sitemapHealth.totalUrls}
                                                        </Typography>
                                                        <Typography variant="h6">Total URLs</Typography>
                                                    </CardContent>
                                                </Card>
                                            </Grid>
                                            <Grid item xs={12} md={3}>
                                                <Card variant="outlined">
                                                    <CardContent sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h3" color="success.main">
                                                            {analysisState.report.sitemapHealth.healthyUrls}
                                                        </Typography>
                                                        <Typography variant="h6">Healthy</Typography>
                                                        <Typography variant="body2" color="text.secondary">
                                                            {analysisState.report.sitemapHealth.healthPercentage}%
                                                        </Typography>
                                                    </CardContent>
                                                </Card>
                                            </Grid>
                                            <Grid item xs={12} md={3}>
                                                <Card variant="outlined">
                                                    <CardContent sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h3" color="error.main">
                                                            {analysisState.report.sitemapHealth.brokenUrls}
                                                        </Typography>
                                                        <Typography variant="h6">Broken (404)</Typography>
                                                    </CardContent>
                                                </Card>
                                            </Grid>
                                            <Grid item xs={12} md={3}>
                                                <Card variant="outlined">
                                                    <CardContent sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h3" color="warning.main">
                                                            {(analysisState.report.sitemapHealth.accessDeniedUrls || 0) +
                                                                (analysisState.report.sitemapHealth.timeoutUrls || 0) +
                                                                (analysisState.report.sitemapHealth.otherErrorUrls || 0)}
                                                        </Typography>
                                                        <Typography variant="h6">Other Issues</Typography>
                                                        <Typography variant="body2" color="text.secondary">
                                                            {(analysisState.report.sitemapHealth.accessDeniedUrls || 0)} access denied, {' '}
                                                            {(analysisState.report.sitemapHealth.timeoutUrls || 0)} timeout, {' '}
                                                            {(analysisState.report.sitemapHealth.otherErrorUrls || 0)} errors
                                                        </Typography>
                                                    </CardContent>
                                                </Card>
                                            </Grid>
                                        </Grid>
                                        {(analysisState.report.sitemapHealth.linkIssues?.length || 0) > 0 && (
                                            <Box sx={{ mt: 3 }}>
                                                <Divider sx={{ my: 2 }} />
                                                <Typography variant="h6" gutterBottom>
                                                    Link Issues Details ({(analysisState.report.sitemapHealth.linkIssues?.length || 0)})
                                                </Typography>
                                                <Box sx={{ maxHeight: 300, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
                                                    {(analysisState.report.sitemapHealth.linkIssues || []).map((issue, index) => (
                                                        <Box key={index} sx={{ mb: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                                            <Typography variant="body2" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                                                                <span style={{ marginRight: '8px' }}>
                                                                    {issue.issueType === '404' ? '🔴' :
                                                                        issue.issueType === 'access-denied' ? '🟡' :
                                                                            issue.issueType === 'timeout' ? '🟠' : '⚫'}
                                                                </span>
                                                                {issue.url}
                                                            </Typography>
                                                            <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                                                                {issue.errorMessage}
                                                            </Typography>
                                                        </Box>
                                                    ))}
                                                </Box>
                                            </Box>
                                        )}
                                    </>
                                )}
                            </CollapsibleCard>
                        )}


                        {/* AI Readiness Section */}
                        {analysisState.report.aiReadiness && (
                            <CollapsibleCard
                                title="AI Readiness Assessment"
                                defaultExpanded={false}
                                color={analysisState.report.aiReadiness.overallScore < 80 ? 'warning' : 'success'}
                                count={analysisState.report.aiReadiness.overallScore + '/100'}
                            >
                                <Grid container spacing={2}>
                                    <Grid item xs={12} md={6}>
                                        <Card variant="outlined" sx={{ height: '100%' }}>
                                            <CardContent>
                                                <Typography variant="h6" gutterBottom>Configuration Checks</Typography>
                                                <List dense>
                                                    <ListItem>
                                                        <ListItemIcon>
                                                            {analysisState.report.aiReadiness.llmsTxt.found ? <CheckCircleIcon color="success" /> : <ErrorIcon color="error" />}
                                                        </ListItemIcon>
                                                        <ListItemText
                                                            primary="llms.txt"
                                                            secondary={analysisState.report.aiReadiness.llmsTxt.found ? "Found" : "Missing"}
                                                        />
                                                    </ListItem>
                                                    <ListItem>
                                                        <ListItemIcon>
                                                            {analysisState.report.aiReadiness.llmsFullTxt.found ? <CheckCircleIcon color="success" /> : <ErrorIcon color="error" />}
                                                        </ListItemIcon>
                                                        <ListItemText
                                                            primary="llms-full.txt"
                                                            secondary={analysisState.report.aiReadiness.llmsFullTxt.found ? "Found" : "Missing"}
                                                        />
                                                    </ListItem>
                                                    <ListItem>
                                                        <ListItemIcon>
                                                            {analysisState.report.aiReadiness.structuredData.hasJsonLd ? <CheckCircleIcon color="success" /> : <ErrorIcon color="error" />}
                                                        </ListItemIcon>
                                                        <ListItemText
                                                            primary="JSON-LD Structured Data"
                                                            secondary={analysisState.report.aiReadiness.structuredData.hasJsonLd ? "Found" : "Missing"}
                                                        />
                                                    </ListItem>
                                                </List>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={6}>
                                        <Card variant="outlined" sx={{ height: '100%' }}>
                                            <CardContent>
                                                <Typography variant="h6" gutterBottom>Robots & Access</Typography>
                                                <List dense>
                                                    <ListItem>
                                                        <ListItemIcon>
                                                            {analysisState.report.aiReadiness.robotsTxt.aiDirectives.length > 0 ? <CheckCircleIcon color="success" /> : <InfoIcon color="action" />}
                                                        </ListItemIcon>
                                                        <ListItemText
                                                            primary="Robots.txt AI Rules"
                                                            secondary={analysisState.report.aiReadiness.robotsTxt.aiDirectives.length > 0 ? `${analysisState.report.aiReadiness.robotsTxt.aiDirectives.length} rules found` : "No specific AI rules found"}
                                                        />
                                                    </ListItem>
                                                    <ListItem>
                                                        <ListItemIcon>
                                                            {analysisState.report.aiReadiness.markdownExports.available ? <CheckCircleIcon color="success" /> : <InfoIcon color="action" />}
                                                        </ListItemIcon>
                                                        <ListItemText
                                                            primary="Markdown Exports"
                                                            secondary={analysisState.report.aiReadiness.markdownExports.available ? "Available" : "Not detected"}
                                                        />
                                                    </ListItem>
                                                </List>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    {analysisState.report.aiReadiness.recommendations.length > 0 && (
                                        <Grid item xs={12}>
                                            <Alert severity="info">
                                                <Typography variant="subtitle2">Recommendations:</Typography>
                                                <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                                                    {analysisState.report.aiReadiness.recommendations.map((rec, i) => (
                                                        <li key={i}>{rec}</li>
                                                    ))}
                                                </ul>
                                            </Alert>
                                        </Grid>
                                    )}
                                </Grid>
                            </CollapsibleCard>
                        )}

                        {/* Dimension Analysis Section */}
                        <CollapsibleCard
                            title="Dimension Analysis"
                            defaultExpanded={false}
                        >
                            <Grid container spacing={3}>
                                {Object.entries(analysisState.report.dimensions).map(([dimension, result]: [string, any]) => (
                                    <Grid item xs={12} md={6} key={dimension}>
                                        <Card variant="outlined">
                                            <CardContent>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                                    <Typography variant="h6" sx={{ textTransform: 'capitalize' }}>
                                                        {dimension}
                                                    </Typography>
                                                    <Chip
                                                        label={`${result.score}/10`}
                                                        color={getScoreColor((result.score || 0) * 10)}
                                                        variant="outlined"
                                                        sx={{ fontWeight: 'bold' }}
                                                    />
                                                </Box>
                                                {result.findings && result.findings.length > 0 ? (
                                                    <List dense>
                                                        {result.findings.slice(0, 3).map((finding: string, i: number) => (
                                                            <ListItem key={i} disableGutters>
                                                                <ListItemIcon sx={{ minWidth: 30 }}>
                                                                    <InfoIcon fontSize="small" color="info" />
                                                                </ListItemIcon>
                                                                <ListItemText primary={finding} primaryTypographyProps={{ variant: 'body2' }} />
                                                            </ListItem>
                                                        ))}
                                                        {result.findings.length > 3 && (
                                                            <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
                                                                ...and {result.findings.length - 3} more
                                                            </Typography>
                                                        )}
                                                    </List>
                                                ) : (
                                                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                                        No major findings.
                                                    </Typography>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                ))}
                            </Grid>
                        </CollapsibleCard>
                        <CollapsibleCard
                            title="Critical Findings (Top Issues)"
                            defaultExpanded={true}
                            color="error"
                        >
                            <Grid container spacing={2}>
                                {/* Link Issues */}
                                <Grid item xs={12} md={4}>
                                    <Card>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                {analysisState.report.linkAnalysis.linkValidation?.linkIssueFindings?.length ? (
                                                    <>
                                                        <ErrorIcon sx={{ color: 'warning.main', mr: 1 }} />
                                                        <Typography variant="h6">
                                                            Link Issues: {analysisState.report.linkAnalysis.linkValidation.linkIssueFindings.length}
                                                            {(() => {
                                                                const broken = analysisState.report.linkAnalysis.linkValidation.linkIssueFindings.filter((l: any) => l.issueType === '404').length;
                                                                return broken > 0 ? ` (${broken} broken)` : '';
                                                            })()}
                                                        </Typography>
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircleIcon sx={{ color: 'success.main', mr: 1 }} />
                                                        <Typography variant="h6">
                                                            Link Issues: None found
                                                        </Typography>
                                                    </>
                                                )}
                                            </Box>
                                            {analysisState.report.linkAnalysis.linkValidation?.linkIssueFindings?.slice(0, 2).map((link: any, i: number) => (
                                                <Typography key={i} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                                    • {link.anchorText} → {link.issueType === '404' ? '404' : link.issueType === 'access-denied' ? '403' : link.status}
                                                </Typography>
                                            ))}
                                            {(analysisState.report.linkAnalysis.linkValidation?.linkIssueFindings?.length || 0) > 2 && (
                                                <Typography variant="body2" color="text.secondary">
                                                    ... and {(analysisState.report.linkAnalysis.linkValidation?.linkIssueFindings?.length || 0) - 2} more
                                                </Typography>
                                            )}
                                        </CardContent>
                                    </Card>
                                </Grid>

                                {/* Deprecated Code */}
                                <Grid item xs={12} md={4}>
                                    <Card>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                {analysisState.report.codeAnalysis.enhancedAnalysis?.deprecatedFindings?.length ? (
                                                    <>
                                                        <ErrorIcon sx={{ color: 'warning.main', mr: 1 }} />
                                                        <Typography variant="h6">
                                                            Deprecated Code: {analysisState.report.codeAnalysis.enhancedAnalysis.deprecatedFindings.length}
                                                        </Typography>
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircleIcon sx={{ color: 'success.main', mr: 1 }} />
                                                        <Typography variant="h6">
                                                            Deprecated Code: None found
                                                        </Typography>
                                                    </>
                                                )}
                                            </Box>
                                            {analysisState.report.codeAnalysis.enhancedAnalysis?.deprecatedFindings?.slice(0, 2).map((finding, i) => (
                                                <Typography key={i} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                                    • {finding.method} (deprecated in {finding.deprecatedIn})
                                                </Typography>
                                            ))}
                                            {(analysisState.report.codeAnalysis.enhancedAnalysis?.deprecatedFindings?.length || 0) > 2 && (
                                                <Typography variant="body2" color="text.secondary">
                                                    ... and {(analysisState.report.codeAnalysis.enhancedAnalysis?.deprecatedFindings?.length || 0) - 2} more
                                                </Typography>
                                            )}
                                        </CardContent>
                                    </Card>
                                </Grid>

                                {/* Syntax Errors */}
                                <Grid item xs={12} md={4}>
                                    <Card>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                {analysisState.report.codeAnalysis.enhancedAnalysis?.syntaxErrorFindings?.length ? (
                                                    <>
                                                        <ErrorIcon sx={{ color: 'error.main', mr: 1 }} />
                                                        <Typography variant="h6">
                                                            Syntax Errors: {analysisState.report.codeAnalysis.enhancedAnalysis.syntaxErrorFindings.length}
                                                        </Typography>
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircleIcon sx={{ color: 'success.main', mr: 1 }} />
                                                        <Typography variant="h6">
                                                            Syntax Errors: None found
                                                        </Typography>
                                                    </>
                                                )}
                                            </Box>
                                            {analysisState.report.codeAnalysis.enhancedAnalysis?.syntaxErrorFindings?.slice(0, 2).map((error, i) => (
                                                <Typography key={i} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                                    • {error.errorType}: {error.description}
                                                </Typography>
                                            ))}
                                            {(analysisState.report.codeAnalysis.enhancedAnalysis?.syntaxErrorFindings?.length || 0) > 2 && (
                                                <Typography variant="body2" color="text.secondary">
                                                    ... and {(analysisState.report.codeAnalysis.enhancedAnalysis?.syntaxErrorFindings?.length || 0) - 2} more
                                                </Typography>
                                            )}
                                        </CardContent>
                                    </Card>
                                </Grid>

                                {/* URL Slug Issues - NEW */}
                                {(analysisState.report as any).urlSlugAnalysis && (
                                    <Grid item xs={12} md={4}>
                                        <Card>
                                            <CardContent>
                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                    {(analysisState.report as any).urlSlugAnalysis.issues?.length ? (
                                                        <>
                                                            <ErrorIcon sx={{ color: 'warning.main', mr: 1 }} />
                                                            <Typography variant="h6">
                                                                URL Slug Issues: {(analysisState.report as any).urlSlugAnalysis.issues.length}
                                                            </Typography>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <CheckCircleIcon sx={{ color: 'success.main', mr: 1 }} />
                                                            <Typography variant="h6">
                                                                URL Slug Quality: Clean
                                                            </Typography>
                                                        </>
                                                    )}
                                                </Box>
                                                {(analysisState.report as any).urlSlugAnalysis.issues?.slice(0, 2).map((issue: any, i: number) => (
                                                    <Typography key={i} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                                        • "{issue.segment}" → "{issue.suggestion}"
                                                    </Typography>
                                                ))}
                                                {((analysisState.report as any).urlSlugAnalysis.issues?.length || 0) > 2 && (
                                                    <Typography variant="body2" color="text.secondary">
                                                        ... and {((analysisState.report as any).urlSlugAnalysis.issues?.length || 0) - 2} more
                                                    </Typography>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                )}
                            </Grid>

                            <Alert severity="info" sx={{ mb: 4 }}>
                                See full report for complete details on all findings and recommendations.
                            </Alert>
                        </CollapsibleCard>

                        {/* Top Recommendations */}
                        <CollapsibleCard title="Top Recommendations" defaultExpanded={false} color="info">
                            <Grid container spacing={2}>
                                {(() => {
                                    // Flatten all recommendations from all dimensions
                                    const allRecs = Object.entries(analysisState.report.dimensions)
                                        .flatMap(([dim, result]) => (result.recommendations || []).map(rec => ({ ...rec, dimension: dim })));

                                    // Take top 5
                                    const top5 = allRecs.slice(0, 5);

                                    return top5.map((rec: any, i: number) => {
                                        const recId = `${rec.dimension}-${i}`;

                                        return (
                                            <Grid item xs={12} key={recId}>
                                                <Paper
                                                    variant="outlined"
                                                    sx={{
                                                        p: 2,
                                                        borderRadius: 2,
                                                        display: 'flex',
                                                        alignItems: 'flex-start',
                                                    }}
                                                >
                                                    <Box sx={{
                                                        width: 28,
                                                        height: 28,
                                                        borderRadius: '50%',
                                                        bgcolor: 'rgba(59, 130, 246, 0.12)',
                                                        color: 'var(--accent-primary)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 700,
                                                        flexShrink: 0,
                                                        mt: 0.25,
                                                    }}>
                                                        {i + 1}
                                                    </Box>
                                                    <Box sx={{ ml: 1.5, flexGrow: 1 }}>
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                                {rec.action}
                                                            </Typography>
                                                            <Chip
                                                                label={rec.dimension}
                                                                size="small"
                                                                variant="outlined"
                                                                sx={{ height: 20, fontSize: '0.65rem', textTransform: 'uppercase' }}
                                                            />
                                                        </Box>
                                                        <Typography variant="caption" color="text.secondary">
                                                            Priority: {rec.priority?.toUpperCase()} • Impact: {rec.impact}
                                                        </Typography>
                                                    </Box>
                                                </Paper>
                                            </Grid>
                                        );
                                    });
                                })()}
                            </Grid>
                        </CollapsibleCard>

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
                            <Typography variant="body2" color="text.secondary">
                                Analysis completed in {(analysisState.report.analysisTime / 1000).toFixed(1)}s
                                {analysisState.report.cacheStatus === 'hit' && ' ⚡ (cached)'}
                            </Typography>
                            <Button
                                variant="outlined"
                                onClick={() => exportPdfReport(analysisState.report!)}
                                sx={{ ml: 2 }}
                            >
                                Export Report (PDF)
                            </Button>

                            {!analysisState.report.sitemapHealth && (
                                <Button
                                    variant="contained"
                                    color="secondary"
                                    onClick={handleGenerateFixes}
                                    disabled={isGeneratingFixes || isApplyingFixes}
                                    startIcon={isGeneratingFixes ? <CircularProgress size={20} color="inherit" /> : <AutoFixHighIcon />}
                                    sx={{ ml: 2 }}
                                >
                                    {isGeneratingFixes ? 'Generating Fixes...' : 'Generate Auto-Fixes'}
                                </Button>
                            )}
                        </Box>

                        {showFixPanel && (
                            <FixReviewPanel
                                fixes={fixes}
                                onApplyFixes={handleApplyFixes}
                                isApplying={isApplyingFixes}
                            />
                        )}
                    </Paper>
                )}
            </Container>
        </div >
    );
}

export default LensyApp;
