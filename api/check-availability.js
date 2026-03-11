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

  const queryStart = new Date(start_date);
  const queryEnd = new Date(end_date);

  try {
    // Get total fleet per boat type
    const boatTypes = await fetchAll(BOAT_TYPES_TABLE, ['Boat type name', 'Total Fleet']);
    const fleetMap = {};
    for (const bt of boatTypes) {
      fleetMap[bt.id] = {
        name: bt.fields['Boat type name'],
        total: bt.fields['Total Fleet'] || 0
      };
    }

    // Fetch all Customer reservations with their dates
    const reservations = await fetchAll(RESERVATIONS_TABLE, [
      'Type',
      'Sākuma datums (from Booking)',
      'Beigu datums (from Booking)',
      'Reservation Lines'
    ]);

    // Filter overlapping Customer reservations in JS (lookup fields can't be filtered in Airtable formulas)
    const overlappingResIds = new Set();
    for (const r of reservations) {
      // Skip Hold reservations
      const typeVal = r.fields['Type'];
      const typeName = typeof typeVal === 'string' ? typeVal : typeVal?.name;
      if (typeName === 'Hold') continue;

      const startRaw = r.fields['Sākuma datums (from Booking)'];
      const endRaw = r.fields['Beigu datums (from Booking)'];

      // Lookup fields return nested objects — extract the actual date string
      let resStart, resEnd;
      if (Array.isArray(startRaw)) {
        resStart = new Date(startRaw[0]);
      } else if (startRaw?.valuesByLinkedRecordId) {
        const vals = Object.values(startRaw.valuesByLinkedRecordId);
        resStart = new Date(vals[0]?.[0]);
      }
      if (Array.isArray(endRaw)) {
        resEnd = new Date(endRaw[0]);
      } else if (endRaw?.valuesByLinkedRecordId) {
        const vals = Object.values(endRaw.valuesByLinkedRecordId);
        resEnd = new Date(vals[0]?.[0]);
      }

      if (!resStart || !resEnd || isNaN(resStart) || isNaN(resEnd)) continue;

      // Overlap: resStart <= queryEnd AND resEnd >= queryStart
      if (resStart <= queryEnd && resEnd >= queryStart) {
        overlappingResIds.add(r.id);
      }
    }

    // Sum reserved quantities from overlapping reservation lines
    const reserved = {};
    if (overlappingResIds.size > 0) {
      const resLines = await fetchAll(RES_LINES_TABLE, ['Reservations', 'Boat Types', 'Quantity']);
      for (const line of resLines) {
        const resId = line.fields['Reservations']?.[0];
        const btId = line.fields['Boat Types']?.[0];
        const qty = line.fields['Quantity'] || 0;
        if (!resId || !btId) continue;
        if (!overlappingResIds.has(resId)) continue;
        reserved[btId] = (reserved[btId] || 0) + qty;
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
