import type { APIRoute } from 'astro';
import { confirmSubscription } from '../../lib/db';

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
    return redirect('/confirm?status=error&message=Database+service+unavailable');
  }

  if (!cleanToken) {
    if (acceptsJson) {
      return new Response(JSON.stringify({ error: 'Missing confirmation token', status: 'missing_token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect('/confirm?status=missing_token');
  }

  try {
    const result = await confirmSubscription(db, cleanToken);

    if (acceptsJson) {
      if (result.status === 'confirmed') {
        return new Response(
          JSON.stringify({
            success: true,
            status: 'confirmed',
            message: `Subscription confirmed for ${result.modelName || 'TV Model'}.`,
            modelName: result.modelName,
            modelCode: result.modelCode,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } else if (result.status === 'already_confirmed') {
        return new Response(
          JSON.stringify({
            success: true,
            status: 'already_confirmed',
            message: `Subscription was already confirmed for ${result.modelName || 'TV Model'}.`,
            modelName: result.modelName,
            modelCode: result.modelCode,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } else if (result.status === 'missing_token') {
        return new Response(
          JSON.stringify({
            success: false,
            status: 'missing_token',
            error: 'Missing confirmation token.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            status: 'invalid_token',
            error: 'Invalid or expired confirmation token.',
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (result.status === 'confirmed') {
      return redirect(
        `/confirm?status=success&model=${encodeURIComponent(result.modelName || 'TV Model')}`
      );
    } else if (result.status === 'already_confirmed') {
      return redirect(
        `/confirm?status=already_confirmed&model=${encodeURIComponent(result.modelName || 'TV Model')}`
      );
    } else if (result.status === 'missing_token') {
      return redirect('/confirm?status=missing_token');
    } else {
      return redirect('/confirm?status=invalid_token');
    }
  } catch (err: any) {
    if (acceptsJson) {
      return new Response(JSON.stringify({ error: err.message || 'Verification failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect(`/confirm?status=error&message=${encodeURIComponent(err.message || 'Unknown error')}`);
  }
};
