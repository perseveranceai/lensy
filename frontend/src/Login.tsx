import React, { useState } from 'react';
import { 
    Box, 
    Container, 
    TextField, 
    Button, 
    Typography, 
    Paper,
    Alert,
    Link,
    Fade,
    InputAdornment,
    IconButton
} from '@mui/material';
import { 
    LockOutlined, 
    Visibility, 
    VisibilityOff,
    Login as LoginIcon 
} from '@mui/icons-material';

// Valid passwords (must match CloudFront Function)
const VALID_PASSWORDS = ['LensyBeta2026!'];

const Login: React.FC = () => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = () => {
        setIsLoading(true);
        setError('');
        
        // Add a slight delay for "premium" feel (smooth transitions)
        setTimeout(() => {
            if (VALID_PASSWORDS.includes(password)) {
                // Set cookie with password:timestamp
                const token = `${password}:${Date.now()}`;
                const maxAge = 48 * 60 * 60; // 48 hours in seconds
                document.cookie = `lensy_access_token=${token}; max-age=${maxAge}; path=/; secure; samesite=strict`;
                
                // Redirect to main app
                window.location.href = '/';
            } else {
                setError('Invalid beta access password.');
                setIsLoading(false);
            }
        }, 800);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleLogin();
        }
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'radial-gradient(circle at 50% 50%, #1a1a1a 0%, #050505 100%)',
                color: 'white',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {/* Subtle background glow */}
            <Box
                sx={{
                    position: 'absolute',
                    width: '600px',
                    height: '600px',
                    borderRadius: '50%',
                    background: 'rgba(76, 175, 80, 0.03)',
                    filter: 'blur(100px)',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 0
                }}
            />

            <Fade in={true} timeout={1000}>
            <Container maxWidth="xs" sx={{ position: 'relative', zIndex: 1 }}>
                <Paper 
                    elevation={0} 
                    sx={{ 
                        p: 5, 
                        bgcolor: 'rgba(20, 20, 20, 0.8)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: 4,
                        boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
                    }}
                >
                    <Box sx={{ textAlign: 'center', mb: 5 }}>
                        <Box
                            sx={{
                                width: 64,
                                height: 64,
                                borderRadius: 2,
                                background: 'linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                mb: 3,
                                boxShadow: '0 8px 16px rgba(76, 175, 80, 0.2)'
                            }}
                        >
                            <LockOutlined sx={{ fontSize: 32, color: 'white' }} />
                        </Box>
                        
                        <Typography variant="h4" fontWeight="700" gutterBottom sx={{ letterSpacing: '-0.5px' }}>
                            Lensy
                        </Typography>
                        <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.5)', mb: 1 }}>
                            Documentation Auditor
                        </Typography>
                        <Box 
                            sx={{ 
                                display: 'inline-block',
                                px: 1.5,
                                py: 0.5,
                                borderRadius: 1,
                                bgcolor: 'rgba(76, 175, 80, 0.1)',
                                border: '1px solid rgba(76, 175, 80, 0.2)'
                            }}
                        >
                            <Typography variant="caption" sx={{ color: '#4CAF50', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                Beta Access
                            </Typography>
                        </Box>
                    </Box>

                    {error && (
                        <Fade in={!!error}>
                            <Alert 
                                severity="error" 
                                variant="filled"
                                sx={{ 
                                    mb: 3, 
                                    bgcolor: 'rgba(211, 47, 47, 0.9)',
                                    borderRadius: 2
                                }}
                            >
                                {error}
                            </Alert>
                        </Fade>
                    )}

                    <TextField
                        fullWidth
                        type={showPassword ? 'text' : 'password'}
                        label="Access Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyPress={handleKeyPress}
                        disabled={isLoading}
                        autoFocus
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={() => setShowPassword(!showPassword)}
                                        edge="end"
                                        sx={{ color: 'rgba(255,255,255,0.3)' }}
                                    >
                                        {showPassword ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                        sx={{ 
                            mb: 4,
                            '& .MuiOutlinedInput-root': {
                                color: 'white',
                                borderRadius: 2,
                                bgcolor: 'rgba(255,255,255,0.02)',
                                '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                                '&.Mui-focused fieldset': { borderColor: '#4CAF50' },
                            },
                            '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.4)' },
                            '& .MuiInputLabel-root.Mui-focused': { color: '#4CAF50' }
                        }}
                    />

                    <Button
                        fullWidth
                        size="large"
                        variant="contained"
                        onClick={handleLogin}
                        disabled={isLoading || !password}
                        startIcon={!isLoading && <LoginIcon />}
                        sx={{ 
                            py: 1.5,
                            borderRadius: 2,
                            bgcolor: '#4CAF50',
                            fontWeight: '600',
                            textTransform: 'none',
                            fontSize: '1.1rem',
                            '&:hover': { bgcolor: '#45a049' },
                            '&.Mui-disabled': { bgcolor: 'rgba(76, 175, 80, 0.3)', color: 'rgba(255,255,255,0.3)' }
                        }}
                    >
                        {isLoading ? 'Verifying...' : 'Unlock Beta Access'}
                    </Button>

                    <Box sx={{ mt: 5, textAlign: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.3)', mb: 1 }}>
                            Need access?
                        </Typography>
                        <Link 
                            href="mailto:hello@perseveranceai.com?subject=Lensy%20Beta%20Access%20Request"
                            underline="none"
                            sx={{ 
                                color: '#4CAF50',
                                fontWeight: '600',
                                '&:hover': { color: '#81c784' },
                                display: 'inline-flex',
                                alignItems: 'center'
                            }}
                        >
                            Contact Perseverance AI
                        </Link>
                    </Box>
                </Paper>

                <Typography 
                    variant="caption" 
                    sx={{ 
                        display: 'block', 
                        textAlign: 'center', 
                        mt: 4,
                        color: 'rgba(255,255,255,0.2)',
                        letterSpacing: '0.5px'
                    }}
                >
                    © 2026 PERSEVERANCE AI. ACCESS EXPIRES EVERY 48 HOURS.
                </Typography>
            </Container>
            </Fade>
        </Box>
    );
};

export default Login;
