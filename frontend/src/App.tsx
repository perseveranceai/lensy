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
        subPagesIdentified: string[];
        linkContext: 'single-page' | 'multi-page-referenced';
        analysisScope: 'current-page-only' | 'with-subpages';
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
            } : undefined
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

                        <Card sx={{ mb: 3, bgcolor: 'grey.50' }}>
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

                        <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
                            Analysis completed in {(analysisState.report.analysisTime / 1000).toFixed(1)}s
                            {analysisState.report.cacheStatus === 'hit' && ' ⚡ (cached)'}
                        </Typography>
                    </Paper>
                )}
            </Container>
        </div>
    );
}

export default App;
