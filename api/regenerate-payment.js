const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const DOMAIN = 'https://laivunoma.shop';
const BOOKING_PRODUCT_ID = 68;

const BOOKINGS_TABLE = 'tblXNo5L3RXt0fQVJ';
const ROUTES_TABLE   = 'tbl8OxvtV7vlgTCXe';

// Field IDs — Bookings
const F_STATUS        = 'fldV3sHYYHvcdOndw';
const F_FIRST_NAME    = 'fldOxe3t6umlWtBMK';
const F_LAST_NAME     = 'fldinxAnarkeAWiE8';
const F_EMAIL         = 'fldp85n1qly0071N9';
const F_PHONE         = 'fldXGrjDM0BpZ2wcA';
const F_START_DATE    = 'fldkP75UtRxR0cEwC';
const F_END_DATE      = 'fldmYhNlsp4ifS3uP';
const F_TOTAL         = 'flddeIwyM6qLEKlFJ'; // Maksājuma summa kopā (formula)
const F_PAYMENT_LINK  = 'fldEcUdqtf0dOws4K';
const F_PAYMENT_STATUS= 'fldi1dKkL4r0Gh8Fx';
const F_NOTES         = 'fldpYRndrwPzE0YOg';
const F_ROUTE         = 'fldMjQxWr3ppNJ8AH';
const F_SUMMARY       = 'fldUYw7DdVDfaGAo6';

async function airtableGet(recordId) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${BOOKINGS_TABLE}/${recordId}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
  });
  return resp.json();
}

async function airtablePatch(recordId, fields) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${BOOKINGS_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return resp.json();
}

async function wcRequest(path, method = 'GET', body = null) {
  const auth = Buffer.from(`${WC_CONSUMER_KEY}:${WC_CONSUMER_SECRET}`).toString('base64');
  const opts = {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);

  // Retry up to 3 times (Hostinger bot protection)
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

async function createWcOrder(amount, booking) {
  const net = parseFloat(amount).toFixed(2);
  const data = await wcRequest('/orders', 'POST', {
    status: 'pending',
    billing: {
      first_name: booking.firstName,
      last_name: booking.lastName,
      email: booking.email,
      phone: booking.phone
    },
    line_items: [{
      product_id: BOOKING_PRODUCT_ID,
      quantity: 1,
      subtotal: String(net),
      total: String(net)
    }],
    meta_data: [
      { key: 'booking_start', value: booking.startDate },
      { key: 'booking_end', value: booking.endDate },
      { key: 'airtable_record_id', value: booking.id }
    ]
  });
  return {
    orderId: data.id,
    orderKey: data.order_key,
    paymentUrl: `${DOMAIN}/?order_id=${data.id}&order_key=${data.order_key}&amount=${net}`
  };
}

async function cancelWcOrder(orderId) {
  try {
    await wcRequest(`/orders/${orderId}`, 'PUT', { status: 'cancelled' });
  } catch (e) {
    // Non-fatal — old order cancel failure shouldn't block new order
    console.log(`Warning: could not cancel old WC order ${orderId}: ${e.message}`);
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
    // Load booking
    const record = await airtableGet(bookingId);
    if (!record.id) return res.status(404).json({ error: 'Booking not found' });

    const f = record.fields;
    const status = f[F_STATUS]?.name || f[F_STATUS];
    if (status !== 'Confirmed') {
      return res.status(400).json({ error: `Booking status is "${status}" — only Confirmed bookings can regenerate payment` });
    }

    const booking = {
      id: bookingId,
      firstName: f[F_FIRST_NAME] || '',
      lastName: f[F_LAST_NAME] || '',
      email: f[F_EMAIL] || '',
      phone: f[F_PHONE] || '',
      startDate: f[F_START_DATE] || '',
      endDate: f[F_END_DATE] || '',
    };

    const newTotal = parseFloat(f[F_TOTAL] || 0);
    const paymentStatus = f[F_PAYMENT_STATUS]?.name || f[F_PAYMENT_STATUS] || '';
    const existingLink = f[F_PAYMENT_LINK] || '';
    const existingNotes = f[F_NOTES] || '';

    // Extract old WC order ID from existing payment link if present
    let oldOrderId = null;
    if (existingLink) {
      const match = existingLink.match(/order_id=(\d+)/);
      if (match) oldOrderId = match[1];
    }

    let newLink = null;
    let noteAddition = '';
    const now = new Date().toLocaleDateString('lv-LV');

    if (paymentStatus !== 'Paid') {
      // ── CASE 1: Not paid — cancel old order, create new full amount ──
      if (oldOrderId) await cancelWcOrder(oldOrderId);
      const wc = await createWcOrder(newTotal, booking);
      newLink = wc.paymentUrl;
      noteAddition = `[${now}] Payment link regenerated. New total: €${newTotal.toFixed(2)}`;

    } else {
      // Load what the customer already paid — extract from old link or assume full original
      // We need the original paid amount — store it separately would be ideal,
      // but for now we use the current total as a proxy if we don't have it
      // Best approach: admin provides the paid amount as a query param
      const paidAmount = parseFloat(req.query.paidAmount || req.body?.paidAmount || 0);

      if (paidAmount === 0) {
        // No paid amount provided — return instructions
        return res.status(400).json({
          error: 'Booking is marked Paid. Please provide paidAmount parameter (what customer already paid) to calculate difference.',
          currentTotal: newTotal
        });
      }

      const difference = newTotal - paidAmount;

      if (difference > 0) {
        // ── CASE 2: Paid, new total higher — charge difference ──
        const wc = await createWcOrder(difference, booking);
        newLink = wc.paymentUrl;
        noteAddition = `[${now}] Booking edited after payment. Previously paid: €${paidAmount.toFixed(2)}, new total: €${newTotal.toFixed(2)}, supplementary payment link for difference: €${difference.toFixed(2)}`;

      } else if (difference < 0) {
        // ── CASE 3: Paid, new total lower — refund needed ──
        const refundAmount = Math.abs(difference).toFixed(2);
        noteAddition = `[${now}] Booking edited after payment. Previously paid: €${paidAmount.toFixed(2)}, new total: €${newTotal.toFixed(2)}. ⚠️ REFUND NEEDED: €${refundAmount} to customer manually via WooCommerce or bank transfer.`;
        // Keep existing payment link, no new order needed

      } else {
        // No change
        noteAddition = `[${now}] Booking edited after payment — total unchanged at €${newTotal.toFixed(2)}. No new payment needed.`;
      }
    }

    // Update booking in Airtable
    const updates = {
      [F_NOTES]: existingNotes ? `${existingNotes}\n\n${noteAddition}` : noteAddition
    };
    if (newLink) updates[F_PAYMENT_LINK] = newLink;

    await airtablePatch(bookingId, updates);

    return res.status(200).json({
      success: true,
      paymentStatus,
      newTotal,
      newPaymentLink: newLink || null,
      note: noteAddition
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
