import type { APIRoute } from 'astro';
import { unsubscribeEmail } from '../../lib/db';

export const prerender = false;

export const ALL: APIRoute = async ({ request, locals, redirect }) => {
  const env = (locals as any).runtime?.env || {};
  const db = env.DB;

  if (!db) {
    return new Response('Database service unavailable', { status: 500 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return redirect('/unsubscribe?status=missing_token');
  }

  try {
    const result = await unsubscribeEmail(db, token);
    if (result.success) {
      return redirect(
        `/unsubscribe?status=success&model=${encodeURIComponent(result.modelName || 'TV Model')}`
      );
    } else {
      return redirect('/unsubscribe?status=invalid_token');
    }
  } catch (err: any) {
    return redirect(`/unsubscribe?status=error&message=${encodeURIComponent(err.message)}`);
  }
};
