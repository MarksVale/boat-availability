const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const BOOKINGS_TABLE = 'tblXNo5L3RXt0fQVJ';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, phone, river, route, startDate, endDate, kayaks, canoes, startTime, days, notes } = req.body;

  const fields = {
    'Vārds': firstName,
    'Uzvārds': lastName,
    'E-pasts': email,
    'Numurs': phone,
    'River': river,
    'Route': route,
    'Kajaks (Vista, 2-vietīga)': parseInt(kayaks) || 0,
    'Kanoe (Loksija, 3-vietīga)': parseInt(canoes) || 0,
    'Sākuma datums': startDate,
    'Beigu datums': endDate,
    'Sākuma laiks': startTime || '',
    'Cik dienas plānojat airēt?': parseInt(days) || 1,
    'Piezīmes': notes || '',
    'Status': 'Pending'
  };

  try {
    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${BOOKINGS_TABLE}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    const data = await response.json();

    if (response.ok) {
      return res.status(200).json({ success: true, id: data.id });
    } else {
      return res.status(400).json({ error: data.error?.message || 'Airtable error' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
