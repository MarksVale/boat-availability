const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const BOOKINGS_TABLE = 'tblXNo5L3RXt0fQVJ';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, phone, riverId, routeId, startDate, endDate, kayaks, canoes, rafts, startTime, notes } = req.body;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.round((end - start) / 86400000) + 1;

  const fields = {
    'Vārds': firstName,
    'Uzvārds': lastName,
    'E-pasts': email,
    'Numurs': phone,
    'River': [riverId],
    'Route': [routeId],
    'Kajaks (Vista, 2-vietīga)': parseInt(kayaks) || 0,
    'Kanoe (Loksija, 3-vietīga)': parseInt(canoes) || 0,
    'Rafts': parseInt(rafts) || 0,
    'Sākuma datums': startDate,
    'Beigu datums': endDate,
    'Sākuma laiks': startTime || '',
    'Cik dienas plānojat airēt?': days,
    'Notes': notes || '',
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
