# Getting Started with Ambient AI

> Set up documentation quality monitoring in under 5 minutes

## What is Ambient AI?

Ambient AI is an intelligent documentation quality auditor that continuously monitors your developer documentation for issues like:

- **Outdated code examples** - Deprecated APIs, wrong SDK versions
- **Broken links** - Internal and external link validation
- **Missing content** - Incomplete error handling, missing examples
- **Clarity issues** - Readability, code documentation, structure

Unlike traditional documentation tools, Ambient AI runs continuously in the background, providing real-time guidance without disrupting your workflow.

---

## Quick Start

### Step 1: Create an Account

Sign up at [ambient-ai.dev/signup](https://ambient-ai.dev/signup) and get your API key from the dashboard.

### Step 2: Install the SDK

Choose your preferred language:

**Node.js:**
```bash
npm install ambient-ai-sdk
```

**Python:**
```bash
pip install ambient-ai-sdk
```

### Step 3: Run Your First Analysis

**Node.js:**
```javascript
const { AmbientClient } = require('ambient-ai-sdk');

const client = new AmbientClient({
  apiKey: process.env.AMBIENT_API_KEY
});

async function analyzeDocumentation() {
  try {
    const result = await client.analyze('https://docs.example.com/api');
    
    console.log(`Quality Score: ${result.score}/10`);
    console.log(`Issues Found: ${result.findings.length}`);
    
    // Display findings
    result.findings.forEach(finding => {
      console.log(`- [${finding.severity}] ${finding.message}`);
    });
  } catch (error) {
    console.error('Analysis failed:', error.message);
  }
}

analyzeDocumentation();
```

**Python:**
```python
import os
from ambient_ai import AmbientClient

client = AmbientClient(
    api_key=os.environ.get('AMBIENT_API_KEY')
)

def analyze_documentation():
    try:
        result = client.analyze('https://docs.example.com/api')
        
        print(f"Quality Score: {result.score}/10")
        print(f"Issues Found: {len(result.findings)}")
        
        # Display findings
        for finding in result.findings:
            print(f"- [{finding.severity}] {finding.message}")
    except Exception as error:
        print(f"Analysis failed: {error}")

analyze_documentation()
```

---

## Understanding Your Results

After analysis, you'll receive a quality report with:

### Quality Score (0-10)

| Score | Rating | Action |
|-------|--------|--------|
| 8-10 | Excellent | Minor tweaks only |
| 6-7 | Good | Address high-priority issues |
| 4-5 | Fair | Review and fix critical issues |
| 0-3 | Needs Work | Significant updates required |

### Quality Dimensions

Your documentation is evaluated across five dimensions:

1. **Relevance** - Does it address real developer needs?
2. **Freshness** - Are code examples current?
3. **Clarity** - Is it easy to understand?
4. **Accuracy** - Are code examples correct?
5. **Completeness** - Is everything covered?

---

## Next Steps

Now that you've run your first analysis:

1. **[Set up CI/CD integration](./integration-guide.md)** - Automate quality checks
2. **[Configure webhooks](./webhooks.md)** - Get real-time notifications
3. **[Explore the API](./api-reference.md)** - Full SDK documentation

---

## Getting Help

- **Documentation**: [docs.ambient-ai.dev](https://docs.ambient-ai.dev)
- **Community**: [Discord](https://discord.gg/ambient-ai)
- **Support**: [support@ambient-ai.dev](mailto:support@ambient-ai.dev)
