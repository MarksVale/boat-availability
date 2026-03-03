const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const RESERVATIONS_TABLE = 'tblgrNXzhAyDx2JSM';
const BOAT_TYPES_TABLE = 'tbl5c4tD2a6kStsMQ';

async function fetchAirtable(tableId, filterFormula) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?filterByFormula=${encodeURIComponent(filterFormula)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Missing start_date or end_date' });
  }

  try {
    // Get total fleet per boat type dynamically from Boat Types table
    const boatTypesData = await fetchAirtable(BOAT_TYPES_TABLE, '1=1');
    const fleetMap = {}; // { reservationField: totalFleet }
    const boatTypeNames = {}; // { reservationField: boatTypeName }

    for (const r of (boatTypesData.records || [])) {
      const name = r.fields['Boat type name'];
      const total = r.fields['Total Fleet'] || 0;
      const reservationField = r.fields['Reservation Field'];
      if (name && reservationField) {
        fleetMap[reservationField] = total;
        boatTypeNames[reservationField] = name;
      }
    }

    // Get all reservations overlapping these dates
    const filter = `AND(
      IS_BEFORE({Sākuma datums (from Booking)}, "${end_date}"),
      IS_AFTER({Beigu datums (from Booking)}, "${start_date}")
    )`;

    const reservations = await fetchAirtable(RESERVATIONS_TABLE, filter);

    // Sum up already reserved per boat type
    const reserved = {};
    for (const field of Object.keys(fleetMap)) reserved[field] = 0;

    for (const r of (reservations.records || [])) {
      for (const field of Object.keys(fleetMap)) {
        reserved[field] += r.fields[field] || 0;
      }
    }

    // Build availability response
    const availability = {};
    for (const field of Object.keys(fleetMap)) {
      const name = boatTypeNames[field];
      availability[name] = {
        total: fleetMap[field],
        booked: reserved[field],
        available: Math.max(0, fleetMap[field] - reserved[field])
      };
    }

    return res.status(200).json({ start_date, end_date, availability });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
