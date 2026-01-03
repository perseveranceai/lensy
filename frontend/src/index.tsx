import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';

const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#60a5fa', // Soft blue for primary actions
        },
        secondary: {
            main: '#f472b6', // Soft pink for secondary actions
        },
        background: {
            default: '#0f172a', // Deep dark blue-gray background
            paper: '#1e293b',   // Slightly lighter for cards/papers
        },
        text: {
            primary: '#f1f5f9',   // Very light gray for primary text
            secondary: '#cbd5e1', // Medium light gray for secondary text
        },
        success: {
            main: '#34d399', // Soft green
        },
        warning: {
            main: '#fbbf24', // Soft amber
        },
        error: {
            main: '#f87171', // Soft red
        },
        info: {
            main: '#60a5fa', // Soft blue
        },
    },
    typography: {
        fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
        h1: {
            color: '#f1f5f9',
        },
        h2: {
            color: '#f1f5f9',
        },
        h3: {
            color: '#f1f5f9',
        },
        h4: {
            color: '#f1f5f9',
        },
        h5: {
            color: '#f1f5f9',
        },
        h6: {
            color: '#f1f5f9',
        },
        body1: {
            color: '#e2e8f0',
        },
        body2: {
            color: '#cbd5e1',
        },
    },
    components: {
        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundColor: '#1e293b',
                    color: '#f1f5f9',
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundColor: '#1e293b',
                    borderRadius: 12,
                    border: '1px solid #334155',
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundColor: '#1e293b',
                    color: '#f1f5f9',
                },
            },
        },
        MuiTextField: {
            styleOverrides: {
                root: {
                    '& .MuiOutlinedInput-root': {
                        color: '#f1f5f9',
                        '& fieldset': {
                            borderColor: '#475569',
                        },
                        '&:hover fieldset': {
                            borderColor: '#60a5fa',
                        },
                        '&.Mui-focused fieldset': {
                            borderColor: '#60a5fa',
                        },
                    },
                    '& .MuiInputLabel-root': {
                        color: '#cbd5e1',
                    },
                },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    backgroundColor: '#334155',
                    color: '#f1f5f9',
                },
            },
        },
        MuiAlert: {
            styleOverrides: {
                root: {
                    backgroundColor: '#1e293b',
                    color: '#f1f5f9',
                    border: '1px solid #334155',
                },
            },
        },
    },
});

const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);

root.render(
    <React.StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
        </ThemeProvider>
    </React.StrictMode>
);