const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';

const BOOKINGS_TABLE      = 'tblXNo5L3RXt0fQVJ';
const BOOKING_LINES_TABLE = 'tblW1pCMNNHvNszEw';
const ROUTES_TABLE        = 'tbl8OxvtV7vlgTCXe';
const RESERVATIONS_TABLE  = 'tblgrNXzhAyDx2JSM';
const RES_LINES_TABLE     = 'tblPYvExPEx5GIqgK';
const F_SUMMA          = 'fldOucFF4a7cZoF81';
const F_ORIGINAL_SUMMA = 'flds8H5omqyN9QW85';

const log = [];

async function fetchAll(tableId, fields) {
  let records = [], offset;
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
  do {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${fieldParams}${offset ? `&offset=${offset}` : ''}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
    const data = await resp.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

async function atCreate(tableId, fields) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return resp.json();
}

async function atDelete(tableId, recordId) {
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
  });
}

// ── SYNC RESERVATIONS ────────────────────────────────────────

async function syncReservations() {
  log.push('--- syncReservations start ---');

  const bookings = await fetchAll(BOOKINGS_TABLE, ['Status', 'Route', 'Booking Lines', 'Summa', 'Original Summa']);
  const routes = await fetchAll(ROUTES_TABLE, ['Starting Hub']);
  const routeToHub = {};
  for (const r of routes) routeToHub[r.id] = r.fields['Starting Hub']?.[0] || null;

  const allLines = await fetchAll(BOOKING_LINES_TABLE, ['Booking', 'Boat Type', 'Quantity']);
  const linesByBooking = {};
  for (const line of allLines) {
    const bId = line.fields['Booking']?.[0];
    if (!bId) continue;
    if (!linesByBooking[bId]) linesByBooking[bId] = [];
    linesByBooking[bId].push({ boatTypeId: line.fields['Boat Type']?.[0], qty: line.fields['Quantity'] || 0 });
  }

  const allReservations = await fetchAll(RESERVATIONS_TABLE, ['Booking', 'Type', 'Reservation Lines']);
  const customerResByBooking = {};
  for (const res of allReservations) {
    if (res.fields['Type'] === 'Hold') continue;
    const bId = res.fields['Booking']?.[0];
    if (!bId) continue;
    customerResByBooking[bId] = res;
  }

  const allResLines = await fetchAll(RES_LINES_TABLE, ['Reservations']);
  const resLinesByRes = {};
  for (const line of allResLines) {
    const resId = line.fields['Reservations']?.[0];
    if (!resId) continue;
    if (!resLinesByRes[resId]) resLinesByRes[resId] = [];
    resLinesByRes[resId].push(line.id);
  }

  async function deleteRes(res) {
    for (const lineId of (resLinesByRes[res.id] || [])) await atDelete(RES_LINES_TABLE, lineId);
    await atDelete(RESERVATIONS_TABLE, res.id);
  }

  for (const booking of bookings) {
    const status = booking.fields['Status'];
    const existingRes = customerResByBooking[booking.id];

    if (status !== 'Confirmed') {
      if (existingRes) {
        await deleteRes(existingRes);
        log.push(`Deleted reservation for non-confirmed booking ${booking.id} (${status})`);
      }
      continue;
    }

    const hubId = routeToHub[booking.fields['Route']?.[0]];
    const lines = linesByBooking[booking.id] || [];
    if (!hubId || lines.length === 0) continue;

    if (existingRes) await deleteRes(existingRes);

    const newRes = await atCreate(RESERVATIONS_TABLE, {
      'Booking': [booking.id],
      'Hub': [hubId],
      'Type': 'Customer'
    });
    if (!newRes.id) { log.push(`Failed to create reservation for ${booking.id}`); continue; }

    for (const line of lines) {
      if (!line.boatTypeId || line.qty <= 0) continue;
      await atCreate(RES_LINES_TABLE, {
        'Reservations': [newRes.id],
        'Boat Types': [line.boatTypeId],
        'Quantity': line.qty
      });
    }

    const currentSumma = booking.fields?.[F_SUMMA];
    const originalSumma = booking.fields?.[F_ORIGINAL_SUMMA];
    if (currentSumma && !originalSumma) {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${BOOKINGS_TABLE}/${booking.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [F_ORIGINAL_SUMMA]: parseFloat(currentSumma) } })
      });
      log.push(`Wrote Original Summa ${currentSumma} for booking ${booking.id}`);
    }

    log.push(`Synced reservation for booking ${booking.id}`);
  }
  log.push('--- syncReservations done ---');
}

// ── HANDLER ──────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await syncReservations();
    return res.status(200).json({ success: true, log });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, log });
  }
}
