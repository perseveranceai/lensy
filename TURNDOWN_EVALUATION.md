# Turndown Library Evaluation - Noise Reduction Comparison

## Executive Summary

**Recommendation: ✅ Adopt Turndown with noise reduction pipeline**

The Turndown library with proper HTML cleaning provides **98% size reduction** and **100% noise elimination** compared to basic HTML-to-Markdown conversion.

## Test Results

### Test URL
`https://developer.wordpress.org/plugins/intro/`

### Metrics Comparison

| Metric | Current (Basic) | Turndown + Cleaning | Improvement |
|--------|----------------|---------------------|-------------|
| **Output Size** | 106,225 chars | 1,701 chars | **98% reduction** |
| **CSS Blocks** | 597 | 0 | **100% elimination** |
| **Script Functions** | 3 | 0 | **100% elimination** |
| **Lines** | 229 | 23 | **90% reduction** |
| **HTML Input** | 174,465 chars | 4,058 chars (cleaned) | **98% pre-reduction** |

## Quality Comparison

### Current Output (Basic Turndown)
```markdown
Introduction to Plugin Development – Plugin Handbook | Developer.WordPress.org                 
(function(w,d,s,l,i){w\[l\]=w\[l\]||\[\];w\[l\].push({'gtm.start': new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)\[0\], j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src= 'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f); })(window,document,'script','dataLayer','GTM-P24PF4B'); img:is(\[sizes=auto i\],\[sizes^="auto," i\])...
```

**Issues:**
- ❌ Full of CSS styling rules
- ❌ JavaScript tracking code included
- ❌ Navigation and footer content
- ❌ 106KB of mostly noise
- ❌ Difficult for AI to parse

### Turndown with Noise Reduction
```markdown
# Introduction to Plugin Development

Welcome to the Plugin Developer Handbook. Whether you're writing your first plugin or your fiftieth, we hope this resource helps you write the best plugin possible.

The Plugin Developer Handbook covers a variety of topics — everything from what should be in the plugin header, to security best practices, to tools you can use to build your plugin...

## Why We Make Plugins

If there's one cardinal rule in WordPress development, it's this: **Don't touch WordPress core**...
```

**Benefits:**
- ✅ Clean, readable content
- ✅ Proper heading hierarchy
- ✅ No CSS or JavaScript noise
- ✅ Only 1.7KB of actual content
- ✅ Perfect for AI analysis

## Implementation Strategy

### Phase 1: Update URL Processor Lambda

The preprocessing pipeline from `lensy-pipeline-v2.md` provides the complete implementation:

1. **Noise Removal** - Remove `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, etc.
2. **Content Extraction** - Use JSDOM to select main content area
3. **Turndown Conversion** - Convert clean HTML to Markdown with GFM support
4. **Custom Rules** - Handle code blocks, callouts, and WordPress-specific elements

### WordPress-Specific Noise Selectors
```javascript
const WP_NOISE_SELECTORS = [
  '.site-header',
  '.site-footer', 
  '#secondary',
  '.navigation',
  '.breadcrumb',
  '.edit-link',
  '.post-navigation',
  '#wporg-header',
  '#wporg-footer',
  '.wp-block-wporg-sidebar-container',
  '.wp-block-social-links'
];
```

### Key Features to Add

1. **GFM Plugin** - Tables, strikethrough, task lists
2. **Code Block Enhancement** - Language detection from class names
3. **Callout Support** - Convert WordPress notices to Markdown blockquotes
4. **Link Normalization** - Preserve internal/external link context

## Benefits for AI Analysis

### Token Efficiency
- **Before:** 106KB → ~26,500 tokens (at 4 chars/token)
- **After:** 1.7KB → ~425 tokens
- **Savings:** 98% fewer tokens = lower cost, faster analysis

### Analysis Quality
- **Cleaner Input:** AI focuses on actual content, not CSS/JS
- **Better Scores:** Relevance and clarity scores more accurate
- **Faster Processing:** Less data to analyze per dimension
- **Improved Recommendations:** Based on real content, not noise

## Implementation Checklist

- [ ] Install dependencies in backend Lambda layer
  - `turndown@^7.1.2`
  - `turndown-plugin-gfm@^1.0.2`
  - `jsdom@^23.0.0` (already installed)

- [ ] Update `backend/lambda/url-processor/index.ts`
  - Add noise removal before conversion
  - Configure Turndown with GFM plugin
  - Add custom rules for code blocks and callouts
  - Add WordPress-specific selectors

- [ ] Test with multiple WordPress URLs
  - API documentation
  - Tutorial content
  - Reference pages
  - Plugin handbook

- [ ] Update dimension analyzer prompts
  - Adjust for cleaner input
  - Remove CSS/JS noise handling logic
  - Focus on content quality

- [ ] Deploy and validate
  - Compare analysis quality before/after
  - Verify token usage reduction
  - Check dimension scores accuracy

## Files to Review

1. **Pipeline Reference:** `about-me-docs/lensy-pipeline-v2.md`
2. **Current Implementation:** `backend/lambda/url-processor/index.ts`
3. **Test Script:** `test-turndown-comparison.js`
4. **Output Samples:** 
   - `output-basic-turndown.md` (current approach)
   - `output-clean-turndown.md` (proposed approach)

## Recommendation

**Proceed with Turndown + noise reduction implementation immediately.** The 98% size reduction and 100% noise elimination will dramatically improve:

1. AI analysis quality
2. Token efficiency (cost savings)
3. Processing speed
4. Recommendation accuracy

This is a high-impact, low-risk improvement that aligns perfectly with the preprocessing pipeline design in `lensy-pipeline-v2.md`.
