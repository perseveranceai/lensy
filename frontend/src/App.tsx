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
    IconButton
} from '@mui/material';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import CachedIcon from '@mui/icons-material/Cached';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

interface AnalysisRequest {
    url: string;
    selectedModel: 'claude' | 'titan' | 'llama' | 'auto';
    sessionId: string;
    inputType?: 'doc' | 'sitemap' | 'issue-discovery'; // Add issue-discovery mode
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
        totalUrls: number;
        healthyUrls: number;
        brokenUrls: number;
        accessDeniedUrls: number;
        timeoutUrls: number;
        otherErrorUrls: number;
        healthPercentage: number;
        linkIssues: Array<{
            url: string;
            status: number | string;
            errorMessage: string;
            issueType: '404' | 'access-denied' | 'timeout' | 'error';
        }>;
        processingTime: number;
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
}

interface ProgressMessage {
    type: 'info' | 'success' | 'error' | 'progress' | 'cache-hit' | 'cache-miss';
    message: string;
    timestamp: number;
    phase?: 'url-processing' | 'structure-detection' | 'dimension-analysis' | 'report-generation';
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
    status: 'idle' | 'analyzing' | 'completed' | 'error';
    report?: FinalReport;
    error?: string;
    executionArn?: string;
    progressMessages: ProgressMessage[];
}

const API_BASE_URL = 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';
const WEBSOCKET_URL = 'wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod';

