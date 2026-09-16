import { Resend } from 'resend';

export function escapeHtml(str: string | null | undefined): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface FirmwareAlertPayload {
  toEmail: string;
  modelName: string;
  modelCode: string;
  version: string;
  releaseDate?: string;
  fileSize?: string;
  downloadUrl?: string;
  unsubscribeToken: string;
  appUrl?: string;
}

export function generateFirmwareEmailHtml(payload: FirmwareAlertPayload): string {
  let appUrl = 'https://owntheglass.com';
  try {
    const parsed = new URL((payload.appUrl || 'https://owntheglass.com').trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      appUrl = parsed.origin;
    }
  } catch {
    appUrl = 'https://owntheglass.com';
  }
  const unsubToken = payload.unsubscribeToken || '';
  const unsubUrl = `${appUrl}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const guideUrl = `${appUrl}/guide`;
  const safeAppUrl = escapeHtml(appUrl);
  const safeUnsubUrl = escapeHtml(unsubUrl);
  const safeGuideUrl = escapeHtml(guideUrl);
  const safeModelName = escapeHtml(payload.modelName);
  const safeModelCode = escapeHtml(payload.modelCode);
  const safeVersion = escapeHtml(payload.version);
  const safeReleaseDate = escapeHtml(payload.releaseDate);
  const safeFileSize = escapeHtml(payload.fileSize);
  const rawDownloadUrl = (payload.downloadUrl || '').trim();
  const hasValidDownloadProtocol = /^https?:\/\//i.test(rawDownloadUrl);
  const safeDownloadUrl = hasValidDownloadProtocol ? escapeHtml(rawDownloadUrl) : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>New Firmware for ${safeModelName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #090A0F;
      color: #E2E8F0;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 32px 20px;
    }
    .brand {
      text-align: center;
      margin-bottom: 28px;
    }
    .brand-title {
      font-size: 24px;
      font-weight: 800;
      color: #FFFFFF;
      letter-spacing: -0.5px;
      text-decoration: none;
    }
    .brand-tagline {
      font-size: 13px;
      color: #94A3B8;
      margin-top: 4px;
    }
    .card {
      background-color: #121620;
      border: 1px solid #1E293B;
      border-radius: 12px;
      padding: 28px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-block;
      background-color: rgba(16, 185, 129, 0.15);
      border: 1px solid #10B981;
      color: #34D399;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #FFFFFF;
      margin: 0 0 12px 0;
    }
    .model-code {
      font-size: 14px;
      color: #06B6D4;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      margin-bottom: 20px;
    }
    .info-grid {
      background-color: #090A0F;
      border: 1px solid #1E293B;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid #171B26;
      font-size: 14px;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .info-label {
      color: #64748B;
    }
    .info-val {
      color: #F8FAFC;
      font-weight: 600;
    }
    .btn-primary {
      display: block;
      background-color: #10B981;
      color: #000000;
      text-align: center;
      padding: 14px 20px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 15px;
      text-decoration: none;
      margin-bottom: 12px;
    }
    .btn-secondary {
      display: block;
      background-color: #1E293B;
      color: #E2E8F0;
      text-align: center;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      text-decoration: none;
      margin-bottom: 24px;
    }
    .air-gap-box {
      background-color: rgba(6, 182, 212, 0.08);
      border-left: 3px solid #06B6D4;
      padding: 14px;
      border-radius: 4px;
      font-size: 13px;
      line-height: 1.5;
      color: #CBD5E1;
      margin-bottom: 20px;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #64748B;
      margin-top: 32px;
      line-height: 1.6;
    }
    .footer a {
      color: #94A3B8;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">
      <div class="brand-title">🛡️ OwnTheGlass</div>
      <div class="brand-tagline">Keep your display private, offline, and up to date.</div>
    </div>

    <div class="card">
      <div class="badge">Official Firmware Update Detected</div>
      <h1>${safeModelName}</h1>
      <div class="model-code">${safeModelCode}</div>

      <div class="info-grid">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 6px 0; color: #64748B; font-size: 14px;">Latest Version:</td>
            <td style="padding: 6px 0; text-align: right; color: #10B981; font-weight: 700; font-size: 14px;">v${safeVersion}</td>
          </tr>
          ${
            payload.releaseDate
              ? `<tr>
            <td style="padding: 6px 0; color: #64748B; font-size: 14px;">Release Date:</td>
            <td style="padding: 6px 0; text-align: right; color: #F8FAFC; font-weight: 600; font-size: 14px;">${safeReleaseDate}</td>
          </tr>`
              : ''
          }
          ${
            payload.fileSize
              ? `<tr>
            <td style="padding: 6px 0; color: #64748B; font-size: 14px;">File Size:</td>
            <td style="padding: 6px 0; text-align: right; color: #F8FAFC; font-weight: 600; font-size: 14px;">${safeFileSize}</td>
          </tr>`
              : ''
          }
        </table>
      </div>

      ${
        safeDownloadUrl
          ? `<a href="${safeDownloadUrl}" class="btn-primary">Download Official Firmware (.zip)</a>`
          : ''
      }
      <a href="${safeGuideUrl}" class="btn-secondary">View Offline USB Flashing Guide</a>

      <div class="air-gap-box">
        <strong>🛡️ Air-Gap Reminder:</strong> You do not need to connect your TV to Wi-Fi. Flash via a FAT32/NTFS USB flash drive into the <code>LG_DTV</code> directory to keep your display completely isolated from tracking and telemetry.
      </div>
    </div>

    <div class="footer">
      Sent by OwnTheGlass • <a href="${safeAppUrl}">owntheglass.com</a><br>
      You received this email because you subscribed to alerts for ${safeModelName}.<br>
      <a href="${safeUnsubUrl}">Unsubscribe from alerts for this model</a>
    </div>
  </div>
</body>
</html>
  `;
}

