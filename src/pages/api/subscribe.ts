import type { APIRoute } from 'astro';
import { getModelById, subscribeEmail } from '../../lib/db';
import { sendConfirmationEmail } from '../../lib/email';
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

  let rawEmail: any;
  let rawModelId: any;
  let turnstileToken: string | undefined;

  const contentType = request.headers.get('content-type') || '';
  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    try {
      const formData = await request.formData();
      rawEmail = formData.get('email');
      rawModelId = formData.get('modelId');
      const tToken = formData.get('turnstileToken');
      turnstileToken = typeof tToken === 'string' ? tToken.trim() : undefined;
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid form data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    rawEmail = body?.email;
    rawModelId = body?.modelId;
    turnstileToken = typeof body?.turnstileToken === 'string' ? body.turnstileToken.trim() : undefined;
  }

  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const modelId = typeof rawModelId === 'string' ? rawModelId.trim() : '';

  // Basic email regex and RFC 5321 length check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || email.length > 254 || !emailRegex.test(email)) {
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

    // If user was already confirmed
    if (result.alreadySubscribed && result.isVerified) {
      return new Response(
        JSON.stringify({
          success: true,
          alreadySubscribed: true,
          isVerified: true,
          message: `You are already subscribed to alerts for ${model.name}.`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Dispatch confirmation email via Resend
    const resendApiKey = env.RESEND_API_KEY || '';
    const emailFrom = env.EMAIL_FROM || 'OwnTheGlass <updates@owntheglass.com>';
    const appUrl = env.APP_URL || new URL(request.url).origin;

    if (resendApiKey) {
      const emailRes = await sendConfirmationEmail(resendApiKey, emailFrom, {
        toEmail: email,
        modelName: model.name,
        modelCode: model.model_code,
        confirmationToken: result.confirmationToken,
        appUrl,
      });
      if (!emailRes.success) {
        console.error('Resend dispatch error:', emailRes.error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        alreadySubscribed: false,
        isVerified: false,
        message: `Please check your email (${email}) to confirm your subscription for ${model.name}.`,
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
