const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const BOOKINGS_TABLE = 'tblXNo5L3RXt0fQVJ';
const BOOKING_LINES_TABLE = 'tblW1pCMNNHvNszEw';

async function airtablePost(tableId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, phone, riverId, routeId, startDate, endDate, boatSelections, startTime, notes } = req.body;
  // boatSelections: { [boatTypeId]: quantity }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.round((end - start) / 86400000) + 1;

  try {
    // Create booking
    const bookingData = await airtablePost(BOOKINGS_TABLE, {
      'Vārds': firstName,
      'Uzvārds': lastName,
      'E-pasts': email,
      'Numurs': phone,
      'River': [riverId],
      'Route': [routeId],
      'Sākuma datums': startDate,
      'Beigu datums': endDate,
      'Sākuma laiks': startTime || '',
      'Cik dienas plānojat airēt?': days,
      'Notes': notes || '',
      'Status': 'Pending'
    });

    if (!bookingData.id) return res.status(400).json({ error: bookingData.error?.message || JSON.stringify(bookingData) });

    const bookingId = bookingData.id;

    // Create booking lines
    const linePromises = Object.entries(boatSelections || {})
      .filter(([_, qty]) => parseInt(qty) > 0)
      .map(([boatTypeId, qty]) =>
        airtablePost(BOOKING_LINES_TABLE, {
          'Booking': [{ id: bookingId }],
          'Boat Type': [{ id: boatTypeId }],
          'Quantity': parseInt(qty)
        })
      );

    await Promise.all(linePromises);

    return res.status(200).json({ success: true, id: bookingId });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
