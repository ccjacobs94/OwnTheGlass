const PRODUCTION_HOSTS = new Set(['owntheglass.org', 'www.owntheglass.org']);

/**
 * Returns true when the request is directed to a live production or Cloudflare Pages preview domain.
 * Used to enforce strict fail-closed security for Turnstile bot verification.
 */
export function isProductionRequest(requestUrl?: string): boolean {
  if (!requestUrl) return false;
  try {
    const { hostname } = new URL(requestUrl);
    return PRODUCTION_HOSTS.has(hostname) || hostname.endsWith('.pages.dev');
  } catch {
    return false;
  }
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  secretKey?: string,
  ip?: string,
  requestUrl?: string
): Promise<{ success: boolean; errorCodes?: string[] }> {
  const secretMissing = !secretKey || secretKey.trim() === '' || secretKey === 'dummy-secret-key';

  if (secretMissing) {
    // Fail closed on production/preview deployments: missing secret must never silently disable bot protection.
    if (isProductionRequest(requestUrl)) {
      console.error('TURNSTILE_SECRET_KEY is not configured on production host; rejecting request (fail closed).');
      return { success: false, errorCodes: ['missing-input-secret'] };
    }
    // Dev and local/test environments without a secret configured allow bypass.
    return { success: true };
  }

  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const formData = new URLSearchParams();
  formData.append('secret', secretKey);
  formData.append('response', token);
  if (ip) {
    formData.append('remoteip', ip);
  }

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    const data: any = await res.json();
    return {
      success: !!data.success,
      errorCodes: data['error-codes'],
    };
  } catch (err) {
    return {
      success: false,
      errorCodes: ['internal-error'],
    };
  }
}
