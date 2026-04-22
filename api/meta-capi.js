// Meta Conversions API (CAPI) Event Sender
// Vercel Serverless Function
// Sends deal stage change events back to Meta for ad optimization

const crypto = require('crypto');

// Hash PII data as required by Meta CAPI
function hashData(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    console.warn('Meta CAPI not configured - missing PIXEL_ID or ACCESS_TOKEN');
    return res.status(200).json({ success: false, message: 'CAPI not configured' });
  }

  try {
    const {
      event_name,
      lead_email,
      lead_phone,
      deal_value,
      currency,
      fbclid,
      meta_lead_id,
      stage,
    } = req.body;

    // Map CRM stages to Meta standard events
    const stageEventMap = {
      'Contact': 'Contact',
      'QualifiedLead': 'Lead',
      'Application': 'SubmitApplication',
      'Purchase': 'Purchase',
      'Other': 'Other',
    };

    const metaEventName = stageEventMap[event_name] || event_name || 'Lead';

    // Build CAPI event payload
    const eventData = {
      event_name: metaEventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: `crm_${stage}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      action_source: 'system_generated',
      user_data: {},
      custom_data: {
        value: deal_value || 0,
        currency: currency || 'AUD',
        content_name: 'NT Trailers - ' + (stage || 'stage_change'),
        status: stage,
      },
    };

    // Add hashed user data (Meta requires SHA256 hashing)
    if (lead_email) {
      eventData.user_data.em = [hashData(lead_email)];
    }
    if (lead_phone) {
      // Normalize Australian phone: remove spaces, ensure +61 prefix
      let phone = lead_phone.replace(/\s/g, '');
      if (phone.startsWith('0')) phone = '+61' + phone.substring(1);
      if (!phone.startsWith('+')) phone = '+61' + phone;
      eventData.user_data.ph = [hashData(phone)];
    }

    // Add fbclid for click attribution
    if (fbclid) {
      eventData.user_data.fbc = fbclid.startsWith('fb.') ? fbclid : `fb.1.${Date.now()}.${fbclid}`;
    }

    // Add Meta lead ID for lead-level attribution
    if (meta_lead_id) {
      eventData.user_data.lead_id = meta_lead_id;
    }

    // Add country (Australia)
    eventData.user_data.country = [hashData('au')];

    // Send to Meta Conversions API
    const capiUrl = `https://graph.facebook.com/v19.0/${pixelId}/events`;

    const response = await fetch(capiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [eventData],
        access_token: accessToken,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Meta CAPI error:', result);
      return res.status(200).json({
        success: false,
        message: 'CAPI event failed',
        error: result.error || result,
      });
    }

    console.log('CAPI event sent:', metaEventName, 'for stage:', stage, 'Result:', result);

    return res.status(200).json({
      success: true,
      event_name: metaEventName,
      events_received: result.events_received,
      fbtrace_id: result.fbtrace_id,
    });

  } catch (error) {
    console.error('CAPI error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
