// Parse docs/popular-companies-by-sector.md into companies.json: { id, name, hq, sectors[] }
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync(
  new URL('../../docs/popular-companies-by-sector.md', import.meta.url),
  'utf8',
);
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const SKIP =
  /^(FRC|ICAEW|Rovio|Moore Kingston|Babylon|YMCA|State governments|Local councils|Universities|University of Cape|Tsinghua|Government of India|Lagos State|GCHQ|Federal Reserve|Canada Public|Australian Public|Singapore Public|Atos|Sodexo Government|Ark Schools|KIPP|Cainiao|China State|WeWork)/;
const ALIAS = {
  'Alphabet / Google': ['Google'],
  'Instacart/Maplebear': ['Instacart'],
  'TikTok / ByteDance': ['ByteDance'],
  'Meta AI / FAIR': ['Meta'],
  'Foxconn / Hon Hai': ['Foxconn'],
  'Broadcom / Symantec': ['Broadcom'],
  'BT Group / EE': ['BT Group'],
  'Airtel / Bharti': ['Bharti Airtel'],
  'e& / Etisalat': ['e&'],
  'Block / Square': ['Block'],
  'Mazars / Forvis Mazars': ['Forvis Mazars'],
  'Fresenius / Helios': ['Fresenius'],
  'NMC Health / Mediclinic': ['Mediclinic'],
  'Catalent / Novo Holdings': ['Catalent'],
  'UnitedHealth Group / Optum': ['UnitedHealth Group'],
  'CVS Health / Aetna': ['CVS Health'],
  'Cigna / Evernorth': ['Cigna'],
  'Huma / Kry': ['Huma', 'Kry'],
  'Comcast / NBCUniversal': ['Comcast'],
  'RELX / Elsevier': ['RELX'],
  'Financial Times / Nikkei': ['Financial Times'],
  'Microsoft Gaming / Xbox': ['Microsoft Gaming'],
  'Take-Two / Rockstar': ['Take-Two Interactive'],
  'BPP / Apollo Education': ['BPP'],
  'Médecins Sans Frontières / MSF': ['Médecins Sans Frontières'],
  'Abt Associates / RTI International': ['Abt Associates', 'RTI International'],
  'RSPCA / RSPB': ['RSPCA', 'RSPB'],
  'WTO / WIPO': ['WTO', 'WIPO'],
  'European Commission / EPSO': ['European Commission'],
  'RTX / Raytheon': ['RTX'],
  'IAG: British Airways / Iberia': ['International Airlines Group'],
  'FedEx / UPS Airlines': [],
  'Hyundai / Kia': ['Hyundai Motor Group'],
  'Tata Motors / JLR': ['Tata Motors', 'Jaguar Land Rover'],
  'Schlumberger / SLB': ['SLB'],
  'Sinopec / CNPC': ['Sinopec', 'CNPC'],
  'Centrica / British Gas': ['Centrica'],
  'Adani Green / Tata Power': ['Adani Green', 'Tata Power'],
  'Tata Steel / Tata Group': ['Tata Steel'],
  'ACS / Hochtief': ['ACS', 'Hochtief'],
  'Schwarz Group (Lidl/Kaufland)': ['Schwarz Group'],
  'IKEA / Ingka': ['IKEA'],
  'Johnson & Johnson Consumer / Kenvue': ['Kenvue'],
  "Kellogg's / Kellanova": ['Kellanova'],
  'Olam / Wilmar': ['Olam', 'Wilmar'],
  'Dangote / Olam Nigeria': [],
  'Whitbread / Premier Inn': ['Whitbread'],
  'Las Vegas Sands / MGM': ['Las Vegas Sands', 'MGM Resorts'],
  'Royal Mail / International Distribution Services': ['Royal Mail'],
  'G4S / Allied Universal': ['Allied Universal'],
  'Dangote Group': ['Dangote Group'],
  Dentsu: ['Dentsu'],
  'Cushman & Wakefield': ['Cushman & Wakefield'],
};
const bySlug = new Map();
const sectors = [];
for (let sec of md.split(/\n## (?=\d+\. )/).slice(1)) {
  sec = sec.split(/\n---/)[0];
  const m = sec.match(/^(\d+)\. (.+)/);
  const sid = slug(m[2]);
  const sectorEntry = { id: sid, name: m[2].trim(), companies: [] };
  sectors.push(sectorEntry);
  const body = sec
    .split('\n')
    .slice(1)
    .filter(
      (l) =>
        /^\d+\. /.test(l) ||
        (l && !/^(Note|Universities post|Public sector|---|#)/.test(l) && !/^\s*$/.test(l)),
    );
  const text = body.join(' ').replace(/\s+/g, ' ');
  for (const part of text
    .split(/(?:^|\s)\d{1,2}\. /)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const mm = part.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    let name = (mm ? mm[1] : part).trim();
    const hq = mm ? mm[2] : null;
    if (!name || SKIP.test(name)) continue;
    for (const n of ALIAS[name] ?? [name]) {
      const id = slug(n);
      if (!sectorEntry.companies.includes(id)) sectorEntry.companies.push(id);
      const c = bySlug.get(id) ?? { id, name: n, hq, sectors: [] };
      if (!c.sectors.includes(sid)) c.sectors.push(sid);
      bySlug.set(id, c);
    }
  }
}
const list = [...bySlug.values()];
writeFileSync('companies.json', JSON.stringify({ sectors, companies: list }, null, 1));
console.log(sectors.length, 'sectors', list.length, 'companies');
console.log(
  list
    .filter((c) => /\/|,| and /.test(c.name))
    .map((c) => c.name)
    .join(' | '),
);
