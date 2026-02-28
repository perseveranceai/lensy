
import React, { useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Chip,
    Collapse,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

// --- Types (Should be shared, but defining here for now as shared types location is unclear) ---

export type FixCategory = 'CODE_UPDATE' | 'LINK_FIX' | 'CONTENT_ADDITION' | 'VERSION_UPDATE' | 'FORMATTING_FIX';

export interface Fix {
    id: string;
    sessionId: string;
    documentUrl: string;
    category: FixCategory;
    originalContent: string;
    proposedContent: string;
    lineStart: number;
    lineEnd: number;
    confidence: number;
    rationale: string;
    status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'FAILED';
}

// --- Component Props ---

interface FixReviewPanelProps {
    fixes: Fix[];
    onApplyFixes?: (selectedFixIds: string[]) => void;
    isApplying?: boolean;
}

const FixReviewPanel: React.FC<FixReviewPanelProps> = ({ fixes }) => {
    const [expandedFixId, setExpandedFixId] = useState<string | null>(null);

    // Toggle Expansion
    const handleToggleExpand = (id: string) => {
        setExpandedFixId(prev => (prev === id ? null : id));
    };

    const getConfidenceColor = (confidence: number) => {
        if (confidence >= 80) return 'success';
        if (confidence >= 50) return 'warning';
        return 'error';
    };

    return (
        <Paper elevation={3} sx={{ p: 3, mt: 3, borderRadius: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h5" component="h2" gutterBottom>
                    Proposed Fixes ({fixes.length})
                </Typography>
            </Box>

            <List>
                {fixes.map((fix) => (
                    <Paper key={fix.id} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                        <ListItem
                            button
                            onClick={() => handleToggleExpand(fix.id)}
                            alignItems="flex-start"
                        >
                            <ListItemText
                                primary={
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <Chip
                                            label={fix.category.replace('_', ' ')}
                                            size="small"
                                            color="primary"
                                            variant="outlined"
                                        />
                                        <Typography variant="subtitle1" component="span">
                                            {fix.rationale}
                                        </Typography>
                                    </Box>
                                }
                                secondary={
                                    <Box component="div" display="flex" alignItems="center" gap={2} mt={0.5}>
                                        <Typography variant="caption" color="text.secondary" component="span">
                                            Lines: {fix.lineStart} - {fix.lineEnd}
                                        </Typography>
                                        <Chip
                                            label={`${fix.confidence}% Confidence`}
                                            size="small"
                                            color={getConfidenceColor(fix.confidence)}
                                            sx={{ height: 20, fontSize: '0.7rem' }}
                                        />
                                    </Box>
                                }
                                secondaryTypographyProps={{ component: 'div' }}
                            />
                            <ListItemSecondaryAction>
                                <IconButton edge="end" onClick={() => handleToggleExpand(fix.id)}>
                                    {expandedFixId === fix.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                </IconButton>
                            </ListItemSecondaryAction>
                        </ListItem>

                        <Collapse in={expandedFixId === fix.id} timeout="auto" unmountOnExit>
                            <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderTop: '1px solid #e0e0e0' }}>
                                <Typography variant="subtitle2" gutterBottom>Diff Preview:</Typography>
                                <Box sx={{
                                    maxHeight: 300,
                                    overflow: 'auto',
                                    border: '1px solid #ccc',
                                    borderRadius: 1,
                                    bgcolor: '#fff'
                                }}>
                                    <ReactDiffViewer
                                        oldValue={fix.originalContent}
                                        newValue={fix.proposedContent}
                                        splitView={true}
                                        compareMethod={DiffMethod.WORDS}
                                        styles={{
                                            variables: {
                                                light: {
                                                    diffViewerCreateClass: {
                                                        fontSize: '12px'
                                                    }
                                                }
                                            }
                                        }}
                                    />
                                </Box>
                            </Box>
                        </Collapse>
                    </Paper>
                ))}
            </List>

        </Paper>
    );
}

export default FixReviewPanel;