export async function sendFirmwareAlert(
  apiKey: string,
  fromEmail: string,
  payload: FirmwareAlertPayload
): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!apiKey) {
    return { success: false, error: 'RESEND_API_KEY is not configured' };
  }

  const resend = new Resend(apiKey);
  const html = generateFirmwareEmailHtml(payload);

  try {
    let cleanAppUrl = 'https://owntheglass.com';
    try {
      const parsed = new URL((payload.appUrl || 'https://owntheglass.com').trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        cleanAppUrl = parsed.origin;
      }
    } catch {
      cleanAppUrl = 'https://owntheglass.com';
    }
    const cleanUnsubToken = encodeURIComponent(payload.unsubscribeToken || '');
    const cleanTo = (payload.toEmail || '').replace(/[\r\n]+/g, '').trim();
    const cleanFrom = (fromEmail || 'OwnTheGlass <updates@owntheglass.com>').replace(/[\r\n]+/g, '').trim();

    const cleanSubject = `[OwnTheGlass] New Firmware v${payload.version} available for ${payload.modelName}`
      .replace(/[\r\n]+/g, ' ')
      .trim();

    const { data, error } = await resend.emails.send({
      from: cleanFrom,
      to: cleanTo,
      subject: cleanSubject,
      html,
      headers: {
        'List-Unsubscribe': `<${cleanAppUrl}/api/unsubscribe?token=${cleanUnsubToken}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to dispatch email' };
  }
}

export interface ConfirmationEmailPayload {
  toEmail: string;
  modelName: string;
  modelCode: string;
  confirmationToken: string;
  appUrl?: string;
}

export function generateConfirmationEmailHtml(payload: ConfirmationEmailPayload): string {
  let appUrl = 'https://owntheglass.com';
  try {
    const parsed = new URL((payload.appUrl || 'https://owntheglass.com').trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      appUrl = parsed.origin;
    }
  } catch {
    appUrl = 'https://owntheglass.com';
  }
  const confirmUrl = `${appUrl}/api/confirm?token=${encodeURIComponent(payload.confirmationToken || '')}`;
  const safeConfirmUrl = escapeHtml(confirmUrl);
  const safeAppUrl = escapeHtml(appUrl);
  const safeModelName = escapeHtml(payload.modelName || 'TV Model');
  const safeModelCode = escapeHtml(payload.modelCode || '');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Your Firmware Alert Subscription</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #090A0F;
      color: #E2E8F0;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 32px 20px;
    }
    .brand {
      text-align: center;
      margin-bottom: 28px;
    }
    .brand-title {
      font-size: 24px;
      font-weight: 800;
      color: #FFFFFF;
      letter-spacing: -0.5px;
      text-decoration: none;
    }
    .brand-tagline {
      font-size: 13px;
      color: #94A3B8;
      margin-top: 4px;
    }
    .card {
      background-color: #121620;
      border: 1px solid #1E293B;
      border-radius: 12px;
      padding: 28px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-block;
      background-color: rgba(16, 185, 129, 0.15);
      border: 1px solid #10B981;
      color: #34D399;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #FFFFFF;
      margin: 0 0 8px 0;
    }
    .model-code {
      font-size: 14px;
      color: #06B6D4;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      margin-bottom: 18px;
    }
    .desc {
      font-size: 14px;
      line-height: 1.6;
      color: #CBD5E1;
      margin-bottom: 24px;
    }
    .btn-primary {
      display: block;
      background-color: #10B981;
      color: #000000;
      text-align: center;
      padding: 14px 20px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 15px;
      text-decoration: none;
      margin-bottom: 20px;
    }
    .air-gap-box {
      background-color: rgba(6, 182, 212, 0.08);
      border-left: 3px solid #06B6D4;
      padding: 14px;
      border-radius: 4px;
      font-size: 13px;
      line-height: 1.5;
      color: #CBD5E1;
      margin-bottom: 20px;
    }
    .alt-link {
      font-size: 12px;
      color: #64748B;
      word-break: break-all;
      margin-bottom: 20px;
      line-height: 1.5;
    }
    .alt-link a {
      color: #06B6D4;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #64748B;
      margin-top: 32px;
      line-height: 1.6;
    }
    .footer a {
      color: #94A3B8;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">
      <div class="brand-title">🛡️ OwnTheGlass</div>
      <div class="brand-tagline">Keep your display private, offline, and up to date.</div>
    </div>

    <div class="card">
      <div class="badge">Action Required • Confirm Subscription</div>
      <h1>${safeModelName}</h1>
      <div class="model-code">${safeModelCode}</div>

      <p class="desc">
        You requested firmware release alerts for this TV model. To prevent unauthorized signups and ensure you only receive alerts you asked for, please confirm your subscription.
      </p>

      <a href="${safeConfirmUrl}" class="btn-primary">Confirm Firmware Alerts</a>

      <div class="alt-link">
        Button not working? Copy and paste this link into your browser:<br>
        <a href="${safeConfirmUrl}">${safeConfirmUrl}</a>
      </div>

      <div class="air-gap-box">
        <strong>🛡️ Privacy Protection:</strong> We never sell your email or connect your TV to Wi-Fi. If you did not request this alert, you can safely ignore this email — you will not receive any updates without confirmation.
      </div>
    </div>

    <div class="footer">
      Sent by OwnTheGlass • <a href="${safeAppUrl}">owntheglass.com</a><br>
      Double opt-in verification for ${safeModelName}.
    </div>
  </div>
</body>
</html>
  `;
}

export async function sendConfirmationEmail(
  apiKey: string,
  fromEmail: string,
  payload: ConfirmationEmailPayload
): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!apiKey) {
    return { success: false, error: 'RESEND_API_KEY is not configured' };
  }

  const resend = new Resend(apiKey);
  const html = generateConfirmationEmailHtml(payload);

  try {
    const cleanTo = (payload.toEmail || '').replace(/[\r\n]+/g, '').trim();
    const cleanFrom = (fromEmail || 'OwnTheGlass <updates@owntheglass.com>').replace(/[\r\n]+/g, '').trim();
    const cleanSubject = `[OwnTheGlass] Please confirm your firmware alerts for ${payload.modelName || 'your TV model'}`
      .replace(/[\r\n]+/g, ' ')
      .trim();

    const { data, error } = await resend.emails.send({
      from: cleanFrom,
      to: cleanTo,
      subject: cleanSubject,
      html,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to dispatch confirmation email' };
  }
}

