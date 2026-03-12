const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';

const BOOKINGS_TABLE      = 'tblXNo5L3RXt0fQVJ';
const BOOKING_LINES_TABLE = 'tblW1pCMNNHvNszEw';
const ROUTES_TABLE        = 'tbl8OxvtV7vlgTCXe';
const RESERVATIONS_TABLE  = 'tblgrNXzhAyDx2JSM';
const RES_LINES_TABLE     = 'tblPYvExPEx5GIqgK';
const BOAT_STOCK_TABLE    = 'tblEBC4kim6uCheAX';
const TRANSFER_REQ_TABLE  = 'tblkcVaytjj43ziyq';
const F_SUMMA          = 'fldOucFF4a7cZoF81';
const F_ORIGINAL_SUMMA = 'flds8H5omqyN9QW85';

const SIGULDA_HUB   = 'recrY7hXQJNKgfBYI';
const MAZSALACA_HUB = 'recPMBRGRcejDTCkl';
const STAICELE_HUB  = 'recF5fXgd6132Vn8B';
const ALL_HUB_IDS   = [SIGULDA_HUB, MAZSALACA_HUB, STAICELE_HUB];

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

// ── RECALCULATE TRANSFERS (day-by-day simulation) ────────────

async function recalculateTransfers() {
  log.push('--- recalculateTransfers start ---');

  const today = new Date().toISOString().slice(0, 10);

  // Load confirmed bookings
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

  // Build demand: hubId → btId → date → qty  (future dates only)
  const demand = {};
  for (const booking of confirmedBookings) {
    const hubId = routeToHub[booking.fields['Route']?.[0]];
    const startDate = booking.fields['Sākuma datums'];
    const endDate = booking.fields['Beigu datums'];
    if (!hubId || !startDate || !endDate) continue;

    for (const line of (linesByBooking[booking.id] || [])) {
      if (!line.boatTypeId || line.qty <= 0) continue;
      if (!demand[hubId]) demand[hubId] = {};
      if (!demand[hubId][line.boatTypeId]) demand[hubId][line.boatTypeId] = {};

      for (const date of dateRange(startDate, endDate)) {
        if (date < today) continue; // skip past dates
        demand[hubId][line.boatTypeId][date] = (demand[hubId][line.boatTypeId][date] || 0) + line.qty;
      }
    }
  }

  // Load physical stock
  const stockRecords = await fetchAll(BOAT_STOCK_TABLE, ['Hub', 'Boat Type', 'Total Quantity']);
  const physStock = {}; // hubId → btId → qty
  for (const s of stockRecords) {
    const hubId = s.fields['Hub']?.[0];
    const btId = s.fields['Boat Type']?.[0];
    if (!hubId || !btId) continue;
    if (!physStock[hubId]) physStock[hubId] = {};
    physStock[hubId][btId] = s.fields['Total Quantity'] || 0;
  }

  // Delete all Pending TRs — we recalculate from scratch
  // Status is a single-select field, returns an object {name: "Pending", ...}
  const existingTRs = await fetchAll(TRANSFER_REQ_TABLE, ['Status']);
  for (const tr of existingTRs) {
    const statusName = tr.fields['Status']?.name || tr.fields['Status'];
    if (statusName === 'Pending') {
      await atDelete(TRANSFER_REQ_TABLE, tr.id);
    }
  }

  // Collect all boat types with any future demand
  const allBTs = new Set();
  for (const hubs of Object.values(demand)) {
    for (const bt of Object.keys(hubs)) allBTs.add(bt);
  }

  // Day-by-day simulation per boat type
  const newTRs = [];

  for (const bt of allBTs) {
    // Collect all future demand dates for this bt across all hubs, sorted
    const dateSet = new Set();
    for (const hubId of ALL_HUB_IDS) {
      for (const date of Object.keys(demand[hubId]?.[bt] || {})) {
        dateSet.add(date);
      }
    }
    const sortedDates = [...dateSet].sort();
    if (sortedDates.length === 0) continue;

    // simStock for this bt starts at physical stock
    const simStock = {};
    for (const hubId of ALL_HUB_IDS) {
      simStock[hubId] = physStock[hubId]?.[bt] || 0;
    }

    log.push(`SIM bt=${bt} stock=${JSON.stringify(simStock)}`);

    for (const date of sortedDates) {
      for (const hubId of ALL_HUB_IDS) {
        const need = demand[hubId]?.[bt]?.[date] || 0;
        if (need <= 0) continue;
        log.push(`  ${date} hub=${hubId} need=${need} stock=${simStock[hubId]}`);
        if (simStock[hubId] >= need) continue;

        const shortfall = need - simStock[hubId];

        // Find best source: hub with most boats available on this date
        // Available at source = simStock[src] - source's own demand on this date
        // (source boats in use on this date can't be transferred)
        let bestSrc = null;
        let bestAvail = 0;

        for (const src of ALL_HUB_IDS) {
          if (src === hubId) continue;
          const srcDemandToday = demand[src]?.[bt]?.[date] || 0;
          const srcAvail = simStock[src] - srcDemandToday;
          if (srcAvail > bestAvail) {
            bestAvail = srcAvail;
            bestSrc = src;
          }
        }

        if (!bestSrc || bestAvail <= 0) {
          log.push(`OVERBOOKED: hub=${hubId} bt=${bt} date=${date} short=${shortfall} - no source available`);
          continue;
        }

        const qty = Math.min(shortfall, bestAvail);
        simStock[hubId] += qty;
        simStock[bestSrc] -= qty;

        newTRs.push({ src: bestSrc, dest: hubId, bt, qty, date });
        log.push(`Planned TR: ${bestSrc}→${hubId} bt=${bt} qty=${qty} by=${date}`);
      }
    }
  }

  // Create all new Pending TRs
  for (const tr of newTRs) {
    await atCreate(TRANSFER_REQ_TABLE, {
      'Boat Type': [tr.bt],
      'Source Hub': [tr.src],
      'Destination Hub': [tr.dest],
      'Quantity Needed': tr.qty,
      'Required By Date': tr.date,
      'Status': 'Pending'
    });
  }

  log.push(`Created ${newTRs.length} transfer requests`);
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
