// poster-regions.mjs — ONE region map, shared by every page that groups posters.
//
// The app's poster wall (poster-wall.vue), the preview gallery (build-gallery)
// and the HD review page (build-hd-gallery) all section the same 28 posters.
// Keeping three copies of this mapping guarantees they drift; this is the single
// source for the generator-side pages.
//
// Section names mirror poster-wall.vue exactly, so what a reviewer sees here
// matches what a reader sees in the product.
export const REGION_OF = {
  // Africa
  'west-africa': 'Africa', 'sudan': 'Africa', 'east-africa': 'Africa',
  'central-africa': 'Africa', 'southern-africa-islands': 'Africa',
  // Middle East. Maghreb+Egypt is geographically North Africa but reads as one
  // cultural/linguistic sweep with the Middle East, which is how DOXA files it.
  'maghreb-egypt': 'Middle East', 'middle-east-core': 'Middle East',
  // Central Asia is its OWN section — Pakistan, Afghanistan and the -stans are
  // not the Middle East.
  'uncovered-nas-a': 'Central Asia',
  // Southeast Asia + Oceania read as a single island sweep.
  'laos': 'Southeast Asia + Oceania', 'oceania-indonesia': 'Southeast Asia + Oceania',
  'mainland-se-asia-philippines': 'Southeast Asia + Oceania',
  // Americas
  'brazil': 'Americas', 'andean-caribbean': 'Americas', 'uncovered-scatter': 'Americas',
  'europe': 'Europe',
  // The Deaf bloc is a PEOPLE, not a place — it spans every region. The section
  // is named "Deaf" rather than "Affinity": it holds exactly one zone, so the
  // abstract category name told a reader nothing the zone name did not.
  'deaf': 'Deaf',
};

// India and China are their own sections rather than one lump called "Asia":
// between them they carry more people groups than every other section combined.
export const regionFor = (id) =>
  REGION_OF[id]
  || (String(id).startsWith('asia-india-') ? 'India'
   :  String(id).startsWith('asia-china-') ? 'China + Mongolia'
   :  'Other');

// Sections ordered by TOTAL people groups (largest first), and posters within a
// section by their own count — the densest prayer need leads at both levels.
export function sectionsOf(posters) {
  const by = new Map();
  for (const p of posters) {
    const r = regionFor(p.zoneKey);
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(p);
  }
  for (const list of by.values()) list.sort((a, b) => b.count - a.count);
  return [...by.entries()]
    .map(([name, list]) => ({ name, list, total: list.reduce((a, b) => a + b.count, 0) }))
    .sort((a, b) => b.total - a.total);
}
