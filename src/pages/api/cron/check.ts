import type { APIRoute } from 'astro';
import {
  getAllModels,
  upsertModel,
  getSubscribersForModel,
  logCheckHistory,
  logNotification,
} from '../../../lib/db';
import { getBrandAdapter } from '../../../lib/brands';
import { isNewerVersion } from '../../../lib/brands/lg';
import { sendFirmwareAlert } from '../../../lib/email';

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

  // Optional simple API key authorization for external triggers
  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization');
  const queryKey = url.searchParams.get('key');
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && queryKey !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resendApiKey = env.RESEND_API_KEY || '';
  const emailFrom = env.EMAIL_FROM || 'OwnTheGlass <updates@owntheglass.com>';
  const appUrl = env.APP_URL || 'https://owntheglass.com';

  const models = await getAllModels(db);
  const results: any[] = [];

  for (const model of models) {
    const adapter = getBrandAdapter(model.brand);
    try {
      const checkRes = await adapter.fetchLatestFirmware(model.support_url, model.model_code);

      if (!checkRes.isValid || !checkRes.latestFirmware) {
        await logCheckHistory(
          db,
          model.id,
          null,
          'ERROR',
          checkRes.errorMessage || 'Failed to parse firmware info'
        );
        results.push({ modelId: model.id, status: 'ERROR', error: checkRes.errorMessage });
        continue;
      }

      const latestVer = checkRes.latestFirmware.version;
      const isNew = isNewerVersion(latestVer, model.latest_version);

      if (isNew) {
        // Update model in D1
        await upsertModel(db, {
          id: model.id,
          brand: model.brand,
          series: model.series || undefined,
          name: model.name,
          model_code: model.model_code,
          support_url: model.support_url,
          product_image: checkRes.productImage || model.product_image || undefined,
          latest_version: latestVer,
          release_date: checkRes.latestFirmware.releaseDate,
          file_size: checkRes.latestFirmware.fileSize,
          download_url: checkRes.latestFirmware.downloadUrl,
          all_versions: checkRes.allFirmwares || model.all_versions || [],
        });

        await logCheckHistory(
          db,
          model.id,
          latestVer,
          'NEW_UPDATE',
          `Discovered new firmware ${latestVer} (previous: ${model.latest_version || 'None'})`
        );

        // Fetch subscribers and dispatch alerts
        const subscribers = await getSubscribersForModel(db, model.id);
        let sentCount = 0;

        for (const sub of subscribers) {
          const emailRes = await sendFirmwareAlert(resendApiKey, emailFrom, {
            toEmail: sub.email,
            modelName: model.name,
            modelCode: model.model_code,
            version: latestVer,
            releaseDate: checkRes.latestFirmware.releaseDate,
            fileSize: checkRes.latestFirmware.fileSize,
            downloadUrl: checkRes.latestFirmware.downloadUrl,
            unsubscribeToken: sub.unsubscribe_token,
            appUrl,
          });

          await logNotification(
            db,
            model.id,
            sub.email,
            latestVer,
            emailRes.success ? 'SENT' : 'FAILED'
          );

          if (emailRes.success) sentCount++;
        }

        results.push({
          modelId: model.id,
          status: 'NEW_UPDATE',
          previousVersion: model.latest_version,
          newVersion: latestVer,
          subscribersNotified: sentCount,
        });
      } else {
        await logCheckHistory(db, model.id, latestVer, 'SUCCESS', 'No new version found');
        results.push({
          modelId: model.id,
          status: 'NO_CHANGE',
          currentVersion: model.latest_version,
        });
      }
    } catch (err: any) {
      await logCheckHistory(db, model.id, null, 'ERROR', err.message);
      results.push({ modelId: model.id, status: 'ERROR', error: err.message });
    }
  }

  return new Response(JSON.stringify({ success: true, timestamp: new Date().toISOString(), results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
