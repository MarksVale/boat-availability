// v3
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const DOMAIN = 'https://laivunoma.shop';
const BOOKING_PRODUCT_ID = 68;
const BOOKINGS_TABLE = 'tblXNo5L3RXt0fQVJ';

// Field IDs
const F_STATUS         = 'fldV3sHYYHvcdOndw';
const F_FIRST_NAME     = 'fldOxe3t6umlWtBMK';
const F_LAST_NAME      = 'fldinxAnarkeAWiE8';
const F_EMAIL          = 'fldp85n1qly0071N9';
const F_PHONE          = 'fldXGrjDM0BpZ2wcA';
const F_START_DATE     = 'fldkP75UtRxR0cEwC';
const F_END_DATE       = 'fldmYhNlsp4ifS3uP';
const F_PAYMENT_LINK   = 'fldEcUdqtf0dOws4K';
const F_NOTES          = 'fldpYRndrwPzE0YOg';
const F_SUMMA          = 'fldOucFF4a7cZoF81'; // current Summa (boats only, no transport)
const F_ORIGINAL_SUMMA = 'flds8H5omqyN9QW85'; // snapshot at first confirmation

async function wcRequest(path, method = 'GET', body = null) {
  const auth = Buffer.from(`${WC_CONSUMER_KEY}:${WC_CONSUMER_SECRET}`).toString('base64');
  const opts = {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(`${DOMAIN}/wp-json/wc/v3${path}`, opts);
    const text = await resp.text();
    if (text.includes('<!DOCTYPE') || text.includes('Bot Verification')) {
      if (attempt < 3) { await new Promise(r => setTimeout(r, 5000)); continue; }
      throw new Error(`Bot protection blocked WC API after ${attempt} attempts`);
    }
    return JSON.parse(text);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const bookingId = req.query.bookingId || req.body?.bookingId;
  if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

  try {
    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${BOOKINGS_TABLE}/${bookingId}?returnFieldsByFieldId=true`, {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
    });
    const record = await resp.json();
    if (!record.id) return res.status(404).json({ error: 'Booking not found' });

    const f = record.fields;
    const status = f[F_STATUS]?.name || f[F_STATUS];
    if (status !== 'Confirmed') {
      return res.status(400).json({ error: `Booking must be Confirmed, currently: ${status}` });
    }

    const currentSumma = parseFloat(f[F_SUMMA] || 0);
    const originalSumma = parseFloat(f[F_ORIGINAL_SUMMA] || 0);

    if (!originalSumma) {
      return res.status(400).json({
        error: 'Original Summa is not set. This booking was confirmed before this feature existed — set it manually.',
        currentSumma
      });
    }

    const difference = currentSumma - originalSumma;

    if (difference <= 0) {
      const now = new Date().toLocaleDateString('lv-LV');
      const note = difference < 0
        ? `[${now}] Boats reduced after confirmation. Original: €${originalSumma.toFixed(2)}, current: €${currentSumma.toFixed(2)}. ⚠️ REFUND NEEDED: €${Math.abs(difference).toFixed(2)} — handle manually.`
        : `[${now}] Regenerate Payment clicked — no change in boat total (€${currentSumma.toFixed(2)}). No new payment needed.`;

      const existingNotes = f[F_NOTES] || '';
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${BOOKINGS_TABLE}/${bookingId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [F_NOTES]: existingNotes ? `${existingNotes}\n\n${note}` : note } })
      });

      return res.status(200).json({ success: true, difference, note, newPaymentLink: null });
    }

    // difference > 0 — create WC order for the extra amount
    const net = difference.toFixed(2);
    const data = await wcRequest('/orders', 'POST', {
      status: 'pending',
      billing: {
        first_name: f[F_FIRST_NAME] || '',
        last_name: f[F_LAST_NAME] || '',
        email: f[F_EMAIL] || '',
        phone: f[F_PHONE] || ''
      },
      line_items: [{
        product_id: BOOKING_PRODUCT_ID,
        quantity: 1,
        subtotal: String(net),
        total: String(net)
      }],
      meta_data: [
        { key: 'booking_start', value: f[F_START_DATE] || '' },
        { key: 'booking_end', value: f[F_END_DATE] || '' },
        { key: 'airtable_record_id', value: bookingId },
        { key: 'extra_charge', value: 'true' },
        { key: 'original_summa', value: String(originalSumma) },
        { key: 'new_summa', value: String(currentSumma) }
      ]
    });

    const paymentUrl = `${DOMAIN}/?order_id=${data.id}&order_key=${data.order_key}&amount=${net}`;
    const now = new Date().toLocaleDateString('lv-LV');
    const note = `[${now}] Extra charge payment link generated. Original boats: €${originalSumma.toFixed(2)}, new boats: €${currentSumma.toFixed(2)}, extra: €${net}. WC Order #${data.number}`;
    const existingNotes = f[F_NOTES] || '';

    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${BOOKINGS_TABLE}/${bookingId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          [F_PAYMENT_LINK]: paymentUrl,
          [F_NOTES]: existingNotes ? `${existingNotes}\n\n${note}` : note
        }
      })
    });

    return res.status(200).json({ success: true, difference, originalSumma, currentSumma, paymentUrl, wcOrderId: data.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
