const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';

const BOOKINGS_TABLE      = 'tblXNo5L3RXt0fQVJ';
const BOOKING_LINES_TABLE = 'tblW1pCMNNHvNszEw';
const ROUTES_TABLE        = 'tbl8OxvtV7vlgTCXe';
const BOAT_STOCK_TABLE    = 'tblEBC4kim6uCheAX';
const TRANSFER_REQ_TABLE  = 'tblkcVaytjj43ziyq';

const SIGULDA_HUB   = 'recrY7hXQJNKgfBYI';
const MAZSALACA_HUB = 'recPMBRGRcejDTCkl';
const STAICELE_HUB  = 'recF5fXgd6132Vn8B';
const ALL_HUB_IDS   = [SIGULDA_HUB, MAZSALACA_HUB, STAICELE_HUB];

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

async function atDelete(tableId, recordId) {
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const log = [];

  try {
    const today = new Date().toISOString().slice(0, 10);

    const bookings = await fetchAll(BOOKINGS_TABLE, ['Status', 'Route', 'Sākuma datums', 'Beigu datums']);
    const confirmedBookings = bookings.filter(b => {
      const s = b.fields['Status'];
      return (s?.name || s) === 'Confirmed';
    });

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
          if (date < today) continue;
          demand[hubId][line.boatTypeId][date] = (demand[hubId][line.boatTypeId][date] || 0) + line.qty;
        }
      }
    }

    const stockRecords = await fetchAll(BOAT_STOCK_TABLE, ['Hub', 'Boat Type', 'Total Quantity']);
    const physStock = {};
    for (const s of stockRecords) {
      const hubId = s.fields['Hub']?.[0];
      const btId = s.fields['Boat Type']?.[0];
      if (!hubId || !btId) continue;
      if (!physStock[hubId]) physStock[hubId] = {};
      physStock[hubId][btId] = s.fields['Total Quantity'] || 0;
    }

    const existingTRs = await fetchAll(TRANSFER_REQ_TABLE, ['Status']);
    for (const tr of existingTRs) {
      const statusName = tr.fields['Status']?.name || tr.fields['Status'];
      if (statusName === 'Pending') await atDelete(TRANSFER_REQ_TABLE, tr.id);
    }

    const allBTs = new Set();
    for (const hubs of Object.values(demand)) {
      for (const bt of Object.keys(hubs)) allBTs.add(bt);
    }

    const newTRs = [];

    for (const bt of allBTs) {
      const dateSet = new Set();
      for (const hubId of ALL_HUB_IDS) {
        for (const date of Object.keys(demand[hubId]?.[bt] || {})) dateSet.add(date);
      }
      const sortedDates = [...dateSet].sort();
      if (sortedDates.length === 0) continue;

      const simStock = {};
      for (const hubId of ALL_HUB_IDS) simStock[hubId] = physStock[hubId]?.[bt] || 0;
      log.push(`bt=${bt} Sig=${simStock[SIGULDA_HUB]} Maz=${simStock[MAZSALACA_HUB]} Sta=${simStock[STAICELE_HUB]}`);

      for (const date of sortedDates) {
        for (const hubId of ALL_HUB_IDS) {
          const need = demand[hubId]?.[bt]?.[date] || 0;
          if (need <= 0) continue;
          if (simStock[hubId] >= need) continue;

          const shortfall = need - simStock[hubId];
          let bestSrc = null, bestAvail = 0;

          for (const src of ALL_HUB_IDS) {
            if (src === hubId) continue;
            const srcAvail = simStock[src] - (demand[src]?.[bt]?.[date] || 0);
            if (srcAvail > bestAvail) { bestAvail = srcAvail; bestSrc = src; }
          }

          if (!bestSrc || bestAvail <= 0) {
            log.push(`OVERBOOKED hub=${hubId} date=${date} short=${shortfall}`);
            continue;
          }

          const qty = Math.min(shortfall, bestAvail);
          simStock[hubId] += qty;
          simStock[bestSrc] -= qty;
          newTRs.push({ src: bestSrc, dest: hubId, bt, qty, date });
          log.push(`TR: ${bestSrc}→${hubId} qty=${qty} by=${date}`);
        }
      }
    }

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

    log.push(`Done: ${newTRs.length} TRs created`);
    return res.status(200).json({ success: true, log });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, log });
  }
}
