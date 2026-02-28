import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Tool 1: Detect Input Type
 * Ported from: input-type-detector/index.ts (123 lines)
 *
 * Determines if a URL is a doc page or sitemap.xml.
 * Supports manual override from frontend.
 */
export const detectInputTypeTool = tool(
    async (input): Promise<string> => {
        console.log('detect_input_type: Analyzing URL:', input.url);

        let inputType: 'doc' | 'sitemap';
        let confidence: number;
        let detectionReason: string;

        if (input.manualOverride) {
            // Frontend explicitly set the mode
            inputType = input.manualOverride as 'doc' | 'sitemap';
            confidence = 1.0;
            detectionReason = `Manual selection: ${inputType} mode`;
            console.log(`Using manual override: ${inputType}`);
        } else if (input.url.toLowerCase().includes('sitemap.xml')) {
            // URL contains sitemap.xml
            inputType = 'sitemap';
            confidence = 1.0;
            detectionReason = 'URL contains sitemap.xml';
            console.log('Sitemap detected: URL contains sitemap.xml');
        } else {
            // Default to doc mode
            inputType = 'doc';
            confidence = 1.0;
            detectionReason = 'Standard documentation URL (no sitemap.xml detected)';
            console.log('Doc mode: No sitemap.xml detected');
        }

        const result = {
            success: true,
            inputType,
            confidence,
            detectionReason,
            message: `Detected ${inputType} mode`
        };

        return JSON.stringify(result);
    },
    {
        name: 'detect_input_type',
        description: 'Determines if a URL is a documentation page or a sitemap.xml. Call this FIRST before any other tool. Returns the input type (doc or sitemap) with confidence score.',
        schema: z.object({
            url: z.string().describe('The URL to analyze'),
            manualOverride: z.string().optional().describe('Optional manual mode override from frontend: "doc" or "sitemap"')
        })
    }
);
