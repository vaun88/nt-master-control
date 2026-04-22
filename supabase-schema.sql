-- NT Trailers Master Control - CRM Database Schema
-- Run this in Supabase SQL Editor to create the CRM tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- LEADS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  source TEXT DEFAULT 'Website',
  stage TEXT DEFAULT 'new_lead',
  deal_value NUMERIC(12,2) DEFAULT 0,
  trailer_interest TEXT,
  notes TEXT,
  assigned_to TEXT DEFAULT 'Luke',

  -- Meta Attribution Fields
  meta_lead_id TEXT,
  fbclid TEXT,
  campaign_name TEXT,
  adset_name TEXT,
  ad_name TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ACTIVITIES TABLE (Activity Timeline)
-- ============================================
CREATE TABLE IF NOT EXISTS activities (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note',  -- 'note', 'stage_change', 'call', 'email'
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_meta_lead_id ON leads(meta_lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
-- Enable RLS on both tables
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Allow full access via anon key (for MVP/single-user app)
-- In production, replace with proper auth-based policies
CREATE POLICY "Allow all operations on leads" ON leads
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on activities" ON activities
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWS
-- ============================================
-- Pipeline summary view
CREATE OR REPLACE VIEW pipeline_summary AS
SELECT
  stage,
  COUNT(*) as lead_count,
  SUM(deal_value) as total_value,
  AVG(deal_value) as avg_value
FROM leads
WHERE stage NOT IN ('won', 'lost')
GROUP BY stage
ORDER BY
  CASE stage
    WHEN 'new_lead' THEN 1
    WHEN 'contacted' THEN 2
    WHEN 'qualified' THEN 3
    WHEN 'quoted' THEN 4
    WHEN 'negotiation' THEN 5
  END;

-- Source performance view
CREATE OR REPLACE VIEW source_performance AS
SELECT
  source,
  COUNT(*) as total_leads,
  COUNT(CASE WHEN stage = 'won' THEN 1 END) as won_count,
  SUM(CASE WHEN stage = 'won' THEN deal_value ELSE 0 END) as won_value,
  ROUND(
    COUNT(CASE WHEN stage = 'won' THEN 1 END)::NUMERIC /
    NULLIF(COUNT(CASE WHEN stage IN ('won', 'lost') THEN 1 END), 0) * 100, 1
  ) as win_rate
FROM leads
GROUP BY source
ORDER BY total_leads DESC;

-- Meta campaign performance view
CREATE OR REPLACE VIEW meta_campaign_performance AS
SELECT
  campaign_name,
  COUNT(*) as total_leads,
  COUNT(CASE WHEN stage = 'won' THEN 1 END) as won_count,
  SUM(deal_value) as pipeline_value,
  SUM(CASE WHEN stage = 'won' THEN deal_value ELSE 0 END) as won_value
FROM leads
WHERE source = 'Meta Ads' AND campaign_name IS NOT NULL AND campaign_name != ''
GROUP BY campaign_name
ORDER BY total_leads DESC;
