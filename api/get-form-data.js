const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appYaHUWSdtuUSeaB';
const RIVERS_TABLE = 'tbljVF5T997io0iuJ';
const ROUTES_TABLE = 'tbl8OxvtV7vlgTCXe';

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
    const [riversData, routesData] = await Promise.all([
      fetchAirtable(RIVERS_TABLE, '{Active} = 1'),
      fetchAirtable(ROUTES_TABLE, '{Active} = 1')
    ]);

    const rivers = (riversData.records || []).map(r => ({
      id: r.id,
      name: r.fields['River name'],
      boatTypes: (r.fields['Boat Types'] || []).map(t => t.toLowerCase()) // ['kayaks','canoes','rafts'] → lowercase
    }));

    const routes = (routesData.records || []).map(r => ({
      id: r.id,
      name: r.fields['Route name'],
      riverId: r.fields['River']?.[0],
      hubName: r.fields['Starting Hub Lookup']?.[0] || ''
    }));

    return res.status(200).json({ rivers, routes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
