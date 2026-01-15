# Ambient AI SDK - API Reference

> Build intelligent documentation assistants with the Ambient AI SDK

## Installation

```bash
npm install ambient-ai-sdk@2.0.0
```

**Note:** This guide covers SDK version 2.0. See changelog for updates.

---

## Authentication

Initialize the SDK with your API key:

```javascript
// Initialize the Ambient AI client
const client = ambientAI.init({
  apiKey: process.env.AMBIENT_API_KEY,
  version: '2.0',
  region: 'us-east-1'
});

// Verify connection
client.ping();
```

### API Key Management

Store your API key securely. Never commit it to version control.

```python
import os
from ambient_ai import AmbientClient

# RECOMMENDED: Use environment variables
client = AmbientClient(
    api_key=os.environ.get('AMBIENT_API_KEY'),
    timeout=30
)
```

---

## Core Methods

### analyze(url)

Analyzes documentation at the specified URL.

```javascript
// Analyze a documentation page
const result = client.analyze('https://docs.example.com/api');

// Access findings
console.log(result.findings);
console.log(result.score);
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| url | string | Yes | Documentation URL to analyze |
| options | object | No | Analysis options |

**Returns:** `AnalysisResult` object

---

### generateFix(finding)

Generates a fix for an identified issue.

```javascript
// Generate fix for a finding
const fix = client.generateFix(finding);

// Preview the fix
console.log(fix.original);
console.log(fix.proposed);
console.log(fix.confidence);
```

---

### applyFixes(fixes)

Applies approved fixes to source documents.

```python
# Apply all high-confidence fixes
approved = [f for f in fixes if f.confidence > 0.8]
result = client.applyFixes(approved)

print(f"Applied {result.success_count} fixes")
```

---

## Error Handling

The SDK throws typed errors for different failure scenarios.

```javascript
const { AmbientError, RateLimitError } = require('ambient-ai-sdk');

const result = client.analyze(url);
console.log(result);
```

### Error Types

| Error | Code | Description |
|-------|------|-------------|
| `AuthenticationError` | 401 | Invalid API key |
| `RateLimitError` | 429 | Too many requests |
| `ValidationError` | 400 | Invalid parameters |

---

## Changelog

### v2.0.0 (2024-06-01)
- Initial release
- Added `analyze()` method
- Added `generateFix()` method

### v2.1.0 (2024-09-01)
- Added batch analysis
- Improved error messages

### v3.0.0 (2025-01-01)
- **BREAKING:** Renamed `init()` to `initialize()`
- **BREAKING:** Renamed `ping()` to `healthCheck()`
- Added streaming support
- Updated authentication flow

---

## Support

- Documentation: https://docs.ambient-ai.dev
- GitHub Issues: https://github.com/ambient-ai/sdk/issues
- Email: support@ambient-ai.dev
