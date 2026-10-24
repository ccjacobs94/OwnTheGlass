/**
 * Shared security helpers for API routes.
 */

/**
 * Constant-time string comparison.
 * Both inputs are SHA-256 hashed first so the comparison runs over fixed-length
 * digests, which avoids leaking either the secret's length or matching prefix via timing.
 */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) {
    diff |= va[i] ^ vb[i];
  }
  return diff === 0;
}

/**
 * Logs the real error server-side and returns a JSON 500 response with a generic message,
 * so internal details (SQL errors, stack info, binding names) are never exposed to clients.
 */
export function internalErrorResponse(context: string, err: unknown, publicMessage = 'Something went wrong. Please try again later.'): Response {
  console.error(`[${context}]`, err);
  return new Response(JSON.stringify({ error: publicMessage }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}
