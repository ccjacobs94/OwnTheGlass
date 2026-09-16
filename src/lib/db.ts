export interface ModelRecord {
  id: string;
  brand: string;
  series: string | null;
  name: string;
  model_code: string;
  support_url: string;
  product_image: string | null;
  latest_version: string | null;
  release_date: string | null;
  file_size: string | null;
  download_url: string | null;
  all_versions_json: string | null;
  last_checked_at: string | null;
  last_updated_at: string | null;
  is_active: number;
  all_versions?: any[];
}

export function parseModelRow(row: any): ModelRecord | null {
  if (!row) return null;
  let all_versions: any[] = [];
  if (row.all_versions_json) {
    try {
      all_versions = JSON.parse(row.all_versions_json);
    } catch {
      all_versions = [];
    }
  }
  return {
    ...row,
    all_versions,
  };
}

export async function getAllModels(db: D1Database, brand?: string): Promise<ModelRecord[]> {
  let query = 'SELECT * FROM models WHERE is_active = 1';
  const params: any[] = [];
  if (brand && brand !== 'ALL') {
    query += ' AND brand = ?';
    params.push(brand.toUpperCase());
  }
  query += ' ORDER BY name ASC';
  const stmt = params.length > 0 ? db.prepare(query).bind(...params) : db.prepare(query);
  const result = await stmt.all();
  return (result.results || []).map(parseModelRow).filter(Boolean) as ModelRecord[];
}

export async function getModelById(db: D1Database, id: string): Promise<ModelRecord | null> {
  const row = await db.prepare('SELECT * FROM models WHERE id = ?').bind(id).first();
  return parseModelRow(row);
}

export async function getModelByCode(db: D1Database, code: string): Promise<ModelRecord | null> {
  const clean = code.trim().toUpperCase();
  const row = await db
    .prepare('SELECT * FROM models WHERE UPPER(model_code) = ? OR UPPER(model_code) LIKE ?')
    .bind(clean, `${clean}%`)
    .first();
  return parseModelRow(row);
}

export async function searchModels(db: D1Database, query: string, brand?: string): Promise<ModelRecord[]> {
  const clean = `%${query.trim().toLowerCase()}%`;
  let sql = `
    SELECT * FROM models 
    WHERE is_active = 1 
      AND (LOWER(name) LIKE ? OR LOWER(model_code) LIKE ? OR LOWER(COALESCE(series, '')) LIKE ?)
  `;
  const params: any[] = [clean, clean, clean];
  if (brand && brand !== 'ALL') {
    sql += ' AND brand = ?';
    params.push(brand.toUpperCase());
  }
  sql += ' ORDER BY name ASC LIMIT 20';
  const result = await db.prepare(sql).bind(...params).all();
  return (result.results || []).map(parseModelRow).filter(Boolean) as ModelRecord[];
}

export async function upsertModel(
  db: D1Database,
  model: {
    id: string;
    brand: string;
    series?: string;
    name: string;
    model_code: string;
    support_url: string;
    product_image?: string;
    latest_version?: string;
    release_date?: string;
    file_size?: string;
    download_url?: string;
    all_versions?: any[];
  }
): Promise<void> {
  const now = new Date().toISOString();
  const versionsJson = JSON.stringify(model.all_versions || []);

  const existing = await db.prepare('SELECT id FROM models WHERE id = ?').bind(model.id).first();

  if (!existing) {
    await db
      .prepare(`
        INSERT INTO models (
          id, brand, series, name, model_code, support_url, product_image,
          latest_version, release_date, file_size, download_url,
          all_versions_json, last_checked_at, last_updated_at, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `)
      .bind(
        model.id,
        model.brand,
        model.series || null,
        model.name,
        model.model_code,
        model.support_url,
        model.product_image || null,
        model.latest_version || null,
        model.release_date || null,
        model.file_size || null,
        model.download_url || null,
        versionsJson,
        now,
        now
      )
      .run();
  } else {
    await db
      .prepare(`
        UPDATE models SET
          name = COALESCE(?, name),
          series = COALESCE(?, series),
          support_url = COALESCE(?, support_url),
          product_image = COALESCE(?, product_image),
          latest_version = COALESCE(?, latest_version),
          release_date = COALESCE(?, release_date),
          file_size = COALESCE(?, file_size),
          download_url = COALESCE(?, download_url),
          all_versions_json = COALESCE(?, all_versions_json),
          last_checked_at = ?,
          last_updated_at = ?
        WHERE id = ?
      `)
      .bind(
        model.name,
        model.series || null,
        model.support_url,
        model.product_image || null,
        model.latest_version || null,
        model.release_date || null,
        model.file_size || null,
        model.download_url || null,
        versionsJson,
        now,
        now,
        model.id
      )
      .run();
  }
}

export interface SubscriptionRecord {
  id: string;
  email: string;
  model_id: string;
  unsubscribe_token: string;
  confirmation_token: string | null;
  is_verified: number;
  created_at: string;
}

export interface SubscribeResult {
  success: boolean;
  token: string;
  unsubscribeToken: string;
  confirmationToken: string;
  alreadySubscribed?: boolean;
  isVerified?: boolean;
}

