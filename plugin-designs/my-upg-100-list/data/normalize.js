// normalize.js — BUG#1 fix (slice 01)
//
// The live API (GET https://pray.doxa.life/api/people-groups/list) returns several
// fields as nested { value, label } dicts instead of flat strings:
//   country_code:  { value: "MYS", label: "Malaysia" }
//   wagf_region:   { value: "asia", label: "Asia" }
//   wagf_block:    { value: "south_east_asia", label: "South East Asia" }
//   primary_language: { value: "abf", label: "Abai Sungai" }
//
// The selector-evaluator compares flat strings against flat selector values, so a raw
// record would make every comparison fail (record.wagf_block === "west_africa" is false
// when record.wagf_block is an object) → all counts collapse to 0.
//
// normalizeRecord() flattens each such field to its `.value` string, while preserving the
// original `.label` under `<field>_label` for display. Already-flat values pass through.

// Fields known to arrive as { value, label } dicts from the API.
export const NESTED_FIELDS = [
  'country_code',
  'wagf_region',
  'wagf_block',
  'primary_language',
  // religion also arrives as { value, label } — e.g. { value:'MSN',
  // label:'Islam - Sunni' }. Without it here the poster's Religion column would
  // receive the raw object and render "[object Object]".
  'religion',
  // ★ imb_gsec ARRIVES NESTED TOO — { value:'1', label:'Less than 2% Evangelical, No Active CP
  // Activity' } — and unlike religion it fails SILENTLY rather than printing [object Object].
  // describeGroup does Number(pick(group,'imb_gsec',…)); Number({value:'1'}) is NaN, so
  // LEVELS.includes(NaN) is false and the REACHEDNESS SENTENCE IS DROPPED for every group. The
  // description degrades to "The X live in Y and speak Z." with no error, because dropping a clause
  // is describeGroup's deliberate design for a missing field. Measured end to end: nested -> one
  // sentence, flattened -> two. Adding it here is what makes the second half of the packet's widest
  // column exist at all.
  'imb_gsec',
];

// Flatten one { value, label } dict (or pass through a flat value / null).
function flatten(field) {
  if (field == null) return { value: null, label: null };
  if (typeof field === 'object') {
    return {
      value: field.value ?? null,
      label: field.label ?? null,
    };
  }
  // already a flat string/number
  return { value: field, label: null };
}

/**
 * normalizeRecord(raw) -> normalized record
 * - flattens every NESTED_FIELDS field to its `.value` string
 * - keeps the label under `<field>_label` (only if present)
 * - leaves slug/name and any other fields untouched
 * - non-destructive: returns a shallow copy
 */
export function normalizeRecord(raw) {
  if (raw == null || typeof raw !== 'object') return raw;
  const out = { ...raw };
  for (const f of NESTED_FIELDS) {
    if (f in out) {
      const { value, label } = flatten(out[f]);
      out[f] = value;
      if (label != null) out[`${f}_label`] = label;
    }
  }
  return out;
}

/** normalizeRecords(rawArray) -> normalized array */
export function normalizeRecords(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(normalizeRecord);
}

/**
 * extractRecords(apiPayload) -> raw record array
 * The list endpoint wraps records under `posts`; tolerate a few common shapes.
 */
export function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    return payload.posts || payload.data || payload.records || payload.results || payload.items || [];
  }
  return [];
}

/** Convenience: extract + normalize in one call. */
export function loadRecords(apiPayload) {
  return normalizeRecords(extractRecords(apiPayload));
}
