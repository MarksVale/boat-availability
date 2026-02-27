const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const BOOKINGS_TABLE = 'tblXNo5L3RXt0fQVJ';
const RIVERS_TABLE = 'tbljVF5T997io0iuJ';
const ROUTES_TABLE = 'tbl8OxvtV7vlgTCXe';

async function fetchAirtable(tableId, filterFormula) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?filterByFormula=${encodeURIComponent(filterFormula)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, phone, river, route, startDate, endDate, kayaks, canoes, startTime, days, notes } = req.body;

  try {
    // Look up River record ID
    const riverData = await fetchAirtable(RIVERS_TABLE, `{River Name} = "${river}"`);
    const riverRecord = riverData.records?.[0];
    if (!riverRecord) return res.status(400).json({ error: `River not found: ${river}` });

    // Look up Route record ID
    const routeData = await fetchAirtable(ROUTES_TABLE, `{Route Name} = "${route}"`);
    const routeRecord = routeData.records?.[0];
    if (!routeRecord) return res.status(400).json({ error: `Route not found: ${route}` });

    const fields = {
      'V\u0101rds': firstName,
      'Uzv\u0101rds': lastName,
      'E-pasts': email,
      'Numurs': phone,
      'River': [riverRecord.id],
      'Route': [routeRecord.id],
      'Kajaks (Vista, 2-viet\u012bga)': parseInt(kayaks) || 0,
      'Kanoe (Loksija, 3-viet\u012bga)': parseInt(canoes) || 0,
      'S\u0101kuma datums': startDate,
      'Beigu datums': endDate,
      'S\u0101kuma laiks': startTime || '',
      'Cik dienas pl\u0101nojat air\u0113t?': parseInt(days) || 1,
      'Pezi\u012bmes': notes || '',
      'Status': 'Pending'
    };

    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${BOOKINGS_TABLE}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    const data = await response.json();
    console.log('Airtable response:', JSON.stringify(data));

    if (response.ok) {
      return res.status(200).json({ success: true, id: data.id });
    } else {
      return res.status(400).json({ error: data.error?.message || JSON.stringify(data) });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
