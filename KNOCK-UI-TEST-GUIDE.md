# Knock.app UI Testing Guide

## 🚀 Quick Start

### 1. Start the Frontend
```bash
cd frontend
npm start
```

The app will open at http://localhost:3000

### 2. Test Knock Issue Discovery

1. **Select Mode:** Click "Issue Discovery" tab
2. **Enter Domain:** Type `knock.app` in the domain field
3. **Search:** Press Tab or Enter to trigger search
4. **Wait:** ~1 second for issue discovery
5. **Expected Result:** 2 Knock issues should appear:
   - "Knock notification service not working when triggered by cron job in NextJS"
   - "Knock notifications work in development but fail in production with enhanced security mode"

### 3. Validate Issues

1. **Select Issues:** Check the boxes next to both issues (or just one)
2. **Click:** "Validate Selected Issues" button
3. **Wait:** ~23 seconds for validation (watch real-time progress)
4. **Expected Results:**
   - Status: "potential-gap" or "resolved"
   - Confidence: 70-95%
   - Evidence: 5 relevant documentation pages
   - Semantic scores: 65-70% similarity
   - AI Recommendations: 2 detailed code improvements with BEFORE/AFTER examples
   - Sitemap Health: 317/319 URLs healthy (99%)

### 4. Review Report

**Check these sections:**
- ✅ Executive Summary
- ✅ Sitemap Health Analysis (should show 2 broken URLs)
- ✅ Issue Validation Results
- ✅ AI Recommendations with code examples
- ✅ Evidence with semantic match scores

### 5. Export Report

1. **Click:** "Export Report" button
2. **Check:** Downloaded markdown file
3. **Verify:** All sections are present and formatted correctly

## 🎯 What to Look For

### Issue Discovery
- ✅ 2 issues found for docs.knock.app
- ✅ Issues have titles, descriptions, categories
- ✅ Severity levels (high)
- ✅ Source links (SolutionFall, Knock Changelog)

### Validation Results
- ✅ Semantic search finds relevant pages
- ✅ Best match: `/in-app-ui/react/sdk/hooks/use-notifications` (~67% similarity)
- ✅ Status: "potential-gap" (page exists but incomplete)
- ✅ Confidence: 75%

### AI Recommendations
- ✅ Recommendation 1: Complete Server-Side Knock Notification Trigger for Cron Jobs
  - BEFORE code: Client-side React hook usage
  - AFTER code: Server-side API route with proper authentication
- ✅ Recommendation 2: Hybrid Client-Server Notification System with Debugging
  - Complete integration example
  - Debug panel for troubleshooting

### Sitemap Health
- ✅ Total URLs: 319
- ✅ Healthy: 317 (99%)
- ✅ Broken: 2 URLs
  - `/__api-reference/content` (404)
  - `/__mapi-reference/content` (404)

## 🐛 Troubleshooting

### Issue: Sitemap Health shows all zeros
- **Cause:** The sitemap health check may not be running for knock.app domain
- **Check:** Browser console (F12) for API response details
- **Check:** Network tab to see the `/validate-issues` response
- **Expected:** Should show 317/319 URLs (99% healthy) for knock.app
- **Workaround:** This is a known issue - the validation results are still accurate, just the sitemap health display needs debugging

### Issue: No issues found
- **Check:** Domain spelling (`knock.app` works, `docs.knock.app` also works)
- **Check:** Network tab for API errors
- **Check:** Console for JavaScript errors

### Issue: Validation takes too long (>30s)
- **Normal:** First run may take longer due to embedding loading
- **Check:** Network tab for Lambda timeout errors
- **Retry:** Try again, subsequent runs should be faster

### Issue: Semantic scores are low (<50%)
- **Expected:** Knock docs may not have exact matches for all issues
- **Check:** Review the matched pages to see if they're relevant
- **Note:** 65-70% is good for semantic similarity

### Issue: Sitemap health shows errors
- **Expected:** 2 broken URLs are known (404s for API reference pages)
- **Normal:** 99% health is excellent
- **Check:** Verify the broken URLs are the expected ones

## 📊 Expected Performance

- **Issue Discovery:** ~1 second
- **Validation:** ~23 seconds
- **Sitemap Health:** ~10 seconds (first run), <1 second (cached)
- **Total:** ~25-30 seconds for complete analysis

## ✅ Success Criteria

You should see:
1. ✅ 2 Knock issues discovered
2. ✅ Validation completes without errors
3. ✅ AI recommendations with code examples
4. ✅ Sitemap health: 317/319 URLs (99%)
5. ✅ Markdown export works
6. ✅ All sections populated with data

## 🎉 Ready to Test!

Start the frontend and try it out:
```bash
cd frontend
npm start
```

Then navigate to http://localhost:3000 and follow the steps above.

---

**Questions or Issues?** Check the console logs or network tab for detailed error messages.
