import type { APIRoute } from 'astro';
import { getAllModels } from '../lib/db';
import seedModels from '../../data/seed_models.json';

export const prerender = false;

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '2026-10-24';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  const mdy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = mdy[1].padStart(2, '0');
    const day = mdy[2].padStart(2, '0');
    const year = mdy[3];
    return `${year}-${month}-${day}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return '2026-10-24';
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export const GET: APIRoute = async ({ locals }) => {
  let models: any[] = [];
  const db = (locals as any)?.runtime?.env?.DB;

  if (db) {
    try {
      models = await getAllModels(db);
    } catch {
      models = seedModels;
    }
  }

  if (!models || models.length === 0) {
    models = seedModels;
  }

  const urls: { loc: string; lastmod: string }[] = [
    {
      loc: 'https://owntheglass.org/',
      lastmod: '2026-10-24',
    },
    {
      loc: 'https://owntheglass.org/guide',
      lastmod: '2026-09-15',
    },
  ];

  for (const model of models) {
    if (model.id) {
      const lastmod = formatDate(model.last_updated_at || model.release_date);
      urls.push({
        loc: `https://owntheglass.org/models/${model.id}`,
        lastmod,
      });
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${escapeXml(u.lastmod)}</lastmod>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
