import React, { useState, useEffect, useRef } from 'react';
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
    const [analysisState, setAnalysisState] = useState<AnalysisState>({
        status: 'idle',
        progressMessages: []
    });
    const [progressExpanded, setProgressExpanded] = useState(true);
    const wsRef = useRef<WebSocket | null>(null);
    const progressEndRef = useRef<HTMLDivElement>(null);

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

    const handleAnalyze = async () => {
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

        setAnalysisState({ status: 'analyzing', progressMessages: [] });

        const sessionId = `session-${Date.now()}`;
        const analysisRequest: AnalysisRequest = {
            url,
            selectedModel,
            sessionId,
            contextAnalysis: contextAnalysisEnabled ? {
                enabled: true,
                maxContextPages: 5
            } : undefined,
            cacheControl: {
                enabled: cacheEnabled
            }
        };

        try {
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

    const exportMarkdownReport = (report: FinalReport) => {
        const analysisDate = new Date().toLocaleDateString();

        let markdown = `# DOCUMENTATION QUALITY REPORT\n\n`;
        markdown += `**URL:** ${url}\n`;
        markdown += `**Analyzed:** ${analysisDate}\n`;
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

        markdown += `---\n\n`;
        markdown += `*Report generated by Lensy Documentation Quality Auditor*\n`;
        markdown += `*Analysis model: ${report.modelUsed}*\n`;
        markdown += `*Analysis time: ${(report.analysisTime / 1000).toFixed(1)}s*\n`;

        // Create and download file
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url_obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url_obj;
        a.download = `documentation-quality-report-${new Date().toISOString().split('T')[0]}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url_obj);
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
                        <TextField
                            fullWidth
                            label="Documentation URL"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://developer.wordpress.org/..."
                            sx={{ mb: 3 }}
                            disabled={analysisState.status === 'analyzing'}
                        />

                        <FormControl fullWidth sx={{ mb: 3 }}>
                            <InputLabel>AI Model</InputLabel>
                            <Select
                                value={selectedModel}
                                label="AI Model"
                                onChange={(e) => setSelectedModel(e.target.value as any)}
                                disabled={analysisState.status === 'analyzing'}
                            >
                                <MenuItem value="claude">Claude 3.5 Sonnet</MenuItem>
                            </Select>
                        </FormControl>

                        <Grid container spacing={2} sx={{ mb: 3 }}>
                            <Grid item xs={12} md={6}>
                                <Card sx={{ bgcolor: 'grey.50', height: '100%' }}>
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
                                                    disabled={analysisState.status === 'analyzing'}
                                                />
                                            }
                                            label="Include related pages"
                                        />
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                            Analyze parent, child, and sibling pages for better context
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>

                            <Grid item xs={12} md={6}>
                                <Card sx={{ bgcolor: 'grey.50', height: '100%' }}>
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
                                'Start Analysis'
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

                        {/* Critical Findings Section */}
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