function App() {
    const [url, setUrl] = useState('');
    const [selectedModel, setSelectedModel] = useState<'claude' | 'titan' | 'llama' | 'auto'>('claude');
    const [contextAnalysisEnabled, setContextAnalysisEnabled] = useState(false);
    const [cacheEnabled, setCacheEnabled] = useState(true);
    const [selectedMode, setSelectedMode] = useState<'doc' | 'sitemap' | 'issue-discovery'>('doc');
    const [manualModeOverride, setManualModeOverride] = useState<'doc' | 'sitemap' | 'issue-discovery' | null>(null);
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
    const [analysisState, setAnalysisState] = useState<AnalysisState>({
        status: 'idle',
        progressMessages: []
    });
    const [progressExpanded, setProgressExpanded] = useState(true);
    const wsRef = useRef<WebSocket | null>(null);
    const progressEndRef = useRef<HTMLDivElement>(null);

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

    const connectWebSocket = (sessionId: string): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
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
                    console.log('Progress update:', message);

                    setAnalysisState(prev => ({
                        ...prev,
                        progressMessages: [...prev.progressMessages, message]
                    }));
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
            };

            wsRef.current = ws;
        });
    };

    const pollForResults = async (sessionId: string) => {
        const maxAttempts = 60;
        let attempts = 0;

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

                    if (statusData.report) {
                        if (wsRef.current) {
                            wsRef.current.close();
                        }

                        setAnalysisState(prev => ({
                            ...prev,
                            status: 'completed',
                            report: statusData.report
                        }));
                        return;
                    }
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

    const handleAnalyze = async () => {
        const currentMode = manualModeOverride || selectedMode;

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

        setAnalysisState({ status: 'analyzing', progressMessages: [] });

        const sessionId = `session-${Date.now()}`;
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
                        enabled: cacheEnabled
                    }
                };

                // Connect WebSocket
                try {
                    await connectWebSocket(sessionId);
                } catch (wsError) {
                    console.warn('WebSocket failed, using polling only:', wsError);
                }

                // Start analysis
                const response = await fetch(`${API_BASE_URL}/analyze`, {
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
                    executionArn: result.executionArn
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
        markdown += `*Report generated by Lensy Documentation Quality Auditor*\n`;
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
        if (report.sitemapHealth) {
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
            if (report.sitemapHealth.linkIssues.length > 0) {
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
            } else {
                markdown += `## LINK ISSUES\n\n✓ No broken links found - all URLs are healthy!\n\n`;
            }

        } else {
            // DOC MODE: Original scoring logic
            markdown += `**Overall Score:** ${report.overallScore}/10\n\n`;

            markdown += `## DIMENSION SCORES\n\n`;
            Object.entries(report.dimensions).forEach(([dimension, result]) => {
                markdown += `**${dimension.charAt(0).toUpperCase() + dimension.slice(1)}:** ${result.score || 'N/A'}/10\n`;
            });

            markdown += `\n## CRITICAL FINDINGS\n\n`;

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
        }

        markdown += `---\n\n`;
        markdown += `*Report generated by Lensy Documentation Quality Auditor*\n`;
        markdown += `*Analysis model: ${report.modelUsed}*\n`;
        markdown += `*Analysis time: ${(report.analysisTime / 1000).toFixed(1)}s*\n`;

        // Create and download file
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url_obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url_obj;
        const filename = report.sitemapHealth
            ? `sitemap-health-report-${new Date().toISOString().split('T')[0]}.md`
            : `documentation-quality-report-${new Date().toISOString().split('T')[0]}.md`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        // Delay cleanup to ensure download starts
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url_obj);
        }, 1000);
    };

    return (
        <div className="App">
            <AppBar position="static">
                <Toolbar>
                    <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                        Lensy - Documentation Quality Auditor
                    </Typography>
                </Toolbar>
            </AppBar>

            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Typography variant="h4" component="h1" gutterBottom align="center">
                    AI-Powered Documentation Analysis
                </Typography>

                <Typography variant="subtitle1" align="center" color="text.secondary" sx={{ mb: 4 }}>
                    Real-time analysis with cache-aware streaming
                </Typography>

                <Paper elevation={3} sx={{ p: 4, mb: 4 }}>
                    <Typography variant="h5" gutterBottom>
                        Analyze Documentation
                    </Typography>

                    <Box component="form" sx={{ mt: 2 }}>
                        {/* Mode Selection Dropdown */}
                        <FormControl fullWidth sx={{ mb: 3 }}>
                            <InputLabel>Analysis Mode</InputLabel>
                            <Select
                                value={manualModeOverride || selectedMode}
                                label="Analysis Mode"
                                onChange={(e) => {
                                    const newMode = e.target.value as 'doc' | 'sitemap' | 'issue-discovery';
                                    setManualModeOverride(newMode);
                                    setSelectedMode(newMode);
                                }}
                                disabled={analysisState.status === 'analyzing'}
                            >
                                <MenuItem value="doc">Doc Mode - Individual Page Analysis</MenuItem>
                                <MenuItem value="sitemap">Sitemap Mode - Bulk Link Health Check</MenuItem>
                                <MenuItem value="issue-discovery">Issue Discovery Mode - Real Developer Problems</MenuItem>
                            </Select>
                        </FormControl>

                        {/* Dynamic Fields Based on Selected Mode */}
                        {(manualModeOverride || selectedMode) === 'doc' && (
                            <TextField
                                fullWidth
                                label="Documentation URL"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://developer.wordpress.org/..."
                                sx={{ mb: 3 }}
                                disabled={analysisState.status === 'analyzing'}
                                helperText="Analyze individual documentation page quality across 5 dimensions"
                            />
                        )}

                        {(manualModeOverride || selectedMode) === 'sitemap' && (
                            <TextField
                                fullWidth
                                label="Sitemap URL"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://example.com/sitemap.xml"
                                sx={{ mb: 3 }}
                                disabled={analysisState.status === 'analyzing'}
                                helperText="Analyze entire documentation portal for broken links and developer journeys"
                            />
                        )}

                        {(manualModeOverride || selectedMode) === 'issue-discovery' && (
                            <>
                                <TextField
                                    fullWidth
                                    label="Company Domain"
                                    value={companyDomain}
                                    onChange={(e) => {
                                        setCompanyDomain(e.target.value);
                                        // Clear issues when domain changes
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
                                        // Also trigger search on blur (when user clicks away)
                                        if (companyDomain.trim().length > 3) {
                                            searchForDeveloperIssues(companyDomain.trim());
                                        }
                                    }}
                                    placeholder="resend.com, liveblocks.io, or docs.knock.app"
                                    sx={{ mb: 3 }}
                                    disabled={analysisState.status === 'analyzing'}
                                    helperText="Domain of the documentation portal to investigate (press Tab or Enter to search)"
                                />

                                {/* Dynamic Issues Discovery */}
                                {isSearchingIssues && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                                        <CircularProgress size={20} sx={{ mr: 2 }} />
                                        <Typography variant="body2" color="text.secondary">
                                            Searching for developer complaints online...
                                        </Typography>
                                    </Box>
                                )}

                                {discoveredIssues.length > 0 && (
                                    <Box sx={{ mb: 3 }}>
                                        <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
                                            Top Issues Found ({discoveredIssues.length}) - Select to analyze:
                                        </Typography>
                                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                                            {discoveredIssues.map((issue, index) => (
                                                <Box
                                                    key={issue.id}
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        p: 1.5,
                                                        borderBottom: index < discoveredIssues.length - 1 ? '1px solid' : 'none',
                                                        borderBottomColor: 'divider',
                                                        bgcolor: selectedIssues.includes(issue.id) ? 'primary.dark' : 'background.paper',
                                                        '&:hover': {
                                                            bgcolor: selectedIssues.includes(issue.id) ? 'primary.main' : 'action.hover',
                                                        },
                                                        cursor: 'pointer',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                    onClick={() => {
                                                        if (selectedIssues.includes(issue.id)) {
                                                            setSelectedIssues(selectedIssues.filter(id => id !== issue.id));
                                                        } else {
                                                            setSelectedIssues([...selectedIssues, issue.id]);
                                                        }
                                                    }}
                                                >
                                                    <Switch
                                                        checked={selectedIssues.includes(issue.id)}
                                                        onChange={() => { }} // Handled by parent onClick
                                                        disabled={analysisState.status === 'analyzing'}
                                                        size="small"
                                                        sx={{ mr: 2 }}
                                                    />
                                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                                            <Typography variant="body2" sx={{ fontWeight: 'bold', flex: 1 }}>
                                                                {issue.title}
                                                            </Typography>
                                                            <Chip
                                                                label={`${issue.frequency}`}
                                                                size="small"
                                                                color="primary"
                                                                variant="outlined"
                                                                sx={{ minWidth: 'auto', height: 20, fontSize: '0.7rem' }}
                                                            />
                                                        </Box>
                                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
                                                            {issue.description}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', opacity: 0.7 }}>
                                                            {issue.sources.slice(0, 2).join(', ')}{issue.sources.length > 2 && ` +${issue.sources.length - 2}`}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            ))}
                                        </Box>
                                    </Box>
                                )}

                                {companyDomain.trim().length > 3 && discoveredIssues.length === 0 && !isSearchingIssues && (
                                    <Alert severity="info" sx={{ mb: 3 }}>
                                        No developer issues found for "{companyDomain}". Try a different domain or check the spelling.
                                    </Alert>
                                )}
                            </>
                        )}

                        <FormControl fullWidth sx={{ mb: 3 }}>
                            <InputLabel>AI Model</InputLabel>
                            <Select
                                value={selectedModel}
                                label="AI Model"
                                onChange={(e) => setSelectedModel(e.target.value as any)}
                                disabled={analysisState.status === 'analyzing'}
                            >
                                <MenuItem value="claude">Claude 4.5 Sonnet</MenuItem>
                            </Select>
                        </FormControl>

                        <Grid container spacing={2} sx={{ mb: 3 }}>
                            <Grid item xs={12} md={6}>
                                <Card sx={{ bgcolor: 'background.paper', height: '100%' }}>
                                    <CardContent>
                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                            <AnalyticsIcon sx={{ mr: 1, color: 'primary.main' }} />
                                            <Typography variant="h6">Context Analysis</Typography>
                                        </Box>
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={contextAnalysisEnabled}
                                                    onChange={(e) => setContextAnalysisEnabled(e.target.checked)}
                                                    disabled={analysisState.status === 'analyzing' || (manualModeOverride || selectedMode) !== 'doc'}
                                                />
                                            }
                                            label="Include related pages"
                                        />
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                            {(manualModeOverride || selectedMode) !== 'doc'
                                                ? 'Context analysis only available in Doc Mode'
                                                : 'Analyze parent, child, and sibling pages for better context'
                                            }
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>

                            <Grid item xs={12} md={6}>
                                <Card sx={{ bgcolor: 'background.paper', height: '100%' }}>
                                    <CardContent>
                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                            <CachedIcon sx={{ mr: 1, color: 'primary.main' }} />
                                            <Typography variant="h6">Cache Control</Typography>
                                        </Box>
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={cacheEnabled}
                                                    onChange={(e) => setCacheEnabled(e.target.checked)}
                                                    disabled={analysisState.status === 'analyzing'}
                                                />
                                            }
                                            label="Enable caching"
                                        />
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                            {cacheEnabled
                                                ? 'Results will be cached for faster subsequent analyses'
                                                : '⚠️ Testing mode: Cache disabled - fresh analysis every time'}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                        </Grid>

                        <Button
                            variant="contained"
                            size="large"
                            onClick={handleAnalyze}
                            disabled={analysisState.status === 'analyzing'}
                            fullWidth
                        >
                            {analysisState.status === 'analyzing' ? (
                                <>
                                    <CircularProgress size={20} sx={{ mr: 1 }} />
                                    Analyzing...
                                </>
                            ) : (
                                `Start ${(manualModeOverride || selectedMode) === 'doc' ? 'Documentation' :
                                    (manualModeOverride || selectedMode) === 'sitemap' ? 'Sitemap Health' :
                                        'Issue Discovery'
                                } Analysis`
                            )}
                        </Button>
                    </Box>

                    {analysisState.status === 'error' && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {analysisState.error}
                        </Alert>
                    )}
                </Paper>

                {/* Progress Messages */}
                {analysisState.progressMessages.length > 0 && (
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

                        {/* Sitemap Health Summary (only for sitemap mode) */}
                        {analysisState.report.sitemapHealth && (
                            <>
                                <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
                                    Sitemap Health Summary
                                </Typography>
                                <Grid container spacing={3} sx={{ mb: 4 }}>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" color="primary">
                                                    {analysisState.report.sitemapHealth.totalUrls}
                                                </Typography>
                                                <Typography variant="h6">Total URLs</Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Card>
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
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" color="error.main">
                                                    {analysisState.report.sitemapHealth.brokenUrls}
                                                </Typography>
                                                <Typography variant="h6">Broken (404)</Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Card>
                                            <CardContent sx={{ textAlign: 'center' }}>
                                                <Typography variant="h3" color="warning.main">
                                                    {analysisState.report.sitemapHealth.accessDeniedUrls +
                                                        analysisState.report.sitemapHealth.timeoutUrls +
                                                        analysisState.report.sitemapHealth.otherErrorUrls}
                                                </Typography>
                                                <Typography variant="h6">Other Issues</Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    {analysisState.report.sitemapHealth.accessDeniedUrls} access denied, {' '}
                                                    {analysisState.report.sitemapHealth.timeoutUrls} timeout, {' '}
                                                    {analysisState.report.sitemapHealth.otherErrorUrls} errors
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                </Grid>

                                {/* Expandable Broken URLs List */}
                                {analysisState.report.sitemapHealth.linkIssues.length > 0 && (
                                    <Card sx={{ mb: 4 }}>
                                        <CardContent>
                                            <Typography variant="h6" gutterBottom>
                                                Link Issues Details ({analysisState.report.sitemapHealth.linkIssues.length})
                                            </Typography>
                                            <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                                                {analysisState.report.sitemapHealth.linkIssues.map((issue, index) => (
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

                        {/* Critical Findings Section (only for doc mode) */}
                        {!analysisState.report.sitemapHealth && (
                            <>
                                <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
                                    Critical Findings
                                </Typography>
                                <Grid container spacing={2} sx={{ mb: 4 }}>
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
                                </Grid>

                                <Alert severity="info" sx={{ mb: 4 }}>
                                    See full report for complete details on all findings and recommendations.
                                </Alert>
                            </>
                        )}

                        <Typography variant="h6" gutterBottom>Quality Dimensions</Typography>
                        <Grid container spacing={2} sx={{ mb: 4 }}>
                            {Object.entries(analysisState.report.dimensions).map(([dimension, result]) => (
                                <Grid item xs={12} md={6} lg={4} key={dimension}>
                                    <Card>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                                <Typography variant="h6" sx={{ textTransform: 'capitalize' }}>
                                                    {dimension}
                                                </Typography>
                                                <Chip
                                                    label={result.score || 'N/A'}
                                                    color={getScoreColor(result.score)}
                                                    size="small"
                                                />
                                            </Box>
                                            {result.findings.length > 0 && (
                                                <Typography variant="body2" color="text.secondary">
                                                    {result.findings.slice(0, 2).map((f, i) => (
                                                        <div key={i}>• {f}</div>
                                                    ))}
                                                </Typography>
                                            )}
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
                            <Typography variant="body2" color="text.secondary">
                                Analysis completed in {(analysisState.report.analysisTime / 1000).toFixed(1)}s
                                {analysisState.report.cacheStatus === 'hit' && ' ⚡ (cached)'}
                            </Typography>
                            <Button
                                variant="outlined"
                                onClick={() => exportMarkdownReport(analysisState.report!)}
                                sx={{ ml: 2 }}
                            >
                                Export Report
                            </Button>
                        </Box>
                    </Paper>
                )}
            </Container>
        </div>
    );
}

export default App;
