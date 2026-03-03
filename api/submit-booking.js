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

  const { firstName, lastName, email, phone, riverId, routeId, startDate, endDate, boatSelections, totalSeats, startTime, notes } = req.body;
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
      'Dienas': days,
      'Notes': notes || '',
      'Cik cilvēku plānojat būt': totalSeats || 0,
      'Status': 'Pending'
    });

    if (!bookingData.id) return res.status(400).json({ error: bookingData.error?.message || JSON.stringify(bookingData) });

    const bookingId = bookingData.id;

    // Create booking lines
    console.log('boatSelections:', JSON.stringify(boatSelections));
    for (const [boatTypeId, qty] of Object.entries(boatSelections || {})) {
      if (parseInt(qty) <= 0) continue;
      const lineResult = await airtablePost(BOOKING_LINES_TABLE, {
        'Booking': [bookingId],
        'Boat Type': [boatTypeId],
        'Quantity': parseInt(qty)
      });
      console.log('Line created:', JSON.stringify(lineResult));
    }

    return res.status(200).json({ success: true, id: bookingId });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
