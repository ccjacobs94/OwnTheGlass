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
import { timingSafeEqualStrings } from '../../../lib/security';

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

  // Required bearer-token authorization for external triggers.
  // Fails closed: if CRON_SECRET is not configured, the endpoint is disabled entirely.
  // The secret is only accepted via the Authorization header (never the query string,
  // which leaks into access logs, browser history, and Referer headers).
  const cronSecret = typeof env.CRON_SECRET === 'string' ? env.CRON_SECRET.trim() : '';
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured; /api/cron/check is disabled (fail closed).');
    return new Response(JSON.stringify({ error: 'Cron endpoint is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = request.headers.get('Authorization') || '';
  const providedSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!providedSecret || !(await timingSafeEqualStrings(providedSecret, cronSecret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
    });
  }

  const resendApiKey = env.RESEND_API_KEY || '';
  const emailFrom = env.EMAIL_FROM || 'OwnTheGlass <updates@owntheglass.org>';
  const appUrl = env.APP_URL || 'https://owntheglass.org';

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
