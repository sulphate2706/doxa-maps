/**
 * _published-base.mjs — where the PUBLISHED tree lives, for the few tools that measure the live catalogue.
 *
 * The repo names no host (white-label: it ships to people who publish somewhere else). A tool that
 * compares against the live tree reads its location from DOXA_PUBLISHED_BASE: the URL the tree folders sit
 * under, e.g. https://<your-host>/plugin-assets (the tree name is appended here, from _tree-name.mjs). Set it
 * in the environment, or in the gitignored .env / .env.local at the repo root.
 *
 * With nothing set, such a tool has nothing to measure: it says NOT MEASURED and exits 75, the fleet's
 * third bucket, instead of passing or failing against a host it was never told about.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function fromEnvFiles() {
  for (const f of ['.env.local', '.env']) {
    try {
      const m = readFileSync(join(ROOT, f), 'utf8').match(/^\s*DOXA_PUBLISHED_BASE\s*=\s*["']?([^"'\s#]+)/m)
      if (m) return m[1]
    } catch { /* no such file */ }
  }
  return ''
}

/** The published tree's URL (…/<TREE_NAME>, no trailing slash), or '' when none is configured. */
export function publishedTreeUrl() {
  const base = (process.env.DOXA_PUBLISHED_BASE || fromEnvFiles()).replace(/\/+$/, '')
  return base ? `${base}/${TREE_NAME}` : ''
}

/** For a tool that cannot run without it: the tree URL, or NOT MEASURED (exit 75) naming what to set. */
export function requirePublishedTreeUrl(label) {
  const url = publishedTreeUrl()
  if (!url) {
    console.log(`${label}: NOT MEASURED — no published tree to measure. Set DOXA_PUBLISHED_BASE (environment or .env)`)
    console.log(`  to the URL your tree folders sit under, e.g. https://<your-host>/plugin-assets`)
    process.exit(75)
  }
  return url
}
