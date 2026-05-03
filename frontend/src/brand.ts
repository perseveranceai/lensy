/**
 * Brand-neutral mode toggle.
 * Set REACT_APP_BRAND_NEUTRAL=true at build time to hide
 * "Perseverance AI" company branding from the UI chrome.
 * The product name "Lensy" is always shown.
 */
export const BRAND_NEUTRAL = process.env.REACT_APP_BRAND_NEUTRAL === 'true';

export const COMPANY_NAME = BRAND_NEUTRAL ? '' : 'Perseverance AI';
export const PRODUCT_NAME = 'Lensy';
export const COPYRIGHT_LINE = BRAND_NEUTRAL
    ? `© ${new Date().getFullYear()} Lensy. Open beta.`
    : `© ${new Date().getFullYear()} Perseverance AI. All rights reserved.`;
