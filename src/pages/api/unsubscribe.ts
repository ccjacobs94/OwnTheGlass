import type { APIRoute } from 'astro';
import { unsubscribeEmail } from '../../lib/db';

export const prerender = false;

export const ALL: APIRoute = async ({ request, locals, redirect }) => {
  const env = (locals as any).runtime?.env || {};
  const db = env.DB;

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'GET, POST' },
    });
  }

  const url = new URL(request.url);
  let token = url.searchParams.get('token');

  // Support reading token from POST JSON body or form data if provided
  if (!token && method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const body = await request.json();
        if (body && typeof body.token === 'string') {
          token = body.token;
        } else if (body && body.token !== undefined && body.token !== null) {
          token = typeof body.token === 'number' ? String(body.token) : '';
        } else {
          token = null;
        }
      } catch {
        // Not JSON, ignore
      }
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      try {
        const formData = await request.formData();
        const formToken = formData.get('token');
        token = typeof formToken === 'string' ? formToken : null;
      } catch {
        // Ignore
      }
    }
  }

  const cleanToken = typeof token === 'string' ? token.trim() : '';
  const acceptHeader = request.headers.get('accept') || '';
  const reqContentType = request.headers.get('content-type') || '';
  const isHtmlClient = acceptHeader.includes('text/html') && !acceptHeader.includes('application/json');

  const acceptsJson =
    acceptHeader.includes('application/json') ||
    reqContentType.includes('application/json') ||
    (method === 'POST' && !isHtmlClient);

  if (!db) {
    if (acceptsJson) {
      return new Response(JSON.stringify({ error: 'Database service unavailable' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect('/unsubscribe?status=error&message=Database+service+unavailable');
  }

  if (!cleanToken) {
    if (acceptsJson) {
      return new Response(JSON.stringify({ error: 'Missing unsubscribe token', status: 'missing_token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect('/unsubscribe?status=missing_token');
  }

  try {
    const result = await unsubscribeEmail(db, cleanToken);
    if (result.success) {
      if (acceptsJson) {
        return new Response(
          JSON.stringify({
            success: true,
            status: 'success',
            message: `Successfully unsubscribed from alerts for ${result.modelName || 'TV Model'}.`,
            modelName: result.modelName,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return redirect(
        `/unsubscribe?status=success&model=${encodeURIComponent(result.modelName || 'TV Model')}`
      );
    } else {
      if (acceptsJson) {
        return new Response(
          JSON.stringify({
            success: false,
            status: 'invalid_token',
            error: 'Invalid unsubscribe token',
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return redirect('/unsubscribe?status=invalid_token');
    }
  } catch (err: unknown) {
    console.error('[api/unsubscribe]', err);
    if (acceptsJson) {
      return new Response(JSON.stringify({ error: 'Unsubscribe failed. Please try again later.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect('/unsubscribe?status=error&message=Unsubscribe+failed.+Please+try+again+later.');
  }
};
