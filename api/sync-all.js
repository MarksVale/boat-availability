const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';

const BOOKINGS_TABLE      = 'tblXNo5L3RXt0fQVJ';
const BOOKING_LINES_TABLE = 'tblW1pCMNNHvNszEw';
const ROUTES_TABLE        = 'tbl8OxvtV7vlgTCXe';
const RESERVATIONS_TABLE  = 'tblgrNXzhAyDx2JSM';
const RES_LINES_TABLE     = 'tblPYvExPEx5GIqgK';
const BOAT_STOCK_TABLE    = 'tblEBC4kim6uCheAX';
const TRANSFER_REQ_TABLE  = 'tblkcVaytjj43ziyq';

const SIGULDA_HUB   = 'recrY7hXQJNKgfBYI';
const MAZSALACA_HUB = 'recPMBRGRcejDTCkl';
const STAICELE_HUB  = 'recF5fXgd6132Vn8B';

const log = [];

function dateRange(startStr, endStr) {
  const dates = [];
  const cur = new Date(startStr);
  const end = new Date(endStr);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

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

async function atPatch(tableId, recordId, fields) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    method: 'PATCH',
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

  const bookings = await fetchAll(BOOKINGS_TABLE, ['Status', 'Route', 'Booking Lines']);
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
    log.push(`Synced reservation for booking ${booking.id}`);
  }

  log.push('--- syncReservations done ---');
}

// ── RECALCULATE TRANSFERS ────────────────────────────────────

async function recalculateTransfers() {
  log.push('--- recalculateTransfers start ---');

  const bookings = await fetchAll(BOOKINGS_TABLE, ['Status', 'Route', 'Sākuma datums', 'Beigu datums']);
  const confirmedBookings = bookings.filter(b => b.fields['Status'] === 'Confirmed');

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

  // Build demand map
  const demand = {};
  for (const booking of confirmedBookings) {
    const hubId = routeToHub[booking.fields['Route']?.[0]];
    const startDate = booking.fields['Sākuma datums'];
    const endDate = booking.fields['Beigu datums'];
    if (!hubId || !startDate || !endDate || hubId === SIGULDA_HUB) continue;
    for (const line of (linesByBooking[booking.id] || [])) {
      if (!line.boatTypeId || line.qty <= 0) continue;
      if (!demand[hubId]) demand[hubId] = {};
      if (!demand[hubId][line.boatTypeId]) demand[hubId][line.boatTypeId] = {};
      for (const date of dateRange(startDate, endDate)) {
        demand[hubId][line.boatTypeId][date] = (demand[hubId][line.boatTypeId][date] || 0) + line.qty;
      }
    }
  }

  // Load stock
  const stockRecords = await fetchAll(BOAT_STOCK_TABLE, ['Hub', 'Boat Type', 'Total Quantity']);
  const stock = {};
  for (const s of stockRecords) {
    const hubId = s.fields['Hub']?.[0];
    const btId = s.fields['Boat Type']?.[0];
    if (!hubId || !btId) continue;
    if (!stock[hubId]) stock[hubId] = {};
    stock[hubId][btId] = s.fields['Total Quantity'] || 0;
  }

  // Load existing Pending TRs
  const existingTRs = await fetchAll(TRANSFER_REQ_TABLE, ['Boat Type', 'Source Hub', 'Destination Hub', 'Status']);
  const pendingTRs = {};
  for (const tr of existingTRs) {
    if (tr.fields['Status'] !== 'Pending') continue;
    const btId = tr.fields['Boat Type']?.[0];
    const destId = tr.fields['Destination Hub']?.[0];
    if (!btId || !destId) continue;
    const key = `${destId}__${btId}`;
    if (!pendingTRs[key]) pendingTRs[key] = [];
    pendingTRs[key].push(tr);
  }

  // Calculate needed transfers
  const neededTransfers = {};
  for (const [hubId, boatTypes] of Object.entries(demand)) {
    for (const [boatTypeId, dateDemand] of Object.entries(boatTypes)) {
      const hubStock = stock[hubId]?.[boatTypeId] || 0;
      let maxDemand = 0, earliestDate = null;
      for (const [date, qty] of Object.entries(dateDemand)) {
        if (qty > maxDemand || (qty === maxDemand && (!earliestDate || date < earliestDate))) {
          maxDemand = qty; earliestDate = date;
        }
      }
      const shortfall = maxDemand - hubStock;
      if (shortfall <= 0) continue;
      const key = `${hubId}__${boatTypeId}`;
      neededTransfers[key] = { destHubId: hubId, boatTypeId, qty: shortfall, requiredByDate: earliestDate };
    }
  }

  // Reconcile
  for (const [key, needed] of Object.entries(neededTransfers)) {
    const existing = pendingTRs[key];
    if (existing?.length > 0) {
      await atPatch(TRANSFER_REQ_TABLE, existing[0].id, {
        'Quantity Needed': needed.qty,
        'Required By Date': needed.requiredByDate
      });
      for (let i = 1; i < existing.length; i++) await atDelete(TRANSFER_REQ_TABLE, existing[i].id);
      log.push(`Updated TR for ${key}: qty=${needed.qty}`);
    } else {
      await atCreate(TRANSFER_REQ_TABLE, {
        'Boat Type': [needed.boatTypeId],
        'Source Hub': [SIGULDA_HUB],
        'Destination Hub': [needed.destHubId],
        'Quantity Needed': needed.qty,
        'Required By Date': needed.requiredByDate,
        'Status': 'Pending'
      });
      log.push(`Created TR for ${key}: qty=${needed.qty}`);
    }
  }

  // Delete no-longer-needed Pending TRs
  for (const [key, existing] of Object.entries(pendingTRs)) {
    if (!neededTransfers[key]) {
      for (const tr of existing) {
        await atDelete(TRANSFER_REQ_TABLE, tr.id);
        log.push(`Deleted obsolete TR ${tr.id}`);
      }
    }
  }

  log.push('--- recalculateTransfers done ---');
}

// ── HANDLER ──────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await syncReservations();
    await recalculateTransfers();
    return res.status(200).json({ success: true, log });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, log });
  }
}
