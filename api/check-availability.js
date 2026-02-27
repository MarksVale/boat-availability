const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const RESERVATIONS_TABLE = 'tblgrNXzhAyDx2JSM';
const BOAT_STOCK_TABLE = 'tblEBC4kim6uCheAX';

async function fetchAirtable(tableId, filterFormula) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?filterByFormula=${encodeURIComponent(filterFormula)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
  });
  const data = await res.json();
  return data.records || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { hub, start_date, end_date } = req.query;

  if (!hub || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing hub, start_date, or end_date' });
  }

  try {
    // Fetch all Boat Stock records, filter by hub using Stock ID field
    const stockRecords = await fetchAirtable(BOAT_STOCK_TABLE, '1=1');

    let totalKayaks = 0;
    let totalCanoes = 0;

    for (const r of stockRecords) {
      const stockId = r.fields['Stock ID'] || '';
      const qty = r.fields['Total Quantity'] || 0;
      if (!stockId.startsWith(hub)) continue;
      if (stockId.includes('Vista')) totalKayaks += qty;
      if (stockId.includes('Loksija')) totalCanoes += qty;
    }

    // Get overlapping reservations for this hub
    const filter = `AND(
      {Hub} = "${hub}",
      IS_BEFORE({Sākuma datums (from Booking)}, "${end_date}"),
      IS_AFTER({Beigu datums (from Booking)}, "${start_date}")
    )`;

    const reservations = await fetchAirtable(RESERVATIONS_TABLE, filter);

    let bookedKayaks = 0;
    let bookedCanoes = 0;

    for (const r of reservations) {
      bookedKayaks += r.fields['Kayaks Reserved'] || 0;
      bookedCanoes += r.fields['Canoes Reserved'] || 0;
    }

    return res.status(200).json({
      hub,
      start_date,
      end_date,
      available_kayaks: Math.max(0, totalKayaks - bookedKayaks),
      available_canoes: Math.max(0, totalCanoes - bookedCanoes),
      total_kayaks: totalKayaks,
      total_canoes: totalCanoes,
      booked_kayaks: bookedKayaks,
      booked_canoes: bookedCanoes
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
