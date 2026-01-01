import { Handler } from 'aws-lambda';
import { ProgressPublisher } from './progress-publisher';

interface InputTypeDetectorEvent {
    url: string;
    sessionId: string;
    inputType?: 'doc' | 'sitemap' | 'issue-discovery'; // Allow manual override from frontend
}

interface InputTypeDetectorResponse {
    success: boolean;
    sessionId: string;
    inputType: 'doc' | 'sitemap' | 'issue-discovery';
    confidence: number;
    message: string;
    detectionReason: string;
}

export const handler: Handler<InputTypeDetectorEvent, InputTypeDetectorResponse> = async (event) => {
    console.log('Detecting input type for URL:', event.url);
    console.log('Manual input type override:', event.inputType);

    // Initialize progress publisher
    const progress = new ProgressPublisher(event.sessionId);

    try {
        // Send initial progress
        await progress.progress('Detecting input type...', 'url-processing');

        let detectionResult: DetectionResult;

        // Check if frontend provided manual override
        if (event.inputType) {
            console.log(`Using manual input type: ${event.inputType}`);
            detectionResult = {
                inputType: event.inputType,
                confidence: 1.0,
                detectionReason: `Manual selection: ${event.inputType} mode`
            };
        } else {
            // Perform automatic detection
            detectionResult = detectInputType(event.url);
        }

        // Send detection result message
        await progress.success(`Input type: ${detectionResult.inputType} (${Math.round(detectionResult.confidence * 100)}% confidence)`, {
            inputType: detectionResult.inputType,
            confidence: detectionResult.confidence,
            detectionReason: detectionResult.detectionReason
        });

        console.log(`Input type detected: ${detectionResult.inputType} (confidence: ${detectionResult.confidence})`);
        console.log(`Detection reason: ${detectionResult.detectionReason}`);

        return {
            success: true,
            sessionId: event.sessionId,
            inputType: detectionResult.inputType,
            confidence: detectionResult.confidence,
            message: `Detected ${detectionResult.inputType} mode`,
            detectionReason: detectionResult.detectionReason
        };

    } catch (error) {
        console.error('Input type detection failed:', error);

        await progress.error('Input type detection failed, defaulting to doc mode');

        // Default to doc mode on error for backward compatibility
        return {
            success: true, // Still successful, just defaulted
            sessionId: event.sessionId,
            inputType: 'doc',
            confidence: 0.5,
            message: 'Defaulted to doc mode due to detection error',
            detectionReason: 'Error fallback'
        };
    }
};

interface DetectionResult {
    inputType: 'doc' | 'sitemap' | 'issue-discovery';
    confidence: number;
    detectionReason: string;
}

/**
 * Detect input type based on URL patterns
 * Requirements: 28.1, 28.2, 28.3, 28.8
 * Simplified per user feedback: Just check if URL contains "sitemap.xml"
 */
function detectInputType(url: string): DetectionResult {
    try {
        console.log(`Analyzing URL: ${url}`);

        // Simple check: if URL contains "sitemap.xml" anywhere, it's sitemap mode
        if (url.toLowerCase().includes('sitemap.xml')) {
            console.log('✅ Sitemap detected: URL contains sitemap.xml');
            return {
                inputType: 'sitemap',
                confidence: 1.0,
                detectionReason: 'URL contains sitemap.xml'
            };
        }

        // Default to doc mode for all other URLs (backward compatibility)
        console.log('❌ Doc mode: No sitemap.xml detected');
        return {
            inputType: 'doc',
            confidence: 1.0,
            detectionReason: 'Standard documentation URL (no sitemap.xml detected)'
        };

    } catch (error) {
        console.error('Error parsing URL:', error);
        // Default to doc mode on URL parsing error
        return {
            inputType: 'doc',
            confidence: 1.0,
            detectionReason: 'URL parsing error, defaulted to doc mode'
        };
    }
}