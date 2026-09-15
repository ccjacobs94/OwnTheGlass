import type { APIRoute } from 'astro';
import { getModelById, subscribeEmail } from '../../lib/db';
import { verifyTurnstileToken } from '../../lib/turnstile';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env || {};
  const db = env.DB;

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database binding not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const email = (body.email || '').trim().toLowerCase();
  const modelId = (body.modelId || '').trim();
  const turnstileToken = body.turnstileToken;

  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!modelId) {
    return new Response(JSON.stringify({ error: 'Missing model ID.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Turnstile bot verification
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  const clientIp = request.headers.get('CF-Connecting-IP') || undefined;
  const turnstileCheck = await verifyTurnstileToken(turnstileToken, turnstileSecret, clientIp);

  if (!turnstileCheck.success) {
    return new Response(
      JSON.stringify({ error: 'Bot verification check failed. Please refresh and try again.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const model = await getModelById(db, modelId);
    if (!model) {
      return new Response(JSON.stringify({ error: 'TV Model not found in catalog.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await subscribeEmail(db, email, modelId);

    return new Response(
      JSON.stringify({
        success: true,
        alreadySubscribed: result.alreadySubscribed,
        message: result.alreadySubscribed
          ? `You are already subscribed to alerts for ${model.name}.`
          : `Subscribed! We'll alert you immediately when new firmware releases for ${model.name}.`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Subscription failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
