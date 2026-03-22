import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import './index.css';

const theme = createTheme({
    palette: {
        mode: 'dark', // MUI base mode — CSS custom properties in index.css handle actual theme switching
        primary: {
            main: '#3b82f6',
        },
        background: {
            default: '#0a0a0a',
            paper: '#111111',
        },
        text: {
            primary: '#fafafa',
            secondary: '#e5e7eb',
        },
        divider: '#1f1f1f',
    },
    typography: {
        fontFamily: '"Plus Jakarta Sans", "DM Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        h1: {
            fontWeight: 700,
            letterSpacing: '-0.02em',
        },
        h2: {
            fontWeight: 700,
            letterSpacing: '-0.01em',
        },
        h3: {
            fontWeight: 700,
            letterSpacing: '-0.01em',
        },
        h4: {
            fontWeight: 600,
        },
        h5: {
            fontWeight: 600,
        },
        h6: {
            fontWeight: 600,
        },
        body1: {
            fontWeight: 400,
        },
        body2: {
            fontWeight: 400,
        },
    },
    components: {
        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundColor: 'var(--header-bg)',
                    backdropFilter: 'blur(12px)',
                    borderBottom: '1px solid var(--border-subtle)',
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    textTransform: 'none',
                    fontWeight: 500,
                },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: 16,
                    fontWeight: 500,
                },
            },
        },
        MuiTextField: {
            styleOverrides: {
                root: {
                    '& .MuiOutlinedInput-root': {
                        borderRadius: 8,
                    },
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