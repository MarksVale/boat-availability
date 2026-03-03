const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const RIVERS_TABLE = 'tbljVF5T997io0iuJ';
const ROUTES_TABLE = 'tbl8OxvtV7vlgTCXe';
const BOAT_TYPES_TABLE = 'tbl5c4tD2a6kStsMQ';
const BOOKING_WINDOWS_TABLE = 'tblT7dUHbvvkdI1qi';

async function fetchAirtable(tableId, filter) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}` + (filter ? `?filterByFormula=${encodeURIComponent(filter)}` : '');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [riversData, routesData, boatTypesData, windowsData] = await Promise.all([
      fetchAirtable(RIVERS_TABLE, '{Active} = 1'),
      fetchAirtable(ROUTES_TABLE, '{Active} = 1'),
      fetchAirtable(BOAT_TYPES_TABLE, '{Active} = 1'),
      fetchAirtable(BOOKING_WINDOWS_TABLE, '')
    ]);

    // Boat types array with ID
    const boatTypes = (boatTypesData.records || []).map(r => ({
      id: r.id,
      name: r.fields['Boat type name'],
      price: r.fields['Price per day'] || 0,
      capacity: r.fields['Seating Capacity'] || 1
    }));

    // Legacy boatTypeMap keyed by lowercase name
    const boatTypeMap = {};
    boatTypes.forEach(bt => {
      boatTypeMap[bt.name.toLowerCase()] = {
        id: bt.id,
        name: bt.name,
        price: bt.price,
        capacity: bt.capacity
      };
    });

    // Booking windows
    const bookingWindows = (windowsData.records || []).map(r => ({
      riverId: (r.fields['Rivers'] || [])[0] || null,
      seasonOpen: r.fields['Season Open'] || null,
      seasonClose: r.fields['Season Close'] || null,
      type: r.fields['Blocked Dates'] || 'Open',
      notes: r.fields['Notes'] || ''
    })).filter(w => w.riverId);

    const rivers = (riversData.records || []).map(r => ({
      id: r.id,
      name: r.fields['River name'],
      boatTypes: (r.fields['Boat Types'] || []) // linked record IDs
    }));

    const routes = (routesData.records || []).map(r => ({
      id: r.id,
      name: r.fields['Route name'],
      riverId: r.fields['River']?.[0],
      hubName: r.fields['Starting Hub Lookup']?.[0] || '',
      startTimes: r.fields['Start Times'] || []
    }));

    return res.status(200).json({ rivers, routes, boatTypes, boatTypeMap, bookingWindows });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
