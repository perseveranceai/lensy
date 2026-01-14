# Perseverance AI Website Design Requirements

## Overview

This document provides design specifications for refreshing perseveranceai.com to align with the updated brand identity. The target audience is **developer portal owners**, **DevRel teams**, and the **developer community**. The aesthetic should be modern, technical, and developer-friendly.

---

## Brand Identity

### Logo
- **Format**: `{ P }` where braces are in monospace, P is in geometric sans-serif
- **Braces**: Light weight (300), muted gray color
- **P**: Bold/semibold weight (600-700), near-white color

### Tagline
**Primary**: "Technical Documentation that Works!"

**Alternative options** (for A/B testing or section headers):
- "Docs that developers actually trust"
- "Your docs, always current"
- "Stop shipping stale docs"
- "Keep your docs as fresh as your code"

---

## Color Palette

### Primary Colors (Dark Theme)

```css
:root {
  /* Backgrounds */
  --bg-primary: #0a0a0a;      /* Deepest black - page background */
  --bg-secondary: #111111;    /* Slightly lighter - cards, sections */
  --bg-tertiary: #1a1a1a;     /* Elevated surfaces - hover states */
  
  /* Text */
  --text-primary: #fafafa;    /* Primary text - headings, important */
  --text-secondary: #e5e7eb;  /* Body text */
  --text-muted: #737373;      /* Subtle text - captions, metadata */
  --text-code: #525252;       /* Code braces, brackets */
  
  /* Borders & Dividers */
  --border-subtle: #1f1f1f;   /* Subtle borders */
  --border-default: #2a2a2a;  /* Default borders */
  --border-strong: #3a3a3a;   /* Emphasized borders */
  
  /* Accents (use sparingly) */
  --accent-primary: #3b82f6;  /* Blue - links, primary buttons */
  --accent-hover: #60a5fa;    /* Blue hover state */
  --accent-success: #22c55e;  /* Green - success states */
  --accent-warning: #f59e0b;  /* Amber - warnings */
  --accent-error: #ef4444;    /* Red - errors */
}
```

### Usage Guidelines
- **Never use purple gradients** - avoid generic AI aesthetic
- **Minimal accent colors** - primarily grayscale with blue for interactive elements
- **High contrast text** - ensure WCAG AA compliance (4.5:1 minimum)

---

## Typography

### Font Stack

```css
:root {
  /* Primary font - headings, body text, UI */
  --font-sans: 'Plus Jakarta Sans', 'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  
  /* Monospace - code, technical elements, braces in logo */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'SF Mono', Consolas, monospace;
}
```

### Font Loading (add to `<head>`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### Type Scale

```css
/* Headings */
h1 {
  font-family: var(--font-sans);
  font-size: 3rem;      /* 48px */
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

h2 {
  font-family: var(--font-sans);
  font-size: 2rem;      /* 32px */
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

h3 {
  font-family: var(--font-sans);
  font-size: 1.25rem;   /* 20px */
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary);
}

/* Body text */
body, p {
  font-family: var(--font-sans);
  font-size: 1rem;      /* 16px */
  font-weight: 400;
  line-height: 1.6;
  color: var(--text-secondary);
}

/* Small text / captions */
.caption, small {
  font-family: var(--font-sans);
  font-size: 0.875rem;  /* 14px */
  font-weight: 500;
  color: var(--text-muted);
}

/* Code / technical text */
code, .mono {
  font-family: var(--font-mono);
  font-size: 0.9em;
  font-weight: 400;
}
```

### Typography Don'ts
- ❌ Never use Inter as primary font (overused in AI products)
- ❌ Never use Arial, Roboto, or system defaults
- ❌ Avoid font weights below 400 for body text
- ❌ Don't use ALL CAPS except for short labels

---

## Layout & Spacing

### Container

```css
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

@media (min-width: 768px) {
  .container {
    padding: 0 2rem;
  }
}
```

### Spacing Scale

```css
:root {
  --space-xs: 0.25rem;   /* 4px */
  --space-sm: 0.5rem;    /* 8px */
  --space-md: 1rem;      /* 16px */
  --space-lg: 1.5rem;    /* 24px */
  --space-xl: 2rem;      /* 32px */
  --space-2xl: 3rem;     /* 48px */
  --space-3xl: 4rem;     /* 64px */
  --space-4xl: 6rem;     /* 96px */
}
```

### Section Spacing

```css
section {
  padding: var(--space-4xl) 0;
}

/* Reduce on mobile */
@media (max-width: 768px) {
  section {
    padding: var(--space-2xl) 0;
  }
}
```

---

## Components

### Navigation

```css
nav {
  background: rgba(10, 10, 10, 0.8);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  z-index: 100;
}

nav a {
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

nav a:hover {
  color: var(--text-primary);
}
```

### Logo in Navigation

```html
<a href="/" class="logo">
  <span class="logo-brace">{</span>
  <span class="logo-p">P</span>
  <span class="logo-brace">}</span>
</a>
```

```css
.logo {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  text-decoration: none;
}

.logo-brace {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-weight: 300;
  color: var(--text-code);
}

.logo-p {
  font-family: var(--font-sans);
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
}
```

### Buttons

```css
/* Primary button */
.btn-primary {
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  font-weight: 600;
  padding: 0.75rem 1.5rem;
  background: var(--text-primary);
  color: var(--bg-primary);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: var(--text-secondary);
  transform: translateY(-1px);
}

/* Secondary / Ghost button */
.btn-secondary {
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  font-weight: 600;
  padding: 0.75rem 1.5rem;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: var(--bg-tertiary);
  border-color: var(--border-strong);
}
```

