// Meta Lead Ads Webhook Receiver
// Vercel Serverless Function
// Receives lead form submissions from Meta and stores them in Supabase

const crypto = require('crypto');

// Supabase client setup (server-side)
let supabase = null;
async function getSupabase() {
  if (supabase) return supabase;
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  return supabase;
}

// Verify Meta webhook signature
function verifySignature(req, body) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Fetch full lead data from Meta Graph API
async function fetchLeadData(leadgenId) {
  const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${process.env.META_ACCESS_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('Meta API error:', res.status, await res.text());
    return null;
  }
  return res.json();
}

// Fetch ad info for attribution
async function fetchAdInfo(adId) {
  if (!adId) return {};
  try {
    const url = `https://graph.facebook.com/v19.0/${adId}?fields=name,campaign{name},adset{name}&access_token=${process.env.META_ACCESS_TOKEN}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return {
        ad_name: data.name || '',
        campaign_name: data.campaign ? data.campaign.name : '',
        adset_name: data.adset ? data.adset.name : '',
      };
    }
  } catch (e) {
    console.warn('Could not fetch ad info:', e);
  }
  return {};
}

module.exports = async function handler(req, res) {
  // Webhook verification (GET request from Meta during setup)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  // Lead data webhook (POST request)
  if (req.method === 'POST') {
    // Verify signature
    if (process.env.META_APP_SECRET) {
      const rawBody = JSON.stringify(req.body);
      if (!verifySignature(req, rawBody)) {
        console.error('Invalid webhook signature');
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    try {
      const body = req.body;

      // Process each entry
      if (body.entry) {
        for (const entry of body.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.field === 'leadgen') {
                const leadgenId = change.value.leadgen_id;
                const adId = change.value.ad_id;
                const formId = change.value.form_id;
                const pageId = change.value.page_id;

                console.log('New Meta lead:', leadgenId);

                // Fetch full lead data from Meta
                const leadData = await fetchLeadData(leadgenId);
                if (!leadData) {
                  console.error('Could not fetch lead data for:', leadgenId);
                  continue;
                }

                // Parse field data from Meta lead form
                const fields = {};
                if (leadData.field_data) {
                  leadData.field_data.forEach(f => {
                    fields[f.name] = f.values ? f.values[0] : '';
                  });
                }

                // Fetch ad attribution info
                const adInfo = await fetchAdInfo(adId);

                // Build lead record
                const lead = {
                  name: [fields.first_name, fields.last_name].filter(Boolean).join(' ') || fields.full_name || 'Meta Lead',
                  email: fields.email || '',
                  phone: fields.phone_number || fields.phone || '',
                  company: fields.company_name || fields.company || '',
                  source: 'Meta Ads',
                  stage: 'new_lead',
                  deal_value: 0,
                  trailer_interest: fields.trailer_type || fields.product_interest || '',
                  notes: 'Auto-captured from Meta Lead Ad. Form: ' + (formId || 'unknown'),
                  assigned_to: 'Luke',
                  meta_lead_id: leadgenId,
                  fbclid: leadData.retailer_item_id || change.value.fbclid || '',
                  campaign_name: adInfo.campaign_name || '',
                  adset_name: adInfo.adset_name || '',
                  ad_name: adInfo.ad_name || '',
                  created_at: leadData.created_time || new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };

                // Store in Supabase
                if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
                  const sb = await getSupabase();
                  const { data, error } = await sb.from('leads').insert(lead).select().single();
                  if (error) {
                    console.error('Supabase insert error:', error);
                  } else {
                    console.log('Lead stored:', data.id);
                    // Add activity
                    await sb.from('activities').insert({
                      lead_id: data.id,
                      type: 'stage_change',
                      note: 'Lead captured from Meta Ads - ' + (adInfo.campaign_name || 'Unknown campaign'),
                      created_at: new Date().toISOString(),
                    });
                  }
                }
              }
            }
          }
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
