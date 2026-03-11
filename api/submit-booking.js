const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const BOOKINGS_TABLE = 'tblXNo5L3RXt0fQVJ';
const BOOKING_LINES_TABLE = 'tblW1pCMNNHvNszEw';
const RESERVATIONS_TABLE = 'tblgrNXzhAyDx2JSM';
const RES_LINES_TABLE = 'tblPYvExPEx5GIqgK';
const BOAT_STOCK_TABLE = 'tblEBC4kim6uCheAX';

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
    // ── Step 1: Get total fleet stock across all hubs per boat type ──
    const stockRecords = await getAllRecords(BOAT_STOCK_TABLE, ['Boat Type', 'Total Quantity']);
    const totalStock = {};
    for (const s of stockRecords) {
      const btId = s.fields['Boat Type']?.[0];
      const qty = s.fields['Total Quantity'] || 0;
      if (btId) totalStock[btId] = (totalStock[btId] || 0) + qty;
    }

    // ── Step 2: Get confirmed reservations overlapping the requested dates ──
    // A reservation overlaps if: startDate < res.endDate AND endDate > res.startDate
    const filter = encodeURIComponent(
      `AND(IS_BEFORE({Sākuma datums (from Booking)}, "${endDate}"), IS_AFTER({Beigu datums (from Booking)}, "${startDate}"), {Type} = "Customer")`
    );
    const resResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${RESERVATIONS_TABLE}?filterByFormula=${filter}&fields[]=Reservation Lines`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } }
    );
    const resData = await resResponse.json();
    const overlappingResIds = new Set((resData.records || []).map(r => r.id));

    // ── Step 3: Sum reserved quantities from overlapping reservation lines ──
    const reservedQty = {};
    if (overlappingResIds.size > 0) {
      const resLines = await getAllRecords(RES_LINES_TABLE, ['Reservations', 'Boat Types', 'Quantity']);
      for (const line of resLines) {
        const resId = line.fields['Reservations']?.[0];
        const btId = line.fields['Boat Types']?.[0];
        const qty = line.fields['Quantity'] || 0;
        if (!resId || !btId) continue;
        if (!overlappingResIds.has(resId)) continue;
        reservedQty[btId] = (reservedQty[btId] || 0) + qty;
      }
    }

    // ── Step 4: Check for overbooking ──
    const shortReasons = [];
    for (const [btId, qty] of Object.entries(boatSelections || {})) {
      if (parseInt(qty) <= 0) continue;
      const needed = parseInt(qty);
      const available = (totalStock[btId] || 0) - (reservedQty[btId] || 0);
      if (available < needed) {
        shortReasons.push(`Boat type ${btId}: need ${needed}, available ${available}`);
      }
    }
    const overbookedReason = shortReasons.length > 0 ? shortReasons.join('; ') : null;

    // ── Step 5: Create booking ──
    const bookingFields = {
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
    };
    // Add overbooking reason to Notes if overbooked
    if (overbookedReason) {
      bookingFields['Notes'] = `[OVERBOOKED] ${overbookedReason}\n\n${notes || ''}`.trim();
    }

    const bookingData = await airtablePost(BOOKINGS_TABLE, bookingFields);
    if (!bookingData.id) return res.status(400).json({ error: bookingData.error?.message || JSON.stringify(bookingData) });
    const bookingId = bookingData.id;

    // ── Step 6: Create booking lines ──
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
