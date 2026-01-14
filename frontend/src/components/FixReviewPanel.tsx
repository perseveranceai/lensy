
import React, { useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    Checkbox,
    IconButton,
    Chip,
    Collapse,
    Grid,
    LinearProgress
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
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
    onApplyFixes: (selectedFixIds: string[]) => void;
    isApplying: boolean;
}

const FixReviewPanel: React.FC<FixReviewPanelProps> = ({ fixes, onApplyFixes, isApplying }) => {
    const [selectedFixIds, setSelectedFixIds] = useState<string[]>([]);
    const [expandedFixId, setExpandedFixId] = useState<string | null>(null);

    // Toggle Selection
    const handleToggleSelect = (id: string) => {
        setSelectedFixIds(prev =>
            prev.includes(id)
                ? prev.filter(fid => fid !== id)
                : [...prev, id]
        );
    };

    // Toggle Expansion
    const handleToggleExpand = (id: string) => {
        setExpandedFixId(prev => (prev === id ? null : id));
    };

    // Bulk Actions
    const handleSelectAll = () => setSelectedFixIds(fixes.map(f => f.id));
    const handleSelectHighConfidence = () => setSelectedFixIds(fixes.filter(f => f.confidence >= 80).map(f => f.id));
    const handleDeselectAll = () => setSelectedFixIds([]);

    const getConfidenceColor = (confidence: number) => {
        if (confidence >= 80) return 'success';
        if (confidence >= 50) return 'warning';
        return 'error';
    };

    return (
        <Paper elevation={3} sx={{ p: 3, mt: 3, borderRadius: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h5" component="h2" gutterBottom>
                    Review Proposed Fixes ({fixes.length})
                </Typography>
                <Box>
                    <Button size="small" onClick={handleSelectAll}>Select All</Button>
                    <Button size="small" onClick={handleSelectHighConfidence}>Select High Conf. (&gt;80%)</Button>
                    <Button size="small" onClick={handleDeselectAll}>Deselect All</Button>
                </Box>
            </Box>

            {isApplying && (
                <Box sx={{ mb: 2 }}>
                    <LinearProgress />
                    <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 1, textAlign: 'center', fontWeight: 'bold' }}>
                        Applying fixes and purging CloudFront cache... This may take a moment.
                    </Typography>
                </Box>
            )}

            <List>
                {fixes.map((fix) => (
                    <Paper key={fix.id} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                        <ListItem
                            button
                            onClick={() => handleToggleExpand(fix.id)}
                            alignItems="flex-start"
                        >
                            <Checkbox
                                edge="start"
                                checked={selectedFixIds.includes(fix.id)}
                                tabIndex={-1}
                                disableRipple
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleSelect(fix.id);
                                }}
                            />
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

            <Box mt={3} display="flex" justifyContent="flex-end" gap={2}>
                <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                    {selectedFixIds.length} fixes selected
                </Typography>
                <Button
                    variant="contained"
                    color="primary"
                    disabled={selectedFixIds.length === 0 || isApplying}
                    onClick={() => onApplyFixes(selectedFixIds)}
                    startIcon={isApplying ? undefined : <CheckCircleIcon />}
                >
                    {isApplying ? 'Applying Fixes...' : 'Apply Selected Fixes'}
                </Button>
            </Box>
        </Paper>
    );
}

export default FixReviewPanel;