export interface ConfirmResult {
  success: boolean;
  status: 'confirmed' | 'already_confirmed' | 'invalid_token' | 'missing_token';
  modelName?: string;
  modelCode?: string;
  email?: string;
  modelId?: string;
}

export async function subscribeEmail(
  db: D1Database,
  email: string,
  modelId: string
): Promise<SubscribeResult> {
  const cleanEmail = (typeof email === 'string' ? email : '').trim().toLowerCase();
  const cleanModelId = (typeof modelId === 'string' ? modelId : '').trim();
  
  // Check if already subscribed
  const existing = await db
    .prepare('SELECT id, unsubscribe_token, confirmation_token, is_verified FROM email_subscriptions WHERE email = ? AND model_id = ?')
    .bind(cleanEmail, cleanModelId)
    .first();

  if (existing) {
    const isVerified = Number(existing.is_verified) === 1;
    let confirmationToken = (existing.confirmation_token as string) || '';

    // If unconfirmed and missing confirmation token, generate and persist one
    if (!isVerified && !confirmationToken) {
      confirmationToken = (crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).substring(2)).toLowerCase();
      await db
        .prepare('UPDATE email_subscriptions SET confirmation_token = ? WHERE id = ?')
        .bind(confirmationToken, existing.id)
        .run();
    }

    return {
      success: true,
      token: existing.unsubscribe_token as string,
      unsubscribeToken: existing.unsubscribe_token as string,
      confirmationToken,
      alreadySubscribed: isVerified,
      isVerified,
    };
  }

  const id = crypto.randomUUID();
  const unsubscribeToken = (crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).substring(2)).toLowerCase();
  const confirmationToken = (crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).substring(2)).toLowerCase();
  const now = new Date().toISOString();

  await db
    .prepare(`
      INSERT INTO email_subscriptions (id, email, model_id, unsubscribe_token, confirmation_token, is_verified, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `)
    .bind(id, cleanEmail, cleanModelId, unsubscribeToken, confirmationToken, now)
    .run();

  return {
    success: true,
    token: unsubscribeToken,
    unsubscribeToken,
    confirmationToken,
    alreadySubscribed: false,
    isVerified: false,
  };
}

export async function confirmSubscription(
  db: D1Database,
  token: string
): Promise<ConfirmResult> {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false, status: 'missing_token' };
  }

  const cleanToken = token.trim();

  const sub = await db
    .prepare(`
      SELECT s.id, s.email, s.is_verified, s.model_id, m.name as model_name, m.model_code
      FROM email_subscriptions s
      LEFT JOIN models m ON s.model_id = m.id
      WHERE s.confirmation_token = ? OR s.confirmation_token = ?
    `)
    .bind(cleanToken, cleanToken.toLowerCase())
    .first();

  if (!sub) {
    return { success: false, status: 'invalid_token' };
  }

  if (Number(sub.is_verified) === 1) {
    return {
      success: true,
      status: 'already_confirmed',
      modelName: (sub.model_name as string) || 'TV Model',
      modelCode: (sub.model_code as string) || '',
      email: sub.email as string,
      modelId: sub.model_id as string,
    };
  }

  await db
    .prepare('UPDATE email_subscriptions SET is_verified = 1 WHERE id = ?')
    .bind(sub.id)
    .run();

  return {
    success: true,
    status: 'confirmed',
    modelName: (sub.model_name as string) || 'TV Model',
    modelCode: (sub.model_code as string) || '',
    email: sub.email as string,
    modelId: sub.model_id as string,
  };
}

export async function unsubscribeEmail(
  db: D1Database,
  token: string
): Promise<{ success: boolean; modelName?: string }> {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false };
  }

  const cleanToken = token.trim();
  const sub = await db
    .prepare(`
      SELECT s.id, m.name 
      FROM email_subscriptions s
      LEFT JOIN models m ON s.model_id = m.id
      WHERE s.unsubscribe_token = ? OR s.unsubscribe_token = ?
    `)
    .bind(cleanToken, cleanToken.toLowerCase())
    .first();

  if (!sub) {
    return { success: false };
  }

  await db
    .prepare('DELETE FROM email_subscriptions WHERE unsubscribe_token = ? OR unsubscribe_token = ?')
    .bind(cleanToken, cleanToken.toLowerCase())
    .run();
  return { success: true, modelName: (sub.name as string) || 'TV Model' };
}

export async function getSubscribersForModel(
  db: D1Database,
  modelId: string
): Promise<{ email: string; unsubscribe_token: string }[]> {
  const cleanModelId = typeof modelId === 'string' ? modelId.trim() : '';
  const result = await db
    .prepare('SELECT email, unsubscribe_token FROM email_subscriptions WHERE model_id = ? AND is_verified = 1')
    .bind(cleanModelId)
    .all();
  return (result.results || []) as { email: string; unsubscribe_token: string }[];
}

export async function logCheckHistory(
  db: D1Database,
  modelId: string,
  versionFound: string | null,
  status: string,
  message?: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO check_history (model_id, version_found, status, message, checked_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(modelId, versionFound, status, message || null, now)
    .run();
}

export async function logNotification(
  db: D1Database,
  modelId: string,
  email: string,
  version: string,
  status: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO notification_logs (model_id, email, version, status, dispatched_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(modelId, email, version, status, now)
    .run();
}
