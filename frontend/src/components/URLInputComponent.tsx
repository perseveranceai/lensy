import React, { useState } from 'react';
import {
    Paper,
    TextField,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Box,
    Typography,
    Alert,
} from '@mui/material';
import { SelectChangeEvent } from '@mui/material/Select';

interface URLInputComponentProps {
    onSubmit?: (url: string, model: string) => void;
}

const URLInputComponent: React.FC<URLInputComponentProps> = ({ onSubmit }) => {
    const [url, setUrl] = useState('');
    const [selectedModel, setSelectedModel] = useState('auto');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const availableModels = [
        { value: 'auto', label: 'Auto (Recommended)', description: 'Automatically select the best model for your content' },
        { value: 'claude', label: 'Claude 3.5 Sonnet', description: 'Best for code analysis and technical accuracy' },
        { value: 'titan', label: 'Amazon Titan Text Premier', description: 'Optimized for comprehensive analysis' },
        { value: 'llama', label: 'Meta Llama 3.1 70B', description: 'Strong at context understanding' },
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Basic URL validation
        try {
            new URL(url);
        } catch {
            setError('Please enter a valid URL');
            return;
        }

        setIsAnalyzing(true);

        try {
            if (onSubmit) {
                await onSubmit(url, selectedModel);
            } else {
                // Placeholder for actual API call
                console.log('Analyzing:', { url, model: selectedModel });
                setTimeout(() => {
                    setIsAnalyzing(false);
                }, 2000);
            }
        } catch (err) {
            setError('Failed to start analysis. Please try again.');
            setIsAnalyzing(false);
        }
    };

    const handleModelChange = (event: SelectChangeEvent) => {
        setSelectedModel(event.target.value);
    };

    return (
        <Paper elevation={3} sx={{ p: 4, mb: 4 }}>
            <Typography variant="h5" component="h2" gutterBottom>
                Start Documentation Analysis
            </Typography>

            <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
                <TextField
                    fullWidth
                    label="Documentation URL"
                    placeholder="https://developer.wordpress.org/block-editor/"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isAnalyzing}
                    sx={{ mb: 3 }}
                    helperText="Enter the URL of the documentation you want to analyze"
                />

                <FormControl fullWidth sx={{ mb: 3 }}>
                    <InputLabel id="model-select-label">AI Model</InputLabel>
                    <Select
                        labelId="model-select-label"
                        value={selectedModel}
                        label="AI Model"
                        onChange={handleModelChange}
                        disabled={isAnalyzing}
                    >
                        {availableModels.map((model) => (
                            <MenuItem key={model.value} value={model.value}>
                                <Box>
                                    <Typography variant="body1">{model.label}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {model.description}
                                    </Typography>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={!url || isAnalyzing}
                    fullWidth
                    sx={{ py: 1.5 }}
                >
                    {isAnalyzing ? 'Analyzing Documentation...' : 'Analyze Documentation'}
                </Button>
            </Box>

            {isAnalyzing && (
                <Box sx={{ mt: 3 }}>
                    <Alert severity="info">
                        Analysis started! This may take a few minutes depending on the documentation size.
                    </Alert>
                </Box>
            )}
        </Paper>
    );
};

export default URLInputComponent;