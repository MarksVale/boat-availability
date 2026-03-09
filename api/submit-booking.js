const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const BOOKINGS_TABLE = 'tblXNo5L3RXt0fQVJ';
const BOOKING_LINES_TABLE = 'tblW1pCMNNHvNszEw';
const BOAT_STOCK_TABLE = 'tblEBC4kim6uCheAX';
const RESERVATIONS_TABLE = 'tblPYvExPEx5GIqgK';
const RESERVATION_LINES_TABLE = 'tblPYvExPEx5GIqgK';

async function airtableGet(tableId, params = '') {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}${params}`, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
  });
  return res.json();
}

async function airtablePost(tableId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return res.json();
}

async function getAllRecords(tableId, fields) {
  const allRecords = [];
  let offset = null;
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
  do {
    const url = `?${fieldParams}${offset ? `&offset=${offset}` : ''}`;
    const data = await airtableGet(tableId, url);
    if (data.records) allRecords.push(...data.records);
    offset = data.offset;
  } while (offset);
  return allRecords;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, phone, riverId, routeId, startDate, endDate,
          boatSelections, transportCost, startTime, notes, paymentMethod } = req.body;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.round((end - start) / 86400000) + 1;

  try {
    // ── Step 1: Check stock & existing reservations for overbooking ──
    const routeData = await airtableGet('tbl8OxvtV7vlgTCXe', `/${routeId}?fields[]=Starting Hub`);
    const hubId = routeData.fields?.['Starting Hub']?.[0];

    let overbookedReason = null;

    if (hubId) {
      const stockRecords = await getAllRecords(BOAT_STOCK_TABLE, ['Hub', 'Boat Type', 'Total Quantity']);
      const hubStock = {};
      for (const s of stockRecords) {
        if (s.fields['Hub']?.[0] === hubId) {
          const btId = s.fields['Boat Type']?.[0];
          if (btId) hubStock[btId] = s.fields['Total Quantity'] || 0;
        }
      }

      const totalStock = {};
      for (const s of stockRecords) {
        const btId = s.fields['Boat Type']?.[0];
        const qty = s.fields['Total Quantity'] || 0;
        if (btId) totalStock[btId] = (totalStock[btId] || 0) + qty;
      }

      const allResLines = await getAllRecords(RESERVATION_LINES_TABLE, ['Reservations', 'Boat Types', 'Quantity']);

      const reservedQty = {};
      for (const line of allResLines) {
        const btId = line.fields['Boat Types']?.[0];
        const qty = line.fields['Quantity'] || 0;
        if (btId) reservedQty[btId] = (reservedQty[btId] || 0) + qty;
      }

      const shortReasons = [];
      for (const [btId, qty] of Object.entries(boatSelections || {})) {
        if (parseInt(qty) <= 0) continue;
        const needed = parseInt(qty);
        const available = (totalStock[btId] || 0) - (reservedQty[btId] || 0);
        if (available < needed) {
          shortReasons.push(`Boat type ${btId}: need ${needed}, available ${available}`);
        }
      }

      if (shortReasons.length > 0) {
        overbookedReason = shortReasons.join('; ');
      }
    }

    // ── Step 2: Create booking ──
    const bookingData = await airtablePost(BOOKINGS_TABLE, {
      'Vārds': firstName,
      'Uzvārds': lastName,
      'E-pasts': email,
      'Numurs': phone,
      'River': [riverId],
      'Route': [routeId],
      'Sākuma datums': startDate,
      'Beigu datums': endDate,
      'Sākuma laiks': startTime || '',
      'Dienas': days,
      'Notes': notes || '',
      'Transporta izmaksas': transportCost || 0,
      'Payment Method': paymentMethod || 'Cash',
      'Status': overbookedReason ? 'Overbooked' : 'Pending',
      ...(overbookedReason ? { 'Overbooking Reason': overbookedReason } : {})
    });

    if (!bookingData.id) return res.status(400).json({ error: bookingData.error?.message || JSON.stringify(bookingData) });
    const bookingId = bookingData.id;

    // ── Step 3: Create booking lines ──
    for (const [boatTypeId, qty] of Object.entries(boatSelections || {})) {
      if (parseInt(qty) <= 0) continue;
      await airtablePost(BOOKING_LINES_TABLE, {
        'Booking': [bookingId],
        'Boat Type': [boatTypeId],
        'Quantity': parseInt(qty)
      });
    }

    return res.status(200).json({
      success: true,
      id: bookingId,
      overbooked: !!overbookedReason,
      reason: overbookedReason || null
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
