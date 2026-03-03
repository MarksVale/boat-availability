const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const RESERVATIONS_TABLE = 'tblgrNXzhAyDx2JSM';
const RES_LINES_TABLE = 'tblPYvExPEx5GIqgK';
const BOAT_TYPES_TABLE = 'tbl5c4tD2a6kStsMQ';

async function fetchAll(tableId, fields) {
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
  let records = [], offset;
  do {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${fieldParams}${offset ? `&offset=${offset}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) return res.status(400).json({ error: 'Missing start_date or end_date' });

  try {
    // Get total fleet per boat type
    const boatTypes = await fetchAll(BOAT_TYPES_TABLE, ['Boat type name', 'Total Fleet']);
    const fleetMap = {}; // id → { name, total }
    for (const bt of boatTypes) {
      fleetMap[bt.id] = {
        name: bt.fields['Boat type name'],
        total: bt.fields['Total Fleet'] || 0
      };
    }

    // Get all reservations overlapping dates
    const filter = `AND(IS_BEFORE({Sākuma datums (from Booking)}, "${end_date}"), IS_AFTER({Beigu datums (from Booking)}, "${start_date}"))`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${RESERVATIONS_TABLE}?filterByFormula=${encodeURIComponent(filter)}`;
    const resResponse = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
    const resData = await resResponse.json();
    const reservationIds = (resData.records || []).map(r => r.id);

    // Get reservation lines for these reservations
    const reserved = {}; // btId → qty
    if (reservationIds.length > 0) {
      const resLines = await fetchAll(RES_LINES_TABLE, ['Reservation', 'Boat Type', 'Quantity']);
      for (const line of resLines) {
        const resLink = line.fields['Reservation']?.[0];
        const btLink  = line.fields['Boat Type']?.[0];
        const qty     = line.fields['Quantity'] || 0;
        if (!resLink || !btLink) continue;
        if (!reservationIds.includes(resLink)) continue;
        reserved[btLink] = (reserved[btLink] || 0) + qty;
      }
    }

    // Build availability response
    const availability = {};
    for (const [id, { name, total }] of Object.entries(fleetMap)) {
      availability[id] = {
        name,
        total,
        booked: reserved[id] || 0,
        available: Math.max(0, total - (reserved[id] || 0))
      };
    }

    return res.status(200).json({ start_date, end_date, availability });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