### Cards (Feature Cards)

```css
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: var(--space-xl);
  transition: all 0.3s ease;
}

.card:hover {
  background: var(--bg-tertiary);
  border-color: var(--border-default);
  transform: translateY(-2px);
}

.card-icon {
  font-size: 2rem;
  margin-bottom: var(--space-md);
}

.card-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-sm);
}

.card-description {
  font-size: 0.9375rem;
  color: var(--text-muted);
  line-height: 1.5;
}
```

### Form Inputs

```css
input, textarea {
  font-family: var(--font-sans);
  font-size: 1rem;
  width: 100%;
  padding: 0.875rem 1rem;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  transition: all 0.2s ease;
}

input:focus, textarea:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

input::placeholder, textarea::placeholder {
  color: var(--text-muted);
}

label {
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: var(--space-xs);
  display: block;
}
```

### Code Blocks (if showing examples)

```css
pre, .code-block {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: var(--space-lg);
  overflow-x: auto;
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--bg-tertiary);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  color: var(--text-secondary);
}
```

---

## Visual Effects

### Background Pattern (Optional - subtle grid)

```css
body {
  background-color: var(--bg-primary);
  background-image: 
    linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
  background-size: 50px 50px;
}
```

### Gradients (use sparingly)

```css
/* Subtle text gradient for hero heading - optional */
.hero-title {
  background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-muted) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Subtle glow effect for accent elements */
.glow {
  box-shadow: 0 0 40px rgba(59, 130, 246, 0.1);
}
```

### Animations

```css
/* Fade in on scroll */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-in {
  animation: fadeInUp 0.6s ease-out forwards;
}

/* Stagger children */
.stagger > *:nth-child(1) { animation-delay: 0.1s; }
.stagger > *:nth-child(2) { animation-delay: 0.2s; }
.stagger > *:nth-child(3) { animation-delay: 0.3s; }
.stagger > *:nth-child(4) { animation-delay: 0.4s; }
```

---

## Page-Specific Guidelines

### Hero Section

```html
<section class="hero">
  <div class="container">
    <h1>Find What's Broken in Your Developer Docs</h1>
    <p class="hero-subtitle">
      Lensy analyzes your documentation and finds deprecated code examples, 
      outdated API references, and content gaps — with specific, actionable 
      recommendations to fix them.
    </p>
    <div class="hero-cta">
      <a href="#contact" class="btn-primary">See It In Action</a>
      <a href="https://calendly.com/getperseverance" class="btn-secondary">Schedule a Demo</a>
    </div>
  </div>
</section>
```

```css
.hero {
  padding: var(--space-4xl) 0;
  text-align: center;
}

.hero h1 {
  max-width: 800px;
  margin: 0 auto var(--space-lg);
}

.hero-subtitle {
  max-width: 600px;
  margin: 0 auto var(--space-2xl);
  font-size: 1.125rem;
  color: var(--text-muted);
}

.hero-cta {
  display: flex;
  gap: var(--space-md);
  justify-content: center;
  flex-wrap: wrap;
}
```

### Features Grid

```css
.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-xl);
}
```

### Contact Form Section

```css
.contact-section {
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.contact-form {
  max-width: 500px;
  margin: 0 auto;
}

.form-group {
  margin-bottom: var(--space-lg);
}
```

---

## Assets

### Favicon
Use the `{ P }` logo mark on dark background, export at:
- 16x16 (favicon.ico)
- 32x32 (favicon-32x32.png)
- 180x180 (apple-touch-icon.png)
- 192x192 (android-chrome-192x192.png)
- 512x512 (android-chrome-512x512.png)

### Open Graph Image
- Size: 1200x630px
- Include logo + tagline
- Dark background consistent with site

---

## Accessibility Checklist

- [ ] Color contrast ratio ≥ 4.5:1 for body text
- [ ] Color contrast ratio ≥ 3:1 for large text
- [ ] All interactive elements have visible focus states
- [ ] Form inputs have associated labels
- [ ] Images have alt text
- [ ] Semantic HTML structure (proper heading hierarchy)
- [ ] Keyboard navigation works for all interactive elements
- [ ] No auto-playing animations without user control

---

## Implementation Notes

### Files to Update
1. `styles.css` or equivalent - apply all CSS variables and styles above
2. `index.html` - add Google Fonts link, update class names
3. Favicon files - regenerate from logo mark
4. `og-image.png` - create new Open Graph image

### Testing
- Test on mobile (375px) and desktop (1440px)
- Verify fonts load correctly (check Network tab)
- Validate contrast with browser dev tools
- Test form submission functionality

---

## Quick Reference

| Element | Font | Weight | Size | Color |
|---------|------|--------|------|-------|
| H1 | Plus Jakarta Sans | 700 | 48px | #fafafa |
| H2 | Plus Jakarta Sans | 600 | 32px | #fafafa |
| H3 | Plus Jakarta Sans | 600 | 20px | #fafafa |
| Body | Plus Jakarta Sans | 400 | 16px | #e5e7eb |
| Caption | Plus Jakarta Sans | 500 | 14px | #737373 |
| Code | JetBrains Mono | 400 | 14px | #e5e7eb |
| Logo braces | JetBrains Mono | 300 | — | #525252 |
| Logo P | Plus Jakarta Sans | 700 | — | #fafafa |

---

*Document Version: 1.0*  
*Last Updated: January 2026*  
*For: Perseverance AI (perseveranceai.com)*
