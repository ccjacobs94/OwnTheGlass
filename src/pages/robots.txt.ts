import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
  const body = `User-agent: *
Allow: /
Sitemap: https://owntheglass.org/sitemap.xml
`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
