-- OwnTheGlass D1 Schema Migration 0002
-- Add confirmation_token column to email_subscriptions for double opt-in verification

ALTER TABLE email_subscriptions ADD COLUMN confirmation_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_confirmation_token ON email_subscriptions(confirmation_token);
