"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectInputTypeTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
/**
 * Tool 1: Detect Input Type
 * Ported from: input-type-detector/index.ts (123 lines)
 *
 * Determines if a URL is a doc page or sitemap.xml.
 * Supports manual override from frontend.
 */
exports.detectInputTypeTool = (0, tools_1.tool)(async (input) => {
    console.log('detect_input_type: Analyzing URL:', input.url);
    let inputType;
    let confidence;
    let detectionReason;
    if (input.manualOverride) {
        // Frontend explicitly set the mode
        inputType = input.manualOverride;
        confidence = 1.0;
        detectionReason = `Manual selection: ${inputType} mode`;
        console.log(`Using manual override: ${inputType}`);
    }
    else if (input.url.toLowerCase().includes('sitemap.xml')) {
        // URL contains sitemap.xml
        inputType = 'sitemap';
        confidence = 1.0;
        detectionReason = 'URL contains sitemap.xml';
        console.log('Sitemap detected: URL contains sitemap.xml');
    }
    else {
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
}, {
    name: 'detect_input_type',
    description: 'Determines if a URL is a documentation page or a sitemap.xml. Call this FIRST before any other tool. Returns the input type (doc or sitemap) with confidence score.',
    schema: zod_1.z.object({
        url: zod_1.z.string().describe('The URL to analyze'),
        manualOverride: zod_1.z.string().optional().describe('Optional manual mode override from frontend: "doc" or "sitemap"')
    })
});
