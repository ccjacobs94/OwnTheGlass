import type { APIRoute } from 'astro';
import { searchModels, getAllModels } from '../../../lib/db';
import { internalErrorResponse } from '../../../lib/security';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env || {};
  const db = env.DB;

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database binding not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').slice(0, 100);
  const brand = (url.searchParams.get('brand') || '').slice(0, 20);

  try {
    let results;
    if (!q.trim()) {
      results = await getAllModels(db, brand);
    } else {
      results = await searchModels(db, q, brand);
    }

    return new Response(JSON.stringify({ success: true, count: results.length, results }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err: unknown) {
    return internalErrorResponse('api/models/search', err, 'Search failed. Please try again later.');
  }
};
