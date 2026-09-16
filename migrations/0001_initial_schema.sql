-- OwnTheGlass D1 Schema Migration 0001

-- 1. TV Models Catalog
CREATE TABLE IF NOT EXISTS models (
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

CREATE INDEX IF NOT EXISTS idx_models_brand ON models(brand);
CREATE INDEX IF NOT EXISTS idx_models_model_code ON models(model_code);

-- 2. Email Subscriptions per Model
CREATE TABLE IF NOT EXISTS email_subscriptions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    model_id TEXT NOT NULL,
    unsubscribe_token TEXT NOT NULL UNIQUE,
    is_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sub_model ON email_subscriptions(model_id);
CREATE INDEX IF NOT EXISTS idx_sub_email ON email_subscriptions(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_unique ON email_subscriptions(email, model_id);

-- 3. Check History Logs
CREATE TABLE IF NOT EXISTS check_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL,
    version_found TEXT,
    status TEXT NOT NULL, -- 'SUCCESS', 'NEW_UPDATE', 'ERROR'
    message TEXT,
    checked_at TEXT NOT NULL
);

-- 4. Email Notification Logs
CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL,
    email TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL, -- 'SENT', 'FAILED'
    dispatched_at TEXT NOT NULL
);
