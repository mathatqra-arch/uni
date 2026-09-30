-- ============================================================
-- Migration 008: loyalty_campaigns.product_id
-- ============================================================
-- Campaigns are being redesigned from generic date-range/multiplier
-- promotions into simple "buy this specific product, earn this many
-- extra loyalty points" campaigns the owner sets up per product (see
-- desktop-api.ts handleCreateSale's campaign-bonus block and
-- loyalty.tsx CampaignsTab). That needs a product to point at, which
-- the original schema never had — this adds it as a plain nullable
-- column (no FK enforcement, consistent with how other *_id columns
-- were added in migration 006 for the same tauri-plugin-sql setup).
-- ============================================================

ALTER TABLE loyalty_campaigns ADD COLUMN product_id TEXT;
