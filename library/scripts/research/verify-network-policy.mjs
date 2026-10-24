// verify-network-policy.mjs — the research box must READ research, never PROBE.
//
//   node verify-network-policy.mjs
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// The research build only READS published research; it never probes country networks
// directly. A build host that sends probes to foreign networks exposes its own address
// in their logs and invites scanning back.
//
// This ASSERTS the no-network-probe rule — because a policy
// nobody checks is the declared-but-unasserted trap, which has already produced
// three real defects in this repo.
//
// The dangerous change is a single innocent line: `await fetch('http://' + host)`
// to "just check if X is reachable." That one line turns a reader of published
// research into a measurement probe, puts the build host's address in a foreign network's logs, and
// looks identical to reconnaissance from the outside.
//
// PROVEN RED: add a ping/nmap call or a fetch to a non-allowlisted host, re-run.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Hosts this corpus is permitted to contact: PUBLISHED RESEARCH / REGISTRIES ONLY.
// Adding to this list is a deliberate, reviewable act — never a silent import.
const ALLOWED = [
  'api.worldbank.org',            // public statistics
  'api.ooni.io',                  // open censorship-measurement corpus (THEIR probes)
  'stat.ripe.net',                // public ASN registry
  'gs.statcounter.com',           // published platform share
  'rss.applemarketingtools.com',  // public app-store charts
  'wikimedia.org',                // public pageview aggregates
  'nominatim.openstreetmap.org',  // public gazetteer
  'tile.openstreetmap.org',       // public raster tiles (cached permanently)
  'www.geoboundaries.org',        // public boundary API
  'github.com',                   // geoBoundaries release assets
  'raw.githubusercontent.com',
  'www.wikidata.org',
  'query.wikidata.org',
  'data.humdata.org',
  'ebible.org',
  'arclight.org',
  'api.arclight.org',
  // Added 2026-08-02 after the guard CAUGHT the new open-pools fetcher — working as
  // designed: an unreviewed host stops the build until a human confirms it. Both
  // checked before allowlisting:
  //   git.door43.org  robots.txt EXPLICITLY allows /catalog/ — the exact path used.
  //   bible-api.com   no robots.txt; a published public-domain translation catalogue.
  // Both are READS of published research, not measurements of a foreign network.
  'git.door43.org',
  'bible-api.com',
  // design-approved 2026-08-02: the people-groups CSV (12,379 rows). robots.txt is
  // `Allow: /` with only WordPress admin paths disallowed, plus Crawl-delay: 10 which
  // was respected on every fetch. A published public download, no key, no account.
  'peoplegroups.org',
  // NOT fetched — a STORED watch-link written into the gospel-resource rows so a
  // reader can click through to the film. Allowlisted because the scanner matches
  // any URL in source, and a data-embedded link is not a network call. Verified:
  // build-language-resources.mjs:153 builds it as a string, never fetches it.
  'www.jesusfilm.org',
];

// Active-measurement tooling. NONE of this belongs on this server.
const FORBIDDEN = [
  /\bchild_process[\s\S]{0,80}?\b(ping|nmap|masscan|traceroute|gobuster|dirb|ffuf|nikto)\b/,
  /\brequire\(['"]net['"]\)|from ['"]node:net['"]/,
  /\brequire\(['"]dgram['"]\)|from ['"]node:dgram['"]/,
  /\bnew net\.Socket\b/,
  /\braw socket\b/i,
];

let failed = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('RESEARCH NETWORK POLICY — read research, never probe');

const files = readdirSync(__dirname).filter((f) => f.endsWith('.mjs') && !f.startsWith('verify-'));
let hosts = new Set();

for (const f of files) {
  const src = readFileSync(join(__dirname, f), 'utf8');
  // Strip comments so documentation of a forbidden pattern is not itself a failure.
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  for (const pat of FORBIDDEN) {
    if (pat.test(code)) fail(`${f}: contains ACTIVE-PROBING tooling (${pat}) — forbidden on this box`);
  }
  // Scan the RAW SOURCE for hosts, not the comment-stripped copy. My first version
  // scanned `code` and reported "all 0 contacted hosts are allowlisted" — GREEN
  // because it found NOTHING. The URLs live in template literals that survived, but
  // the naive comment-strip had mangled them. A host-allowlist check that parses
  // zero hosts asserts nothing at all; it is the empty-input trap, in the guard
  // written to enforce the policy. Hence the non-empty assertion below.
  for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase());
  // A fetch to a RUNTIME-BUILT host is the real danger: it cannot be audited
  // statically and is how "just check if X is reachable" arrives.
  if (/fetch\(\s*[`'"]https?:\/\/[`'"]\s*\+/.test(code) || /fetch\(\s*`https?:\/\/\$\{/.test(code)) {
    fail(`${f}: fetch() to a DYNAMICALLY CONSTRUCTED host — cannot be audited; probe risk`);
  }
}

// FAIL-CLOSED on an empty parse: if we found no hosts at all, the scanner is broken,
// not the corpus innocent.
if (hosts.size === 0) fail(`parsed ZERO hosts from ${files.length} fetchers — the scanner is broken; this check asserts nothing`);

const unknown = [...hosts].filter((h) => !ALLOWED.some((a) => h === a || h.endsWith(`.${a}`)));
if (unknown.length) {
  for (const h of unknown) fail(`contacts NON-ALLOWLISTED host: ${h} — is this published research, or are we probing?`);
} else ok(`all ${hosts.size} contacted hosts are allowlisted research/registry sources`);

if (!failed) ok('no active-probing tooling, no dynamically-built fetch targets');

console.log(`\n${failed ? `FAILED — ${failed} problem(s)` : 'NETWORK POLICY HELD'}`);
process.exit(failed ? 1 : 0);
