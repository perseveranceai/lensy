/**
 * Shared type definitions for the Lensy agent handler.
 * These mirror the existing Lambda event/response interfaces
 * to maintain compatibility with the S3 artifact format.
 */

// ─── Agent State ──────────────────────────────────────────────

export interface AgentInput {
    url: string;
    sessionId: string;
    selectedModel: string;
    analysisStartTime: number;
    contextAnalysis?: {
        enabled: boolean;
        maxContextPages?: number;
    };
    cacheControl?: {
        enabled: boolean;
    };
}

// ─── Input Type Detection ─────────────────────────────────────

export type InputType = 'doc' | 'sitemap' | 'issue-discovery';

export interface InputTypeResult {
    inputType: InputType;
    confidence: number;
    message: string;
}

// ─── URL Processing ───────────────────────────────────────────

export interface ProcessedContent {
    url: string;
    title: string;
    markdown: string;
    wordCount: number;
    links: LinkInfo[];
    codeSnippets: CodeSnippet[];
    mediaElements: MediaElement[];
    contextAnalysis?: ContextAnalysis;
    urlSlugAnalysis?: UrlSlugAnalysis;
    cacheStatus: 'hit' | 'miss';
}

export interface LinkInfo {
    url: string;
    text: string;
    isExternal: boolean;
    status?: number;
    isAccessible?: boolean;
}

export interface CodeSnippet {
    language: string;
    code: string;
    lineCount: number;
    analysis?: {
        hasDeprecatedMethods: boolean;
        deprecatedMethods?: string[];
        hasSyntaxErrors: boolean;
        syntaxErrors?: string[];
    };
}

export interface MediaElement {
    type: 'image' | 'video' | 'iframe' | 'interactive';
    src: string;
    alt?: string;
    hasAltText: boolean;
}

export interface ContextAnalysis {
    parentPage?: { url: string; title: string };
    childPages: { url: string; title: string }[];
    siblingPages: { url: string; title: string }[];
}

export interface UrlSlugAnalysis {
    slug: string;
    issues: UrlSlugIssue[];
    score: number;
}

export interface UrlSlugIssue {
    segment: string;
    issue: string;
    suggestion: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

// ─── Structure Detection ──────────────────────────────────────

export type DocumentationType =
    | 'api-reference'
    | 'tutorial'
    | 'conceptual'
    | 'how-to'
    | 'reference'
    | 'troubleshooting'
    | 'changelog'
    | 'getting-started'
    | 'product-guide'
    | 'mixed';

export interface StructureResult {
    documentationType: DocumentationType;
    isMultiTopic: boolean;
    topics: string[];
    confidence: number;
}

// ─── AI Readiness ─────────────────────────────────────────────

export interface AIReadinessResult {
    score: number;
    hasLlmsTxt: boolean;
    hasLlmsFullTxt: boolean;
    robotsTxtAIDirectives: {
        botName: string;
        allowed: boolean;
    }[];
    hasJsonLd: boolean;
    hasMarkdownExport: boolean;
    recommendations: string[];
}

// ─── Dimension Analysis ───────────────────────────────────────

export interface DimensionScores {
    relevance: DimensionDetail;
    freshness: DimensionDetail;
    clarity: DimensionDetail;
    accuracy: DimensionDetail;
    completeness: DimensionDetail;
    overall: number;
    documentationType: DocumentationType;
    weights: Record<string, number>;
}

export interface DimensionDetail {
    score: number;
    weight: number;
    weightedScore: number;
    findings: string[];
    issues: DimensionIssue[];
}

export interface DimensionIssue {
    type: string;
    severity: 'high' | 'medium' | 'low';
    description: string;
    suggestion?: string;
}

// ─── Sitemap Health ───────────────────────────────────────────

export interface SitemapHealthResult {
    found: boolean;
    sitemapUrl?: string;
    totalUrls: number;
    healthPercentage: number;
    issues: SitemapIssue[];
    urlStatuses: { url: string; status: number; accessible: boolean }[];
}

export interface SitemapIssue {
    url: string;
    status: number;
    category: 'broken' | 'access-denied' | 'timeout' | 'error';
}

// ─── Final Report ─────────────────────────────────────────────

export interface FinalReport {
    sessionId: string;
    url: string;
    analysisMode: 'doc' | 'sitemap';
    timestamp: number;
    duration: number;
    overallScore: number;
    dimensions?: DimensionScores;
    structure?: StructureResult;
    aiReadiness?: AIReadinessResult;
    sitemapHealth?: SitemapHealthResult;
    codeAnalysis?: {
        totalSnippets: number;
        languages: string[];
        deprecatedMethods: string[];
        syntaxErrors: string[];
    };
    mediaAnalysis?: {
        totalImages: number;
        totalVideos: number;
        missingAltText: number;
    };
    linkAnalysis?: {
        totalLinks: number;
        internalLinks: number;
        externalLinks: number;
        brokenLinks: number;
    };
    contextAnalysis?: ContextAnalysis;
    urlSlugAnalysis?: UrlSlugAnalysis;
    cacheStatus: 'hit' | 'miss' | 'partial';
    status: 'completed' | 'partial' | 'error';
    errors?: string[];
}
