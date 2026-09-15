import type { APIRoute } from 'astro';
import { getModelByCode, upsertModel } from '../../../lib/db';
import { getBrandAdapter } from '../../../lib/brands';

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

  const modelCode = (body.modelCode || '').trim().toUpperCase();
  const brand = (body.brand || 'LG').trim().toUpperCase();

  if (!modelCode || modelCode.length < 3) {
    return new Response(
      JSON.stringify({
        error: 'Please enter a valid model code (e.g. OLED65C3PUA or OLED65CXPUA.AUS).',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // 1. Check if model already exists in D1
    const existing = await getModelByCode(db, modelCode);
    if (existing) {
      return new Response(
        JSON.stringify({
          success: true,
          alreadyExists: true,
          message: 'Model is already tracked in the catalog!',
          model: existing,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Validate against manufacturer support servers
    const adapter = getBrandAdapter(brand);
    const validation = await adapter.validateAndFetch(modelCode);

    if (!validation.isValid) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            validation.errorMessage ||
            `Could not verify model "${modelCode}" on official ${brand} support.`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Register model into D1 database
    const modelId = `${brand.toLowerCase()}-${validation.modelCode.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const newModel = {
      id: modelId,
      brand,
      series: validation.series || `${brand} TV`,
      name: validation.productName || `${brand} ${validation.modelCode}`,
      model_code: validation.modelCode,
      support_url: validation.supportUrl || '',
      product_image: validation.productImage,
      latest_version: validation.latestFirmware?.version,
      release_date: validation.latestFirmware?.releaseDate,
      file_size: validation.latestFirmware?.fileSize,
      download_url: validation.latestFirmware?.downloadUrl,
      all_versions: validation.allFirmwares || [],
    };

    await upsertModel(db, newModel);

    return new Response(
      JSON.stringify({
        success: true,
        alreadyExists: false,
        message: `Successfully verified and added ${newModel.name}!`,
        model: newModel,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
