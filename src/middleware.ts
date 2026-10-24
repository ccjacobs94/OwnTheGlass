import { defineMiddleware } from 'astro:middleware';

/**
 * Baseline security headers applied to every server-rendered response.
 * Static assets (prerendered pages, /_astro/*) receive the same headers via public/_headers.
 *
 * NOTE: Never add X-Robots-Tag: noindex here — the site must stay indexable.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Astro may inline small hoisted scripts; Turnstile + optional Cloudflare Web Analytics are the only third parties.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  // Product images are hotlinked from manufacturer CDNs.
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com",
  'frame-src https://challenges.cloudflare.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function applyHeaders(headers: Headers) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
}

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  try {
    applyHeaders(response.headers);
    return response;
  } catch {
    // Some responses (e.g. Response.redirect) have immutable headers; clone to apply.
    const cloned = new Response(response.body, response);
    applyHeaders(cloned.headers);
    return cloned;
  }
});
