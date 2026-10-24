// selector-evaluator.js — slice 01 (my-upg-100-list)
//
// Pure function: evaluate(selector, records) -> Set<slug>
//
// `records` are assumed ALREADY NORMALIZED by normalize.js, i.e. the nested
// { value, label } fields (country_code, wagf_region, wagf_block, primary_language)
// have been flattened to flat `.value` strings. The evaluator therefore compares
// flat record fields against flat selector values — no .value access here.
//
// Handles the 6 selector types documented in data/clusters.source.md + the qa file:
//   1. { type: "country_code",  value: "SDN" }
//        -> records whose country_code === value
//   2. { type: "country_codes", values: [...] }            (note plural `values`)
//        -> records whose country_code ∈ values
//   3. { type: "wagf_block",    value: "west_africa" }
//        -> records whose wagf_block === value
//   4. { type: "wagf_region",   value: "europe" }
//        -> records whose wagf_region === value
//   5. { type: "union", selectors: [ <sel>, <sel>, ... ] }
//        -> union of evaluating each sub-selector
//   6. { type: "deaf_predicate", regions: [...] }
//        -> records where (slug OR name contains "deaf", case-insensitive)
//           AND wagf_region ∈ regions
//   7. { type: "affinity_bloc", rop1: "A017" }            (slice 04t §1g)
//        -> records where r.rop1.value === rop1
//           NOTE: rop1 is NOT in normalize.js NESTED_FIELDS, so it stays a nested
//           { value, label } dict on the record. This selector reads `.value`
//           directly (and tolerates an already-flat rop1 string). The Deaf row's
//           bloc code is "A017" (123 PGs, == the old deaf_predicate slug set, zero
//           delta but field-authoritative). 📁 affinity-block.js:36, sources.json:68
//
// Design contract:
//   - returns a Set<slug> (always; never null/undefined)
//   - a bogus VALUE (e.g. country_code "ZZZ") -> empty Set, never a crash
//   - an UNKNOWN selector type -> throw a clear Error (never silently empty)

// Collect the slug of a record. Records without a slug are skipped (cannot key a Set entry).
function slugOf(record) {
  if (record == null || typeof record !== 'object') return null;
  return record.slug ?? null;
}

// True if the haystack string contains "deaf" (case-insensitive).
function containsDeaf(s) {
  return typeof s === 'string' && s.toLowerCase().includes('deaf');
}

// Read the affinity-bloc code off a record's `rop1` field. rop1 is intentionally
// NOT flattened by normalize.js, so it normally arrives as { value, label }; this
// also tolerates an already-flat string (defensive).
function rop1Code(record) {
  const f = record == null ? null : record.rop1;
  if (f == null) return null;
  if (typeof f === 'object') return f.value ?? null;
  return f; // already-flat string
}

/**
 * evaluate(selector, records) -> Set<slug>
 * @param {object} selector  one of the 6 documented selector shapes
 * @param {Array<object>} records  ALREADY-normalized UPG records
 * @returns {Set<string>} set of matching slugs
 * @throws {Error} on an unknown / malformed selector type
 */
export function evaluate(selector, records) {
  const out = new Set();

  if (selector == null || typeof selector !== 'object' || typeof selector.type !== 'string') {
    throw new Error(
      `selector-evaluator: malformed selector (expected an object with a string \`type\`), got: ${JSON.stringify(selector)}`,
    );
  }
  const rows = Array.isArray(records) ? records : [];

  switch (selector.type) {
    case 'country_code': {
      const want = selector.value;
      for (const r of rows) {
        if (r && r.country_code === want) {
          const slug = slugOf(r);
          if (slug != null) out.add(slug);
        }
      }
      return out;
    }

    case 'country_codes': {
      // plural: match against the `values` array
      const wanted = new Set(Array.isArray(selector.values) ? selector.values : []);
      for (const r of rows) {
        if (r && wanted.has(r.country_code)) {
          const slug = slugOf(r);
          if (slug != null) out.add(slug);
        }
      }
      return out;
    }

    case 'wagf_block': {
      const want = selector.value;
      for (const r of rows) {
        if (r && r.wagf_block === want) {
          const slug = slugOf(r);
          if (slug != null) out.add(slug);
        }
      }
      return out;
    }

    case 'wagf_region': {
      const want = selector.value;
      for (const r of rows) {
        if (r && r.wagf_region === want) {
          const slug = slugOf(r);
          if (slug != null) out.add(slug);
        }
      }
      return out;
    }

    case 'union': {
      const subs = Array.isArray(selector.selectors) ? selector.selectors : [];
      for (const sub of subs) {
        // recurse; sub-selector errors (unknown type) propagate up by design
        const subSet = evaluate(sub, rows);
        for (const slug of subSet) out.add(slug);
      }
      return out;
    }

    case 'deaf_predicate': {
      const regions = new Set(Array.isArray(selector.regions) ? selector.regions : []);
      for (const r of rows) {
        if (!r) continue;
        const isDeaf = containsDeaf(r.slug) || containsDeaf(r.name);
        if (isDeaf && regions.has(r.wagf_region)) {
          const slug = slugOf(r);
          if (slug != null) out.add(slug);
        }
      }
      return out;
    }

    case 'affinity_bloc': {
      // slice 04t §1g — Deaf row: records whose rop1.value === selector.rop1 (e.g. "A017").
      const want = selector.rop1;
      for (const r of rows) {
        if (!r) continue;
        if (rop1Code(r) === want) {
          const slug = slugOf(r);
          if (slug != null) out.add(slug);
        }
      }
      return out;
    }

    default:
      throw new Error(
        `selector-evaluator: unknown selector type "${selector.type}" ` +
          `(supported: country_code, country_codes, wagf_block, wagf_region, union, deaf_predicate, affinity_bloc)`,
      );
  }
}

export default evaluate;
