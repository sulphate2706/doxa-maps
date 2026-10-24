// pip-proof.mjs — slice 09b-1 §1(d) can-fail proof for the PIP admin-stamp.
//
//   node plugin-designs/my-upg-100-list/data/pip-proof.mjs
//
// Asserts (exits 1 on any FAIL — a broken PIP yields 0 stamped -> FAILs):
//   1. >=99% of IND+CHN PGs got a REAL admin1 (report stamped/total + fallback).
//   2. Cross-check: Bihār (IND) and Yunnan Province (CHN) PIP counts are sane non-zero.
//   3. sum(IND admin-counts) == # IND PGs PIP-located (no double-stamp, none dropped).
//   4. same for CHN.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cache = JSON.parse(readFileSync("/tmp/upg-live-records-full.json", "utf8")).posts;
const mem = JSON.parse(readFileSync(join(__dirname, "admin-membership.json"), "utf8"));
const counts = JSON.parse(readFileSync(join(__dirname, "admin-counts.json"), "utf8"));

let fail = 0;
const ok = (c, msg) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fail = 1; };

console.log("================ 09b-1 PIP PROOF ================");

// Universe: IND + CHN records with finite latlng (the PIP candidates).
const isFin = (r) => Number.isFinite(parseFloat(r.latitude)) && Number.isFinite(parseFloat(r.longitude));
const indRecs = cache.filter((r) => r.country_code?.value === "IND" && isFin(r));
const chnRecs = cache.filter((r) => r.country_code?.value === "CHN" && isFin(r));
const indTotal = indRecs.length;
const chnTotal = chnRecs.length;
const total = indTotal + chnTotal;

const indStamped = indRecs.filter((r) => mem[r.slug]?.admin1).length;
const chnStamped = chnRecs.filter((r) => mem[r.slug]?.admin1).length;
const stamped = indStamped + chnStamped;
const pct = ((stamped / total) * 100).toFixed(2);

// fallback count: re-derive by checking which stamped records are NOT inside
// their polygon set (i.e. were assigned via nearest-centroid). We recompute the
// strict membership to separate real vs fallback for the report.
const ind = JSON.parse(readFileSync(join(__dirname, "gb-IND-ADM1.geojson"), "utf8"));
const chn = JSON.parse(readFileSync(join(__dirname, "gb-CHN-ADM1.geojson"), "utf8"));
function pir(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) c = !c; } return c; }
function ing(x, y, g) { const t = (rings) => { if (!pir(x, y, rings[0])) return false; for (let h = 1; h < rings.length; h++) if (pir(x, y, rings[h])) return false; return true; }; if (g.type === "Polygon") return t(g.coordinates); if (g.type === "MultiPolygon") return g.coordinates.some((p) => t(p)); return false; }
function strictIn(r, gj) { const x = parseFloat(r.longitude), y = parseFloat(r.latitude); return gj.features.some((f) => ing(x, y, f.geometry)); }
const fallback =
  indRecs.filter((r) => mem[r.slug]?.admin1 && !strictIn(r, ind)).length +
  chnRecs.filter((r) => mem[r.slug]?.admin1 && !strictIn(r, chn)).length;

console.log(`\n## (1) stamp rate`);
console.log(`  IND+CHN PIP candidates (finite latlng): ${total}  (IND ${indTotal}, CHN ${chnTotal})`);
console.log(`  stamped to a real admin1:               ${stamped}  (${pct}%)`);
console.log(`  of which nearest-centroid fallback:     ${fallback}`);
console.log(`  unstamped (out of tolerance -> null):   ${total - stamped}`);
ok(stamped / total >= 0.99, `>=99% of IND+CHN PGs stamped (got ${pct}%)`);

console.log(`\n## (2) known-admin cross-check`);
const bihar = counts.IND["Bihār"] ?? 0;
const yunnan = counts.CHN["Yunnan Province"] ?? 0;
console.log(`  Bihār (IND):            ${bihar}`);
console.log(`  Yunnan Province (CHN):  ${yunnan}`);
ok(bihar > 0, `Bihār count is non-zero (got ${bihar})`);
ok(yunnan > 0, `Yunnan Province count is non-zero (got ${yunnan})`);
// sanity band: a single admin-1 shouldn't hold a wild fraction of the country.
ok(bihar < indTotal && yunnan < chnTotal, `single-admin counts are sane (< country total)`);

console.log(`\n## (3)/(4) GROUP BY conservation (no double-stamp, none dropped)`);
const indSum = Object.values(counts.IND).reduce((a, b) => a + b, 0);
const chnSum = Object.values(counts.CHN).reduce((a, b) => a + b, 0);
console.log(`  sum(IND admin-counts) = ${indSum} ; IND PGs located = ${indStamped}`);
console.log(`  sum(CHN admin-counts) = ${chnSum} ; CHN PGs located = ${chnStamped}`);
ok(indSum === indStamped, `IND counts sum == IND located (${indSum} == ${indStamped})`);
ok(chnSum === chnStamped, `CHN counts sum == CHN located (${chnSum} == ${chnStamped})`);

console.log(`\n================ RESULT: ${fail === 0 ? "ALL-PASS" : "FAILED"} ================`);
process.exit(fail);
