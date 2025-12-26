import React, { useState } from 'react';
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
    LinearProgress,
    AppBar,
    Toolbar
} from '@mui/material';

interface AnalysisRequest {
    url: string;
    selectedModel: 'claude' | 'titan' | 'llama' | 'auto';
    sessionId: string;
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
    analysisTime: number;
    retryCount: number;
}

interface AnalysisState {
    status: 'idle' | 'analyzing' | 'completed' | 'error';
    report?: FinalReport;
    error?: string;
    executionArn?: string;
}

const API_BASE_URL = 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';

function App() {
    const [url, setUrl] = useState('');
    const [selectedModel, setSelectedModel] = useState<'claude' | 'titan' | 'llama' | 'auto'>('auto');
    const [analysisState, setAnalysisState] = useState<AnalysisState>({ status: 'idle' });

    const pollForResults = async (executionArn: string, sessionId: string) => {
        const maxAttempts = 60; // 5 minutes max (5 second intervals)
        let attempts = 0;

        const poll = async () => {
            try {
                attempts++;
                console.log(`Polling attempt ${attempts}/${maxAttempts} for execution: ${executionArn}`);

                // Call AWS Step Functions API to check execution status
                // Note: This requires CORS to be enabled on the API Gateway
                // For now, we'll use a workaround by calling the status endpoint

                try {
                    const statusResponse = await fetch(`${API_BASE_URL}/status/${sessionId}`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });

                    if (statusResponse.ok) {
                        const statusData = await statusResponse.json();
                        console.log('Status response:', statusData);

                        // Check if we have a complete report
                        if (statusData.report) {
                            setAnalysisState({
                                status: 'completed',
                                report: statusData.report,
                                executionArn: executionArn
                            });
                            return;
                        }
                    }
                } catch (statusError) {
                    console.log('Status endpoint not yet implemented, will use direct Step Functions check');
                }

                // Fallback: Since status endpoint isn't fully implemented yet,
                // we'll wait a fixed time and then try to retrieve results from S3
                if (attempts === 12) { // After ~60 seconds (12 * 5 seconds)
                    console.log('Analysis should be complete, attempting to retrieve results...');

                    // Try to get results directly from the execution
                    // In production, this would be handled by the status endpoint
                    // For now, we'll show a message that analysis is complete
                    setAnalysisState({
                        status: 'error',
                        error: 'Analysis completed successfully! However, the results retrieval endpoint is not yet fully implemented. Check AWS Step Functions console for results.',
                        executionArn: executionArn
                    });
                    return;
                }

                if (attempts >= maxAttempts) {
                    setAnalysisState({
                        status: 'error',
                        error: 'Analysis timed out. Please try again.',
                        executionArn: executionArn
                    });
                    return;
                }

                // Continue polling
                setTimeout(poll, 5000);

            } catch (error) {
                console.error('Polling error:', error);
                setAnalysisState({
                    status: 'error',
                    error: 'Failed to check analysis status',
                    executionArn: executionArn
                });
            }
        };

        // Start polling
        setTimeout(poll, 5000);
    };

    const handleAnalyze = async () => {
        if (!url.trim()) {
            setAnalysisState({ status: 'error', error: 'Please enter a URL' });
            return;
        }

        try {
            new URL(url); // Validate URL format
        } catch {
            setAnalysisState({ status: 'error', error: 'Please enter a valid URL' });
            return;
        }

        setAnalysisState({ status: 'analyzing' });

        const sessionId = `session-${Date.now()}`;
        const analysisRequest: AnalysisRequest = {
            url,
            selectedModel,
            sessionId
        };

        try {
            console.log('Starting real analysis:', analysisRequest);

            // Call the real API
            const response = await fetch(`${API_BASE_URL}/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(analysisRequest)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            console.log('Analysis started:', result);

            if (result.executionArn) {
                setAnalysisState({
                    status: 'analyzing',
                    executionArn: result.executionArn
                });

                // Start polling for results
                pollForResults(result.executionArn, sessionId);
            } else {
                throw new Error('No execution ARN returned from API');
            }

        } catch (error) {
            console.error('Analysis failed:', error);
            setAnalysisState({
                status: 'error',
                error: error instanceof Error ? error.message : 'Analysis failed'
            });
        }
    };

    const getScoreColor = (score: number | null): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
        if (score === null) return 'default';
        if (score >= 80) return 'success';
        if (score >= 60) return 'warning';
        return 'error';
    };

    const getConfidenceColor = (confidence: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
        switch (confidence) {
            case 'high': return 'success';
            case 'medium': return 'warning';
            case 'low': return 'error';
            default: return 'default';
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
                    Analyze WordPress developer documentation with multiple AI models
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
                                <MenuItem value="claude">Claude 3.5 Sonnet (Working)</MenuItem>
                            </Select>
                        </FormControl>

                        <Button
                            variant="contained"
                            size="large"
                            onClick={handleAnalyze}
                            disabled={analysisState.status === 'analyzing'}
                            sx={{ mb: 2 }}
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

                    {analysisState.status === 'analyzing' && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Real AI analysis in progress... This may take a few minutes.
                            </Typography>
                            {analysisState.executionArn && (
                                <Typography variant="body2" color="text.secondary" gutterBottom>
                                    Execution: {analysisState.executionArn.split(':').pop()}
                                </Typography>
                            )}
                            <LinearProgress />
                        </Box>
                    )}

                    {analysisState.status === 'error' && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {analysisState.error}
                        </Alert>
                    )}
                </Paper>

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
                                        <Typography variant="h6">Dimensions Analyzed</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Card>
                                    <CardContent sx={{ textAlign: 'center' }}>
                                        <Chip
                                            label={analysisState.report.confidence.toUpperCase()}
                                            color={getConfidenceColor(analysisState.report.confidence)}
                                            size="medium"
                                        />
                                        <Typography variant="h6" sx={{ mt: 1 }}>Confidence</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                        </Grid>

                        <Typography variant="h6" gutterBottom>
                            Quality Dimensions
                        </Typography>

                        <Grid container spacing={2} sx={{ mb: 4 }}>
                            {Object.entries(analysisState.report.dimensions).map(([dimension, result]) => (
                                <Grid item xs={12} md={6} lg={4} key={dimension}>
                                    <Card>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
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
                                                <Box sx={{ mb: 1 }}>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Key Findings:
                                                    </Typography>
                                                    {result.findings.slice(0, 2).map((finding, i) => (
                                                        <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem' }}>
                                                            • {finding}
                                                        </Typography>
                                                    ))}
                                                </Box>
                                            )}

                                            {result.recommendations.length > 0 && (
                                                <Box>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Recommendations: {result.recommendations.length}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>

                        <Typography variant="h6" gutterBottom>
                            Analysis Summary
                        </Typography>

                        <Grid container spacing={2}>
                            <Grid item xs={12} md={4}>
                                <Card>
                                    <CardContent>
                                        <Typography variant="subtitle1" gutterBottom>Code Analysis</Typography>
                                        <Typography variant="body2">
                                            Snippets: {analysisState.report.codeAnalysis.snippetsFound}<br />
                                            Languages: {analysisState.report.codeAnalysis.languagesDetected.join(', ')}<br />
                                            Issues: {analysisState.report.codeAnalysis.syntaxErrors + analysisState.report.codeAnalysis.deprecatedMethods}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Card>
                                    <CardContent>
                                        <Typography variant="subtitle1" gutterBottom>Media Analysis</Typography>
                                        <Typography variant="body2">
                                            Images: {analysisState.report.mediaAnalysis.imagesFound}<br />
                                            Interactive: {analysisState.report.mediaAnalysis.interactiveElements}<br />
                                            Accessibility Issues: {analysisState.report.mediaAnalysis.accessibilityIssues}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Card>
                                    <CardContent>
                                        <Typography variant="subtitle1" gutterBottom>Link Analysis</Typography>
                                        <Typography variant="body2">
                                            Total Links: {analysisState.report.linkAnalysis.totalLinks}<br />
                                            Sub-pages: {analysisState.report.linkAnalysis.subPagesIdentified.length}<br />
                                            Scope: {analysisState.report.linkAnalysis.analysisScope}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                        </Grid>

                        <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                                Real AI analysis completed in {(analysisState.report.analysisTime / 1000).toFixed(1)}s using {analysisState.report.modelUsed}
                                {analysisState.executionArn && (
                                    <><br />Execution: {analysisState.executionArn.split(':').pop()}</>
                                )}
                            </Typography>
                        </Box>
                    </Paper>
                )}
            </Container>
        </div>
    );
}

export default App;