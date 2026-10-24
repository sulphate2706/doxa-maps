#!/usr/bin/env node
// set-zone-color.mjs — slice 09b toolC §1(c) · the override WRITER
//
//   node plugin-designs/my-upg-100-list/data/set-zone-color.mjs <zoneId> <hex>
//   node plugin-designs/my-upg-100-list/data/set-zone-color.mjs <zoneId> --clear
//
// Upserts (or clears) one zone color in ./zone-colors.json. This is what toolA
// (color picker) + toolB (apply) call. Reproducible: stable formatting, keys
// always sorted, 2-space indent, trailing newline. Running it twice with the same
// args is a byte-for-byte no-op (idempotent → deterministic git diffs).
//
// SCOPE: writes ONLY ./zone-colors.json (a file THIS app owns). It does not — and
// must not — reach into src/config/color-strategies/* or any sibling bundle. The
// isolation proof asserts that exactly.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'zone-colors.json');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Stable serializer: sorted keys, 2-space indent, single trailing newline.
function serialize(obj) {
  const sorted = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted, null, 2) + '\n';
}

function load() {
  try {
    return JSON.parse(readFileSync(STORE, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function main(argv) {
  const [zoneId, value] = argv;
  if (!zoneId || value == null) {
    console.error('usage: set-zone-color.mjs <zoneId> <#rrggbb | --clear>');
    process.exit(2);
  }

  const overrides = load();
  const clearing = value === '--clear' || value === '--remove';

  if (clearing) {
    if (!(zoneId in overrides)) {
      console.log(`set-zone-color: '${zoneId}' had no override (no-op)`);
      writeFileSync(STORE, serialize(overrides)); // re-normalize formatting
      return;
    }
    delete overrides[zoneId];
    writeFileSync(STORE, serialize(overrides));
    console.log(`set-zone-color: cleared '${zoneId}'`);
    return;
  }

  const hex = value.startsWith('#') ? value.toLowerCase() : `#${value.toLowerCase()}`;
  if (!HEX_RE.test(hex)) {
    console.error(`set-zone-color: invalid hex '${value}' (want #rrggbb)`);
    process.exit(2);
  }

  overrides[zoneId] = hex;
  writeFileSync(STORE, serialize(overrides));
  console.log(`set-zone-color: ${zoneId} = ${hex}`);
}

main(process.argv.slice(2));
