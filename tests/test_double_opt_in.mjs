import assert from 'node:assert';
import { subscribeEmail, confirmSubscription, getSubscribersForModel, unsubscribeEmail } from '../src/lib/db.ts';
import { generateConfirmationEmailHtml, generateFirmwareEmailHtml, sendConfirmationEmail, sendFirmwareAlert, escapeHtml } from '../src/lib/email.ts';
import { ALL as confirmEndpoint } from '../src/pages/api/confirm.ts';
import { ALL as unsubscribeEndpoint } from '../src/pages/api/unsubscribe.ts';
import { POST as subscribeEndpoint } from '../src/pages/api/subscribe.ts';

// Helper to create a D1-compatible mock database
async function createMockDb() {
  let sqliteDb = null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    sqliteDb = new DatabaseSync(':memory:');
  } catch {
    sqliteDb = null;
  }

  if (sqliteDb) {
    sqliteDb.exec(`
      CREATE TABLE models (
        id TEXT PRIMARY KEY,
        brand TEXT NOT NULL DEFAULT 'LG',
        series TEXT,
        name TEXT NOT NULL,
        model_code TEXT NOT NULL UNIQUE,
        support_url TEXT NOT NULL,
        product_image TEXT,
        latest_version TEXT,
        release_date TEXT,
        file_size TEXT,
        download_url TEXT,
        all_versions_json TEXT,
        last_checked_at TEXT,
        last_updated_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE email_subscriptions (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        model_id TEXT NOT NULL,
        unsubscribe_token TEXT NOT NULL UNIQUE,
        confirmation_token TEXT UNIQUE,
        is_verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(model_id) REFERENCES models(id) ON DELETE CASCADE
      );
    `);

    return {
      prepare(sql) {
        return {
          _params: [],
          bind(...params) {
            this._params = params;
            return this;
          },
          async first() {
            const stmt = sqliteDb.prepare(sql);
            const row = stmt.get(...this._params);
            return row || null;
          },
          async all() {
            const stmt = sqliteDb.prepare(sql);
            const results = stmt.all(...this._params);
            return { results };
          },
          async run() {
            const stmt = sqliteDb.prepare(sql);
            stmt.run(...this._params);
            return { success: true };
          },
        };
      },
      exec(sql) {
        sqliteDb.exec(sql);
      },
      async seedModel(model) {
        sqliteDb.prepare(`
          INSERT INTO models (id, brand, series, name, model_code, support_url, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(model.id, model.brand, model.series || null, model.name, model.model_code, model.support_url);
      },
      async getRawSubscription(email, modelId) {
        return sqliteDb.prepare('SELECT * FROM email_subscriptions WHERE email = ? AND model_id = ?').get(email, modelId);
      },
    };
  }

  // Pure in-memory fallback if node:sqlite is unavailable
  const models = [];
  const subscriptions = [];

  return {
    prepare(sql) {
      return {
        _params: [],
        bind(...params) {
          this._params = params;
          return this;
        },
        async first() {
          const p = this._params;
          if (sql.includes('SELECT * FROM models WHERE id = ?')) {
            const row = models.find(m => m.id === p[0]);
            return row || null;
          }
          if (sql.includes('SELECT id, unsubscribe_token, confirmation_token, is_verified FROM email_subscriptions WHERE email = ? AND model_id = ?')) {
            const row = subscriptions.find(s => s.email === p[0] && s.model_id === p[1]);
            return row ? { id: row.id, unsubscribe_token: row.unsubscribe_token, confirmation_token: row.confirmation_token, is_verified: row.is_verified } : null;
          }
          if (sql.includes('SELECT s.id, s.email, s.is_verified, s.model_id, m.name as model_name, m.model_code FROM email_subscriptions s')) {
            const row = subscriptions.find(s => s.confirmation_token === p[0] || (p[1] && s.confirmation_token === p[1]));
            if (!row) return null;
            const model = models.find(m => m.id === row.model_id);
            return {
              id: row.id,
              email: row.email,
              is_verified: row.is_verified,
              model_id: row.model_id,
              model_name: model ? model.name : null,
              model_code: model ? model.model_code : null,
            };
          }
          if (sql.includes('SELECT s.id, m.name FROM email_subscriptions s')) {
            const row = subscriptions.find(s => s.unsubscribe_token === p[0]);
            if (!row) return null;
            const model = models.find(m => m.id === row.model_id);
            return { id: row.id, name: model ? model.name : 'Unknown Model' };
          }
          return null;
        },
        async all() {
          const p = this._params;
          if (sql.includes('FROM email_subscriptions WHERE model_id = ? AND is_verified = 1')) {
            const results = subscriptions
              .filter(s => s.model_id === p[0] && s.is_verified === 1)
              .map(s => ({ email: s.email, unsubscribe_token: s.unsubscribe_token }));
            return { results };
          }
          if (sql.includes('FROM models WHERE is_active = 1')) {
            return { results: models.filter(m => m.is_active !== 0) };
          }
          return { results: [] };
        },
        async run() {
          const p = this._params;
          if (sql.includes('INSERT INTO email_subscriptions')) {
            subscriptions.push({
              id: p[0],
              email: p[1],
              model_id: p[2],
              unsubscribe_token: p[3],
              confirmation_token: p[4],
              is_verified: 0,
              created_at: p[5],
            });
            return { success: true };
          }
          if (sql.includes('UPDATE email_subscriptions SET model_id = ? WHERE confirmation_token = ?')) {
            const row = subscriptions.find(s => s.confirmation_token === p[1]);
            if (row) row.model_id = p[0];
            return { success: true };
          }
          if (sql.includes('UPDATE email_subscriptions SET is_verified = 1 WHERE id = ?')) {
            const row = subscriptions.find(s => s.id === p[0]);
            if (row) row.is_verified = 1;
            return { success: true };
          }
          if (sql.includes('UPDATE email_subscriptions SET is_verified = 1 WHERE confirmation_token = ?')) {
            const row = subscriptions.find(s => s.confirmation_token === p[0]);
            if (row) row.is_verified = 1;
            return { success: true };
          }
          if (sql.includes('UPDATE email_subscriptions SET confirmation_token = ? WHERE id = ?')) {
            const row = subscriptions.find(s => s.id === p[1]);
            if (row) row.confirmation_token = p[0];
            return { success: true };
          }
          if (sql.includes('DELETE FROM email_subscriptions WHERE unsubscribe_token = ?')) {
            const idx = subscriptions.findIndex(s => s.unsubscribe_token === p[0]);
            if (idx !== -1) subscriptions.splice(idx, 1);
            return { success: true };
          }
          return { success: true };
        },
      };
    },
    exec(sql) {},
    async seedModel(model) {
      models.push(model);
    },
    async getRawSubscription(email, modelId) {
      return subscriptions.find(s => s.email === email && s.model_id === modelId) || null;
    },
  };
}

async function runTests() {
  console.log('=== Running Double Opt-In Verification Test Suite ===\n');

  const db = await createMockDb();

  // Seed sample TV model
  const testModel = {
    id: 'lg-oled65c3',
    brand: 'LG',
    series: 'C3 Series',
    name: 'LG C3 Series 65-Inch OLED TV',
    model_code: 'OLED65C3PUA.AUS',
    support_url: 'https://www.lg.com/us/support/product/lg-OLED65C3PUA.AUS',
  };
  await db.seedModel(testModel);

  // 1. Test Initial Pending State on Subscription
  console.log('Test 1: Initial Pending State on Subscription Registration...');
  const subEmail = 'airgap-enthusiast@example.com';
  const subResult = await subscribeEmail(db, subEmail, testModel.id);

  assert.strictEqual(subResult.success, true, 'Subscription should report success');
  assert.strictEqual(subResult.alreadySubscribed, false, 'New subscription must not be marked alreadySubscribed');
  assert.strictEqual(subResult.isVerified, false, 'New subscription must be unverified');
  assert.ok(subResult.confirmationToken, 'Unique confirmation token must be generated');
  assert.ok(subResult.unsubscribeToken, 'Unique unsubscribe token must be generated');

  const rawSub = await db.getRawSubscription(subEmail, testModel.id);
  assert.ok(rawSub, 'Subscription record must exist in DB');
  assert.strictEqual(Number(rawSub.is_verified), 0, 'Subscription is_verified column must be 0 (pending)');
  assert.strictEqual(rawSub.confirmation_token, subResult.confirmationToken, 'confirmation_token column must match returned token');
  console.log('✓ Pending subscription recorded with is_verified = 0 and secure confirmation token.\n');

  // 2. Test Cron Alert Queries Exclude Unconfirmed Subscribers
  console.log('Test 2: Scheduled Alert Cron Excludes Unconfirmed Subscribers...');
  const alertRecipientsBeforeConfirm = await getSubscribersForModel(db, testModel.id);
  assert.strictEqual(alertRecipientsBeforeConfirm.length, 0, 'Unconfirmed subscribers must NOT receive alerts');
  console.log('✓ Cron alert dispatch strictly returned 0 unconfirmed subscribers.\n');

  // 3. Test Invalid, Empty, and Missing Tokens
  console.log('Test 3: Reject Missing and Invalid Confirmation Tokens...');
  const emptyTokenRes = await confirmSubscription(db, '');
  assert.strictEqual(emptyTokenRes.success, false);
  assert.strictEqual(emptyTokenRes.status, 'missing_token');

  const whitespaceTokenRes = await confirmSubscription(db, '   ');
  assert.strictEqual(whitespaceTokenRes.success, false);
  assert.strictEqual(whitespaceTokenRes.status, 'missing_token');

  const invalidTokenRes = await confirmSubscription(db, 'non-existent-token-12345');
  assert.strictEqual(invalidTokenRes.success, false);
  assert.strictEqual(invalidTokenRes.status, 'invalid_token');

  // Ensure subscription remains unconfirmed after bad attempts
  const rawSubStillPending = await db.getRawSubscription(subEmail, testModel.id);
  assert.strictEqual(Number(rawSubStillPending.is_verified), 0, 'Subscription must remain is_verified = 0 after failed attempts');
  console.log('✓ Missing and invalid tokens rejected safely without unhandled errors.\n');

  // 4. Test Valid Confirmation Verification
  console.log('Test 4: Verification Link Transitions Record to Confirmed...');
  const confirmRes = await confirmSubscription(db, subResult.confirmationToken);
  assert.strictEqual(confirmRes.success, true, 'Valid token confirmation must succeed');
  assert.strictEqual(confirmRes.status, 'confirmed', 'Status must be "confirmed"');
  assert.strictEqual(confirmRes.modelName, testModel.name, 'Confirmation response should provide model name');
  assert.strictEqual(confirmRes.modelCode, testModel.model_code, 'Confirmation response should provide model code');

  const rawSubConfirmed = await db.getRawSubscription(subEmail, testModel.id);
  assert.strictEqual(Number(rawSubConfirmed.is_verified), 1, 'Subscription is_verified column must now be 1');
  console.log('✓ Subscription verified and transitioned to is_verified = 1.\n');

  // 5. Test Confirmed Subscribers Are Now Included in Alert Queries
  console.log('Test 5: Confirmed Subscribers Are Now Eligible for Firmware Alerts...');
  const alertRecipientsAfterConfirm = await getSubscribersForModel(db, testModel.id);
  assert.strictEqual(alertRecipientsAfterConfirm.length, 1, 'Confirmed subscriber must now be included');
  assert.strictEqual(alertRecipientsAfterConfirm[0].email, subEmail, 'Recipient email must match subscriber');
  assert.strictEqual(alertRecipientsAfterConfirm[0].unsubscribe_token, subResult.unsubscribeToken, 'Unsubscribe token must match');
  console.log('✓ Cron alert dispatch now successfully targets confirmed subscriber.\n');

  // 6. Test Idempotent Confirmation (Previously Confirmed Token)
  console.log('Test 6: Handling Previously Confirmed Token...');
  const secondConfirmRes = await confirmSubscription(db, subResult.confirmationToken);
  assert.strictEqual(secondConfirmRes.success, true, 'Previously confirmed token should not error');
  assert.strictEqual(secondConfirmRes.status, 'already_confirmed', 'Status should indicate already_confirmed');
  assert.strictEqual(secondConfirmRes.modelName, testModel.name);

  // Still active and verified
  const recipientsStillActive = await getSubscribersForModel(db, testModel.id);
  assert.strictEqual(recipientsStillActive.length, 1);
  console.log('✓ Re-confirming a verified token returns clean already_confirmed state.\n');

  // 7. Test Resubscribe When Confirmed vs Unconfirmed
  console.log('Test 7: Resubscribe Behavior for Confirmed vs Unconfirmed...');
  // Already confirmed user tries to subscribe again
  const resubConfirmed = await subscribeEmail(db, subEmail, testModel.id);
  assert.strictEqual(resubConfirmed.success, true);
  assert.strictEqual(resubConfirmed.alreadySubscribed, true);
  assert.strictEqual(resubConfirmed.isVerified, true);

  // Unconfirmed user tries to subscribe again
  const pendingUserEmail = 'pending-user@example.com';
  const firstPending = await subscribeEmail(db, pendingUserEmail, testModel.id);
  assert.strictEqual(firstPending.alreadySubscribed, false);
  assert.strictEqual(firstPending.isVerified, false);

  const secondPending = await subscribeEmail(db, pendingUserEmail, testModel.id);
  assert.strictEqual(secondPending.alreadySubscribed, false);
  assert.strictEqual(secondPending.isVerified, false);
  assert.ok(secondPending.confirmationToken, 'Preserves or refreshes confirmation token for unconfirmed user');
  console.log('✓ Resubscription accurately distinguishes confirmed vs unconfirmed users.\n');

  // 8. Test Confirmation Email HTML Generator
  console.log('Test 8: Confirmation Email Template Rendering...');
  const emailHtml = generateConfirmationEmailHtml({
    toEmail: 'tester@example.com',
    modelName: testModel.name,
    modelCode: testModel.model_code,
    confirmationToken: 'test-token-abcdef123456',
    appUrl: 'https://owntheglass.com',
  });

  assert.ok(emailHtml.includes('https://owntheglass.com/api/confirm?token=test-token-abcdef123456'), 'HTML must include verification link');
  assert.ok(emailHtml.includes(testModel.name), 'HTML must include model name');
  assert.ok(emailHtml.includes(testModel.model_code), 'HTML must include model code');
  assert.ok(emailHtml.includes('Confirm Firmware Alerts'), 'HTML must include CTA button');
  assert.ok(emailHtml.includes('Privacy Protection'), 'HTML must include privacy / air-gap notice');
  assert.ok(emailHtml.includes('<!DOCTYPE html>'), 'HTML must be a valid responsive HTML document');
  console.log('✓ Confirmation email HTML renders cleanly with verification URL and model details.\n');

  // 9. Test Email Dispatch Guard When API Key Missing
  console.log('Test 9: Email Dispatch Error Handling without API Key...');
  const sendRes = await sendConfirmationEmail('', '', {
    toEmail: 'tester@example.com',
    modelName: testModel.name,
    modelCode: testModel.model_code,
    confirmationToken: 'test-token',
  });
  assert.strictEqual(sendRes.success, false);
  assert.strictEqual(sendRes.error, 'RESEND_API_KEY is not configured');
  console.log('✓ Missing API key handled gracefully without throwing.\n');

  // Helper to create Astro API context
  function createApiContext(req, database, envOverrides = {}) {
    return {
      request: req,
      locals: {
        runtime: {
          env: {
            DB: database,
            RESEND_API_KEY: '',
            APP_URL: 'https://owntheglass.com',
            ...envOverrides,
          },
        },
      },
      redirect(path, status = 302) {
        return new Response(null, {
          status,
          headers: { Location: path },
        });
      },
    };
  }

  // 10. Test HTML Escaping and Sanitization in Email Generator
  console.log('Test 10: HTML Escaping and Sanitization in Email Generator...');
  const unsafeModel = {
    name: 'LG OLED 65" <Ultra> & Soundbar',
    model_code: 'OLED65&TEST',
  };
  const escapedHtml = generateConfirmationEmailHtml({
    toEmail: 'tester@example.com',
    modelName: unsafeModel.name,
    modelCode: unsafeModel.model_code,
    confirmationToken: 'test-token-esc',
    appUrl: 'https://owntheglass.com',
  });
  assert.ok(escapedHtml.includes('&amp; Soundbar'), 'Ampersand must be escaped');
  assert.ok(escapedHtml.includes('&lt;Ultra&gt;'), 'Angle brackets must be escaped');
  assert.ok(!escapedHtml.includes('<Ultra>'), 'Raw unescaped tags must not appear in HTML');
  assert.ok(escapedHtml.includes('OLED65&amp;TEST'), 'Model code special characters must be escaped');
  console.log('✓ Special characters in model name and code are cleanly HTML-escaped.\n');

  // 11. Test /api/confirm Endpoint Handler (Browser and API flows)
  console.log('Test 11: /api/confirm Endpoint Verification...');
  // 11a: Browser GET redirect flow
  const subBrowser = await subscribeEmail(db, 'browser-user@example.com', testModel.id);
  const browserReq = new Request(`https://owntheglass.com/api/confirm?token=${subBrowser.confirmationToken}`, {
    method: 'GET',
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  const browserRes = await confirmEndpoint(createApiContext(browserReq, db));
  assert.strictEqual(browserRes.status, 302, 'Browser request should return 302 redirect');
  assert.ok(
    browserRes.headers.get('Location')?.startsWith('/confirm?status=success'),
    'Browser should be redirected to /confirm?status=success'
  );

  // 11b: API GET JSON flow
  const subJson = await subscribeEmail(db, 'api-json-user@example.com', testModel.id);
  const jsonGetReq = new Request(`https://owntheglass.com/api/confirm?token=${subJson.confirmationToken}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const jsonGetRes = await confirmEndpoint(createApiContext(jsonGetReq, db));
  assert.strictEqual(jsonGetRes.status, 200, 'API GET request should return 200');
  const jsonGetData = await jsonGetRes.json();
  assert.strictEqual(jsonGetData.success, true);
  assert.strictEqual(jsonGetData.status, 'confirmed');

  // 11c: API POST JSON body flow
  const subPostJson = await subscribeEmail(db, 'api-post-user@example.com', testModel.id);
  const postReq = new Request('https://owntheglass.com/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: subPostJson.confirmationToken }),
  });
  const postRes = await confirmEndpoint(createApiContext(postReq, db));
  assert.strictEqual(postRes.status, 200, 'API POST JSON request should return 200');
  const postData = await postRes.json();
  assert.strictEqual(postData.success, true);
  assert.strictEqual(postData.status, 'confirmed');

  // 11d: API POST form URL-encoded body flow
  const subPostForm = await subscribeEmail(db, 'api-form-user@example.com', testModel.id);
  const formReq = new Request('https://owntheglass.com/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(subPostForm.confirmationToken)}`,
  });
  const formRes = await confirmEndpoint(createApiContext(formReq, db));
  assert.strictEqual(formRes.status, 200, 'API POST form request should return 200');
  const formData = await formRes.json();
  assert.strictEqual(formData.success, true);
  assert.strictEqual(formData.status, 'confirmed');

  // 11e: Already confirmed token via /api/confirm
  const alreadyReq = new Request(`https://owntheglass.com/api/confirm?token=${subJson.confirmationToken}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const alreadyRes = await confirmEndpoint(createApiContext(alreadyReq, db));
  assert.strictEqual(alreadyRes.status, 200);
  const alreadyData = await alreadyRes.json();
  assert.strictEqual(alreadyData.status, 'already_confirmed');

  // 11f: Missing and whitespace token via /api/confirm
  const wsReq = new Request('https://owntheglass.com/api/confirm?token=%20%20', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const wsRes = await confirmEndpoint(createApiContext(wsReq, db));
  assert.strictEqual(wsRes.status, 400);
  const wsData = await wsRes.json();
  assert.strictEqual(wsData.status, 'missing_token');

  // 11g: Invalid token via /api/confirm
  const badTokenReq = new Request('https://owntheglass.com/api/confirm?token=non-existent-token-xyz', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const badTokenRes = await confirmEndpoint(createApiContext(badTokenReq, db));
  assert.strictEqual(badTokenRes.status, 404);
  const badTokenData = await badTokenRes.json();
  assert.strictEqual(badTokenData.status, 'invalid_token');

  // 11h: Unsupported HTTP method (DELETE)
  const delReq = new Request('https://owntheglass.com/api/confirm', { method: 'DELETE' });
  const delRes = await confirmEndpoint(createApiContext(delReq, db));
  assert.strictEqual(delRes.status, 405, 'DELETE request should be rejected with 405 Method Not Allowed');

  // 11i: Missing DB binding
  const noDbReq = new Request(`https://owntheglass.com/api/confirm?token=${subJson.confirmationToken}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const noDbRes = await confirmEndpoint(createApiContext(noDbReq, null));
  assert.strictEqual(noDbRes.status, 500, 'Missing DB binding should return 500');
  console.log('✓ /api/confirm endpoint thoroughly verified for all methods, encodings, and error paths.\n');

  // 12. Test /api/subscribe Endpoint Handler
  console.log('Test 12: /api/subscribe Endpoint Verification...');
  // 12a: Valid subscription creation
  const subEpReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'endpoint-subscriber@example.com', modelId: testModel.id }),
  });
  const subEpRes = await subscribeEndpoint(createApiContext(subEpReq, db));
  assert.strictEqual(subEpRes.status, 200, 'Valid subscription request should return 200');
  const subEpData = await subEpRes.json();
  assert.strictEqual(subEpData.success, true);
  assert.strictEqual(subEpData.alreadySubscribed, false);
  assert.strictEqual(subEpData.isVerified, false);

  // 12b: Invalid email rejection
  const badEmailReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email-at-all', modelId: testModel.id }),
  });
  const badEmailRes = await subscribeEndpoint(createApiContext(badEmailReq, db));
  assert.strictEqual(badEmailRes.status, 400, 'Malformed email should return 400');

  // 12c: Missing modelId rejection
  const badModelReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'valid@example.com', modelId: '' }),
  });
  const badModelRes = await subscribeEndpoint(createApiContext(badModelReq, db));
  assert.strictEqual(badModelRes.status, 400, 'Missing modelId should return 400');

  // 12d: Non-existent modelId rejection
  const missingModelReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'valid@example.com', modelId: 'non-existent-tv-id-xyz' }),
  });
  const missingModelRes = await subscribeEndpoint(createApiContext(missingModelReq, db));
  assert.strictEqual(missingModelRes.status, 404, 'Non-existent modelId should return 404');

  // 12e: Invalid JSON body
  const badJsonReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not valid json {{{',
  });
  const badJsonRes = await subscribeEndpoint(createApiContext(badJsonReq, db));
  assert.strictEqual(badJsonRes.status, 400, 'Invalid JSON body should return 400');
  console.log('✓ /api/subscribe endpoint verified for validation, success, and error paths.\n');

  // 13. Test Malformed / Non-String Payload Resilience (Prevent Server Crashes)
  console.log('Test 13: Malformed & Non-String Payload Resilience...');
  // 13a: /api/confirm with number token
  const numTokenReq = new Request('https://owntheglass.com/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 999999 }),
  });
  const numTokenRes = await confirmEndpoint(createApiContext(numTokenReq, db));
  assert.strictEqual(numTokenRes.status, 404, 'Numeric token should be handled without 500 crash');
  const numTokenData = await numTokenRes.json();
  assert.strictEqual(numTokenData.status, 'invalid_token');

  // 13b: /api/confirm with object token
  const objTokenReq = new Request('https://owntheglass.com/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: { malicious: true } }),
  });
  const objTokenRes = await confirmEndpoint(createApiContext(objTokenReq, db));
  assert.strictEqual(objTokenRes.status, 400, 'Object token should be rejected with 400 missing_token');
  const objTokenData = await objTokenRes.json();
  assert.strictEqual(objTokenData.status, 'missing_token');

  // 13c: /api/confirm with array token
  const arrTokenReq = new Request('https://owntheglass.com/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ['token1', 'token2'] }),
  });
  const arrTokenRes = await confirmEndpoint(createApiContext(arrTokenReq, db));
  assert.strictEqual(arrTokenRes.status, 400, 'Array token should be rejected with 400 missing_token');

  // 13d: /api/subscribe with non-string email
  const numEmailReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 12345, modelId: testModel.id }),
  });
  const numEmailRes = await subscribeEndpoint(createApiContext(numEmailReq, db));
  assert.strictEqual(numEmailRes.status, 400, 'Non-string email must return 400 instead of 500');

  // 13e: /api/subscribe with non-string modelId
  const objModelReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'valid@example.com', modelId: { id: 'test' } }),
  });
  const objModelRes = await subscribeEndpoint(createApiContext(objModelReq, db));
  assert.strictEqual(objModelRes.status, 400, 'Non-string modelId must return 400 instead of 500');
  console.log('✓ Endpoints resiliently reject non-string malformed payloads without unhandled 500 server crashes.\n');

  // 14. Test Case-Insensitive Token Verification
  console.log('Test 14: Case-Insensitive Token Verification Resilience...');
  const caseSub = await subscribeEmail(db, 'case-user@example.com', testModel.id);
  const uppercaseToken = caseSub.confirmationToken.toUpperCase();
  const caseReq = new Request(`https://owntheglass.com/api/confirm?token=${encodeURIComponent(uppercaseToken)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const caseRes = await confirmEndpoint(createApiContext(caseReq, db));
  assert.strictEqual(caseRes.status, 200, 'Uppercase token should be accepted and confirmed');
  const caseData = await caseRes.json();
  assert.strictEqual(caseData.status, 'confirmed');
  console.log('✓ Token verification is resilient to client/email casing differences.\n');

  // 15. Test Firmware Alert Email HTML Escaping
  console.log('Test 15: Firmware Alert Email HTML Sanitization...');
  const unsafeAlert = generateFirmwareEmailHtml({
    toEmail: 'tester@example.com',
    modelName: 'OLED <Test> & Co',
    modelCode: 'OLED65<ESC>',
    version: '01.02.<03>',
    releaseDate: '2026-09-15" <alert>',
    fileSize: '1.2 GB & <strong>more</strong>',
    downloadUrl: 'https://example.com/fw.zip?param=1&foo=2',
    unsubscribeToken: 'unsub-token-xyz',
    appUrl: 'https://owntheglass.com',
  });
  assert.ok(!unsafeAlert.includes('<alert>'), 'Raw releaseDate tags must be escaped');
  assert.ok(unsafeAlert.includes('&lt;alert&gt;'), 'releaseDate must be properly HTML-escaped');
  assert.ok(!unsafeAlert.includes('<strong>more</strong>'), 'Raw fileSize tags must be escaped');
  assert.ok(unsafeAlert.includes('&lt;strong&gt;more&lt;/strong&gt;'), 'fileSize must be properly HTML-escaped');
  assert.ok(unsafeAlert.includes('&lt;03&gt;'), 'Version tags must be escaped');
  console.log('✓ All dynamic fields in firmware alert email are safely HTML-escaped.\n');

  // 16. Test Browser Form POST Content Negotiation (Returns 302 Redirect, Not Raw JSON)
  console.log('Test 16: Browser Form POST Content Negotiation...');
  const formBrowserSub = await subscribeEmail(db, 'form-browser-user@example.com', testModel.id);
  const formBrowserReq = new Request('https://owntheglass.com/api/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    body: `token=${encodeURIComponent(formBrowserSub.confirmationToken)}`,
  });
  const formBrowserRes = await confirmEndpoint(createApiContext(formBrowserReq, db));
  assert.strictEqual(formBrowserRes.status, 302, 'Browser HTML form submission should receive 302 redirect');
  assert.ok(
    formBrowserRes.headers.get('Location')?.startsWith('/confirm?status=success'),
    'Browser form should be redirected to /confirm landing page'
  );
  console.log('✓ Browser form POST redirects to /confirm landing UI rather than dumping raw JSON.\n');

  // 17. Test Email Subject CRLF Sanitization
  console.log('Test 17: Email Subject CRLF Sanitization...');
  const crlfModel = {
    ...testModel,
    name: "OLED TV\r\nBcc: victim@example.com\r\n",
  };

  const originalFetch = globalThis.fetch;
  const capturedPayloads = [];
  globalThis.fetch = async (url, options) => {
    if (options?.body) {
      try {
        capturedPayloads.push(JSON.parse(options.body));
      } catch {}
    }
    return new Response(JSON.stringify({ id: 'mock-resend-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const confRes = await sendConfirmationEmail('re_test_dummy_key', 'updates@owntheglass.com', {
      toEmail: 'tester@example.com',
      modelName: crlfModel.name,
      modelCode: crlfModel.model_code,
      confirmationToken: 'test-crlf-token',
    });
    assert.strictEqual(confRes.success, true);
    assert.strictEqual(confRes.id, 'mock-resend-id');
    assert.strictEqual(capturedPayloads.length, 1);
    const confSubject = capturedPayloads[0].subject;
    assert.ok(!confSubject.includes('\r'), 'Confirmation subject must not contain carriage returns');
    assert.ok(!confSubject.includes('\n'), 'Confirmation subject must not contain newlines');
    assert.strictEqual(
      confSubject,
      '[OwnTheGlass] Please confirm your firmware alerts for OLED TV Bcc: victim@example.com'
    );

    const alertRes = await sendFirmwareAlert('re_test_dummy_key', 'updates@owntheglass.com', {
      toEmail: 'tester@example.com',
      modelName: crlfModel.name,
      modelCode: crlfModel.model_code,
      version: "03.20.10\r\nSubject: Injected",
      unsubscribeToken: 'unsub-crlf',
    });
    assert.strictEqual(alertRes.success, true);
    assert.strictEqual(alertRes.id, 'mock-resend-id');
    assert.strictEqual(capturedPayloads.length, 2);
    const alertSubject = capturedPayloads[1].subject;
    assert.ok(!alertSubject.includes('\r'), 'Firmware alert subject must not contain carriage returns');
    assert.ok(!alertSubject.includes('\n'), 'Firmware alert subject must not contain newlines');
    assert.strictEqual(
      alertSubject,
      '[OwnTheGlass] New Firmware v03.20.10 Subject: Injected available for OLED TV Bcc: victim@example.com'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('✓ Email dispatchers safely handle CRLF in modelName/version without crashes.\n');

  // 18. Test Turnstile Bot Token Handling in /api/subscribe
  console.log('Test 18: Turnstile Bot Token Handling in /api/subscribe...');
  // 18a: Non-string turnstileToken payload should not crash with 500
  const badTurnstileReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'turnstile-test@example.com',
      modelId: testModel.id,
      turnstileToken: { invalid: true },
    }),
  });
  const badTurnstileRes = await subscribeEndpoint(createApiContext(badTurnstileReq, db));
  // In dev mode (no secret key), verifyTurnstileToken returns true, subscription succeeds
  assert.strictEqual(badTurnstileRes.status, 200, 'Non-string turnstileToken should not crash server');
  const badTurnstileData = await badTurnstileRes.json();
  assert.strictEqual(badTurnstileData.success, true);

  // 18b: When TURNSTILE_SECRET_KEY is configured and token is missing, reject with 403
  const missingTurnstileReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'turnstile-bot@example.com',
      modelId: testModel.id,
    }),
  });
  const missingTurnstileRes = await subscribeEndpoint(
    createApiContext(missingTurnstileReq, db, { TURNSTILE_SECRET_KEY: 'secret-key-12345' })
  );
  assert.strictEqual(missingTurnstileRes.status, 403, 'Missing turnstileToken with secret key must return 403');
  const missingTurnstileData = await missingTurnstileRes.json();
  assert.ok(missingTurnstileData.error.includes('Bot verification'));
  console.log('✓ Turnstile token handling verified for dev bypass, type safety, and production enforcement.\n');

  // 19. Test Error Message Propagation on Database Unavailable
  console.log('Test 19: Error Message Propagation on Database Unavailable...');
  const noDbBrowserReq = new Request('https://owntheglass.com/api/confirm?token=any-token', {
    method: 'GET',
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  const noDbBrowserRes = await confirmEndpoint(createApiContext(noDbBrowserReq, null));
  assert.strictEqual(noDbBrowserRes.status, 302);
  assert.ok(
    noDbBrowserRes.headers.get('Location')?.includes('status=error'),
    'Browser redirect should include status=error'
  );
  assert.ok(
    noDbBrowserRes.headers.get('Location')?.includes('Database+service+unavailable'),
    'Browser redirect should include error message'
  );
  console.log('✓ Database failure returns informative error redirect to /confirm landing UI.\n');

  // 20. Test Direct UI Landing Verification Flow via DB Helper
  console.log('Test 20: Direct UI Landing Verification Lifecycle...');
  const directSub = await subscribeEmail(db, 'direct-ui-user@example.com', testModel.id);
  // First confirmation succeeds
  const directResult1 = await confirmSubscription(db, directSub.confirmationToken);
  assert.strictEqual(directResult1.success, true);
  assert.strictEqual(directResult1.status, 'confirmed');
  assert.strictEqual(directResult1.modelName, testModel.name);

  // Second confirmation returns already_confirmed
  const directResult2 = await confirmSubscription(db, directSub.confirmationToken);
  assert.strictEqual(directResult2.success, true);
  assert.strictEqual(directResult2.status, 'already_confirmed');
  assert.strictEqual(directResult2.modelName, testModel.name);

  // Unconfirmed or invalid returns invalid_token
  const directResult3 = await confirmSubscription(db, 'random-token-xyz');
  assert.strictEqual(directResult3.success, false);
  assert.strictEqual(directResult3.status, 'invalid_token');
  console.log('✓ Direct UI confirmation lifecycle operates cleanly and idempotently.\n');

  // 21. Test Cross-Token Isolation (Unsubscribe Token Cannot Confirm Subscription)
  console.log('Test 21: Cross-Token Isolation...');
  const isolationSub = await subscribeEmail(db, 'isolation-user@example.com', testModel.id);
  const falseConfirmRes = await confirmSubscription(db, isolationSub.unsubscribeToken);
  assert.strictEqual(falseConfirmRes.success, false, 'Unsubscribe token must not be accepted as confirmation token');
  assert.strictEqual(falseConfirmRes.status, 'invalid_token');

  const isolationRaw = await db.getRawSubscription('isolation-user@example.com', testModel.id);
  assert.strictEqual(Number(isolationRaw.is_verified), 0, 'Subscription must remain unconfirmed');
  console.log('✓ Confirmation endpoint strictly isolates confirmation tokens from unsubscribe tokens.\n');

  // 22. Test Unsafe URL Protocol Sanitization in Email Templates
  console.log('Test 22: Unsafe URL Protocol Sanitization in Email Templates...');
  const unsafeFwHtml = generateFirmwareEmailHtml({
    toEmail: 'tester@example.com',
    modelName: testModel.name,
    modelCode: testModel.model_code,
    version: '03.20.10',
    downloadUrl: 'javascript:alert("pwned")',
    unsubscribeToken: 'unsub-safe',
    appUrl: 'javascript:alert("bad-host")',
  });
  assert.ok(!unsafeFwHtml.includes('javascript:alert'), 'Dangerous javascript: protocols must be stripped');
  assert.ok(!unsafeFwHtml.includes('Download Official Firmware (.zip)'), 'Unsafe downloadUrl must not render CTA link');

  const safeFwHtml = generateFirmwareEmailHtml({
    toEmail: 'tester@example.com',
    modelName: testModel.name,
    modelCode: testModel.model_code,
    version: '03.20.10',
    downloadUrl: 'https://gscs-b2c.lge.com/downloadFile?fileId=safe.zip',
    unsubscribeToken: 'unsub-safe',
    appUrl: 'https://owntheglass.com',
  });
  assert.ok(safeFwHtml.includes('https://gscs-b2c.lge.com/downloadFile?fileId=safe.zip'), 'Valid HTTPS download URL must render');
  console.log('✓ Email template prevents javascript: and dangerous URI protocol injection.\n');

  // 23. Test List-Unsubscribe Header Format & Trailing Slash Normalization
  console.log('Test 23: List-Unsubscribe Header Format & Trailing Slash Normalization...');
  const capturedFwPayloads = [];
  const testFetch = async (url, options) => {
    if (options?.body) {
      try {
        capturedFwPayloads.push(JSON.parse(options.body));
      } catch {}
    }
    return new Response(JSON.stringify({ id: 'mock-fw-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const originalFetch2 = globalThis.fetch;
  globalThis.fetch = testFetch;
  try {
    await sendFirmwareAlert('re_test_dummy_key', 'updates@owntheglass.com', {
      toEmail: 'tester@example.com',
      modelName: testModel.name,
      modelCode: testModel.model_code,
      version: '03.20.10',
      unsubscribeToken: 'unsub token+with spaces',
      appUrl: 'https://owntheglass.com/', // Trailing slash intentionally provided
    });
    assert.strictEqual(capturedFwPayloads.length, 1);
    const unsubHeader = capturedFwPayloads[0].headers['List-Unsubscribe'];
    assert.ok(unsubHeader, 'List-Unsubscribe header must be present');
    assert.ok(!unsubHeader.includes('//api'), 'Must not create double slashes in URL path');
    assert.ok(
      unsubHeader.includes('token=unsub%20token%2Bwith%20spaces'),
      'Unsubscribe token must be safely URL-encoded in header'
    );
  } finally {
    globalThis.fetch = originalFetch2;
  }
  console.log('✓ List-Unsubscribe header normalizes URL paths and escapes special characters.\n');

  // 24. Test Form URL-Encoded Submissions to /api/subscribe
  console.log('Test 24: Form URL-Encoded Submissions to /api/subscribe...');
  const formSubReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent('form-url-user@example.com')}&modelId=${encodeURIComponent(testModel.id)}`,
  });
  const formSubRes = await subscribeEndpoint(createApiContext(formSubReq, db));
  assert.strictEqual(formSubRes.status, 200, 'URL-encoded form submission to /api/subscribe must succeed');
  const formSubData = await formSubRes.json();
  assert.strictEqual(formSubData.success, true);
  assert.strictEqual(formSubData.alreadySubscribed, false);
  console.log('✓ /api/subscribe accepts standard application/x-www-form-urlencoded submissions.\n');

  // 25. Test Confirmation Fallback when Model Record is Absent
  console.log('Test 25: Confirmation Fallback when Model Record is Absent...');
  const tempModel = {
    id: 'temp-model-to-prune',
    brand: 'LG',
    name: 'Temporary Model',
    model_code: 'TEMP-MODEL-999',
    support_url: 'https://example.com/temp',
  };
  await db.seedModel(tempModel);
  const orphanSub = await subscribeEmail(db, 'orphan@example.com', tempModel.id);
  // Simulate orphaned subscription where model was removed/unmatched
  db.exec('PRAGMA foreign_keys = OFF;');
  await db.prepare('UPDATE email_subscriptions SET model_id = ? WHERE confirmation_token = ?').bind('unmatched-id', orphanSub.confirmationToken).run();
  // Or test confirmSubscription directly
  const orphanConfirmRes = await confirmSubscription(db, orphanSub.confirmationToken);
  assert.strictEqual(orphanConfirmRes.success, true, 'Confirming subscription should succeed');
  assert.strictEqual(orphanConfirmRes.status, 'confirmed');
  assert.strictEqual(orphanConfirmRes.modelName, 'TV Model', 'Should fall back to "TV Model" when model record is absent');
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('✓ Model confirmation gracefully falls back without crashes.\n');

  // 26. Test Bidirectional Cross-Token Isolation (Confirmation token cannot unsubscribe)
  console.log('Test 26: Bidirectional Cross-Token Isolation...');
  const bidiSub = await subscribeEmail(db, 'bidi-user@example.com', testModel.id);
  const bidiUnsubRes = await unsubscribeEmail(db, bidiSub.confirmationToken);
  assert.strictEqual(bidiUnsubRes.success, false, 'Confirmation token must not be accepted by unsubscribe');
  const bidiRaw = await db.getRawSubscription('bidi-user@example.com', testModel.id);
  assert.ok(bidiRaw, 'Subscription record must still exist in DB after false unsubscribe attempt');
  console.log('✓ Confirmation tokens cannot be used to unsubscribe records.\n');

  // 27. Test /api/unsubscribe Endpoint & Direct UI Lifecycle
  console.log('Test 27: /api/unsubscribe Endpoint Verification...');
  const unsubSub = await subscribeEmail(db, 'unsub-flow@example.com', testModel.id);
  // Missing token
  const noTokenReq = new Request('https://owntheglass.com/api/unsubscribe', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const noTokenRes = await unsubscribeEndpoint(createApiContext(noTokenReq, db));
  assert.strictEqual(noTokenRes.status, 400);
  const noTokenData = await noTokenRes.json();
  assert.strictEqual(noTokenData.status, 'missing_token');

  // Invalid token
  const invalidUnsubReq = new Request('https://owntheglass.com/api/unsubscribe?token=not-real', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const invalidUnsubRes = await unsubscribeEndpoint(createApiContext(invalidUnsubReq, db));
  assert.strictEqual(invalidUnsubRes.status, 404);
  const invalidUnsubData = await invalidUnsubRes.json();
  assert.strictEqual(invalidUnsubData.status, 'invalid_token');

  // Valid token
  const validUnsubReq = new Request(`https://owntheglass.com/api/unsubscribe?token=${unsubSub.unsubscribeToken}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const validUnsubRes = await unsubscribeEndpoint(createApiContext(validUnsubReq, db));
  assert.strictEqual(validUnsubRes.status, 200);
  const validUnsubData = await validUnsubRes.json();
  assert.strictEqual(validUnsubData.status, 'success');

  const afterUnsubRaw = await db.getRawSubscription('unsub-flow@example.com', testModel.id);
  assert.ok(!afterUnsubRaw, 'Subscription should be deleted after successful unsubscribe');
  console.log('✓ /api/unsubscribe endpoint verified for missing, invalid, and successful requests.\n');

  // 28. Test Email Template Full URL HTML-Escaping & Attribute Breakout Prevention
  console.log('Test 28: Email Template Full URL HTML-Escaping & Attribute Breakout Prevention...');
  const maliciousAppUrl = 'https://owntheglass.com/" onmouseover="alert(1)" data-foo="bar';
  const escapedFwHtml = generateFirmwareEmailHtml({
    toEmail: 'tester@example.com',
    modelName: 'OLED TV',
    modelCode: 'OLED65CX',
    version: '03.20.10',
    unsubscribeToken: 'unsub-token-123',
    appUrl: maliciousAppUrl,
  });
  assert.ok(!escapedFwHtml.includes('onmouseover='), 'Dangerous event handlers in appUrl must not be present');
  assert.ok(!escapedFwHtml.includes('data-foo='), 'Injected attributes must not be present');

  const escapedConfHtml = generateConfirmationEmailHtml({
    toEmail: 'tester@example.com',
    modelName: 'OLED TV',
    modelCode: 'OLED65CX',
    confirmationToken: 'conf-token-123',
    appUrl: maliciousAppUrl,
  });
  assert.ok(!escapedConfHtml.includes('onmouseover='), 'Dangerous event handlers in appUrl must not be present in confirmation');
  assert.ok(!escapedConfHtml.includes('data-foo='), 'Injected attributes must not be present in confirmation');

  // Verify escapeHtml utility
  assert.strictEqual(escapeHtml('<script>"test"&\'foo\'</script>'), '&lt;script&gt;&quot;test&quot;&amp;&#039;foo&#039;&lt;/script&gt;');
  console.log('✓ Email template URLs and links are strictly escaped against attribute injection.\n');

  // 29. Test CRLF Header Injection Prevention in List-Unsubscribe
  console.log('Test 29: CRLF Header Injection Prevention in List-Unsubscribe...');
  const crlfCapturedPayloads = [];
  const crlfFetch = async (url, options) => {
    if (options?.body) {
      try {
        crlfCapturedPayloads.push(JSON.parse(options.body));
      } catch {}
    }
    return new Response(JSON.stringify({ id: 'mock-fw-crlf-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const originalFetch3 = globalThis.fetch;
  globalThis.fetch = crlfFetch;
  try {
    await sendFirmwareAlert('re_test_dummy_key', 'updates@owntheglass.com', {
      toEmail: 'tester@example.com',
      modelName: testModel.name,
      modelCode: testModel.model_code,
      version: '03.20.10',
      unsubscribeToken: 'unsub-crlf-token',
      appUrl: 'https://owntheglass.com\r\nInjected-Header: malicious>\r\n',
    });
    assert.strictEqual(crlfCapturedPayloads.length, 1);
    const unsubHeader = crlfCapturedPayloads[0].headers['List-Unsubscribe'];
    assert.ok(!unsubHeader.includes('\r'), 'List-Unsubscribe must not contain carriage returns');
    assert.ok(!unsubHeader.includes('\n'), 'List-Unsubscribe must not contain newlines');
    assert.ok(!unsubHeader.includes('Injected-Header:'), 'Injected header text must not compromise header structure');
  } finally {
    globalThis.fetch = originalFetch3;
  }
  console.log('✓ CRLF injection prevented in List-Unsubscribe header.\n');

  // 30. Test Unsubscribe Token Null/Undefined Safety
  console.log('Test 30: Unsubscribe Token Null/Undefined Safety in Email Generator...');
  const nullTokenHtml = generateFirmwareEmailHtml({
    toEmail: 'tester@example.com',
    modelName: testModel.name,
    modelCode: testModel.model_code,
    version: '03.20.10',
    unsubscribeToken: undefined,
  });
  assert.ok(!nullTokenHtml.includes('token=undefined'), 'Template must not render literal "token=undefined"');
  assert.ok(!nullTokenHtml.includes('token=null'), 'Template must not render literal "token=null"');
  console.log('✓ Email template handles undefined unsubscribeToken without literal type strings.\n');

  // 31. Test /api/unsubscribe POST JSON, Form Body, and Non-String Payload Resilience
  console.log('Test 31: /api/unsubscribe POST Body & Malformed Payload Resilience...');
  const postSub1 = await subscribeEmail(db, 'unsub-post1@example.com', testModel.id);
  // 31a: POST with JSON body
  const postJsonReq = new Request('https://owntheglass.com/api/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: postSub1.unsubscribeToken }),
  });
  const postJsonRes = await unsubscribeEndpoint(createApiContext(postJsonReq, db));
  assert.strictEqual(postJsonRes.status, 200, 'POST JSON unsubscribe should return 200');
  const postJsonData = await postJsonRes.json();
  assert.strictEqual(postJsonData.success, true);
  assert.strictEqual(postJsonData.status, 'success');

  // 31b: POST with URL-encoded form data
  const postSub2 = await subscribeEmail(db, 'unsub-post2@example.com', testModel.id);
  const postFormReq = new Request('https://owntheglass.com/api/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(postSub2.unsubscribeToken)}`,
  });
  const postFormRes = await unsubscribeEndpoint(createApiContext(postFormReq, db));
  assert.strictEqual(postFormRes.status, 200, 'POST Form unsubscribe should return 200');
  const postFormData = await postFormRes.json();
  assert.strictEqual(postFormData.success, true);

  // 31c: POST with non-string token (number)
  const postNumReq = new Request('https://owntheglass.com/api/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 888888 }),
  });
  const postNumRes = await unsubscribeEndpoint(createApiContext(postNumReq, db));
  assert.strictEqual(postNumRes.status, 404, 'Numeric token should return 404 invalid_token without server crash');
  const postNumData = await postNumRes.json();
  assert.strictEqual(postNumData.status, 'invalid_token');

  // 31d: POST with object token
  const postObjReq = new Request('https://owntheglass.com/api/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: { evil: 'yes' } }),
  });
  const postObjRes = await unsubscribeEndpoint(createApiContext(postObjReq, db));
  assert.strictEqual(postObjRes.status, 400, 'Object token should return 400 missing_token without server crash');
  console.log('✓ /api/unsubscribe POST JSON, form data, and malformed payloads handled safely.\n');

  // 32. Test /api/unsubscribe HTTP Method Enforcement
  console.log('Test 32: /api/unsubscribe HTTP Method Enforcement...');
  const delUnsubReq = new Request('https://owntheglass.com/api/unsubscribe', { method: 'DELETE' });
  const delUnsubRes = await unsubscribeEndpoint(createApiContext(delUnsubReq, db));
  assert.strictEqual(delUnsubRes.status, 405, 'DELETE method must be rejected with 405 Method Not Allowed');

  const putUnsubReq = new Request('https://owntheglass.com/api/unsubscribe', { method: 'PUT' });
  const putUnsubRes = await unsubscribeEndpoint(createApiContext(putUnsubReq, db));
  assert.strictEqual(putUnsubRes.status, 405, 'PUT method must be rejected with 405 Method Not Allowed');
  console.log('✓ /api/unsubscribe strictly allows only GET and POST.\n');

  // 33. Test Case-Insensitive Unsubscribe Token Resilience
  console.log('Test 33: Case-Insensitive Unsubscribe Token Resilience...');
  const caseUnsub = await subscribeEmail(db, 'case-unsub@example.com', testModel.id);
  const upperUnsubToken = caseUnsub.unsubscribeToken.toUpperCase();
  const upperUnsubReq = new Request(`https://owntheglass.com/api/unsubscribe?token=${encodeURIComponent(upperUnsubToken)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const upperUnsubRes = await unsubscribeEndpoint(createApiContext(upperUnsubReq, db));
  assert.strictEqual(upperUnsubRes.status, 200, 'Uppercase unsubscribe token should be accepted and succeeded');
  const upperUnsubData = await upperUnsubRes.json();
  assert.strictEqual(upperUnsubData.status, 'success');

  const afterUpperRaw = await db.getRawSubscription('case-unsub@example.com', testModel.id);
  assert.ok(!afterUpperRaw, 'Subscription must be removed after case-insensitive unsubscribe');
  console.log('✓ Unsubscribe endpoint and DB helper are resilient to token casing variations.\n');

  // 34. Test RFC 5321 Email Length Boundary and Whitespace Trimming
  console.log('Test 34: RFC 5321 Email Length Boundary & Whitespace Handling...');
  // Email exceeding 254 chars
  const longEmail = 'a'.repeat(245) + '@example.com';
  assert.ok(longEmail.length > 254, 'Test email should exceed 254 chars');
  const longEmailReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: longEmail, modelId: testModel.id }),
  });
  const longEmailRes = await subscribeEndpoint(createApiContext(longEmailReq, db));
  assert.strictEqual(longEmailRes.status, 400, 'Email exceeding 254 characters must be rejected with 400');

  // Email with leading/trailing whitespace
  const spaceEmail = '  spaced-user@example.com  ';
  const spaceEmailReq = new Request('https://owntheglass.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: spaceEmail, modelId: testModel.id }),
  });
  const spaceEmailRes = await subscribeEndpoint(createApiContext(spaceEmailReq, db));
  assert.strictEqual(spaceEmailRes.status, 200);
  const spaceRaw = await db.getRawSubscription('spaced-user@example.com', testModel.id);
  assert.ok(spaceRaw, 'Subscription should be recorded with trimmed lowercase email');
  console.log('✓ Email length boundary (>254) and whitespace trimming verified.\n');

  // 35. Test Token Whitespace Tolerance in Endpoints
  console.log('Test 35: Token Whitespace Tolerance in Endpoints...');
  const wsSub = await subscribeEmail(db, 'ws-token-user@example.com', testModel.id);
  // Confirmation token with whitespace in query param
  const wsConfReq = new Request(`https://owntheglass.com/api/confirm?token=${encodeURIComponent('  ' + wsSub.confirmationToken + '  ')}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const wsConfRes = await confirmEndpoint(createApiContext(wsConfReq, db));
  assert.strictEqual(wsConfRes.status, 200, 'Confirmation token with whitespace should be accepted');
  const wsConfData = await wsConfRes.json();
  assert.strictEqual(wsConfData.status, 'confirmed');

  // Unsubscribe token with whitespace in query param
  const wsUnsubReq = new Request(`https://owntheglass.com/api/unsubscribe?token=${encodeURIComponent('  ' + wsSub.unsubscribeToken + '  ')}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const wsUnsubRes = await unsubscribeEndpoint(createApiContext(wsUnsubReq, db));
  assert.strictEqual(wsUnsubRes.status, 200, 'Unsubscribe token with whitespace should be accepted');
  const wsUnsubData = await wsUnsubRes.json();
  assert.strictEqual(wsUnsubData.status, 'success');
  console.log('✓ Token whitespace trimming verified across both confirmation and unsubscribe endpoints.\n');

  console.log('====================================================');
  console.log('🎉 ALL DOUBLE OPT-IN VERIFICATION TESTS PASSED (1-35)!');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
