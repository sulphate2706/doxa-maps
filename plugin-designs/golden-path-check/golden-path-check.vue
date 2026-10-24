<script setup>
import { bundleTreeRoot } from '@map/utils/embedBase.js'
/**
 * golden-path-check.vue — the capability-1 single-element SELF-TEST of the golden path.
 *
 * @element golden-path-check
 * @description A live self-test of the develop-a-plugin-and-see-it-live path: it reads the built
 *   manifest.json it was published beside and reports what the catalog actually contains — bundle
 *   and profile counts, how many profiles describe themselves, and whether this very plugin is
 *   listed. If you can see it answering, the whole path worked.
 *
 * WHY THIS EXISTS. The north star is that an admin agent can author a plugin, build, publish and
 * SEE IT LIVE. That path was documented and its parts were individually verified, but never walked
 * end-to-end in one pass by following the doc as written. This plugin IS that walk: authoring it
 * from the documented 3-file minimum, building it, and finding it in the live catalog exercises
 * every step. It then stays useful, because it reports the catalog's real state to anyone who
 * opens it — the first thing an inheritor can click to confirm their own build reached the world.
 *
 * DELIBERATELY DEPENDENCY-FREE. No map engine, no Mapbox token, no data API, no shared library
 * component. A cap-1 element is the right tier for a self-test: it must be able to mount when
 * everything else is broken, which is exactly when someone reaches for it. Material light only
 * (#f3f3f1 / #fff / #3b463d / #92b195 / #d1d4cd / #6d766e), per the standing palette rule.
 *
 * TREE-RELATIVE BY CONSTRUCTION. It resolves manifest.json from its own document URL rather than
 * any baked host, so it answers correctly wherever the tree is dropped — CDN, a foreign subpath,
 * or file://. That is the same position-independence check:drop enforces for every other bundle.
 */
import { ref, computed, onMounted } from 'vue'

/**
 * `tree-base` is a plain ATTRIBUTE, not an injection. This element mounts its own SFC (no
 * ProfileLoader — see index.js), so there is no provide('profileConfig') above it. Taking a prop
 * instead keeps the element self-sufficient: it works when embedded directly by a host page, and
 * it cannot break because something upstream failed to provide a key.
 */
const props = defineProps({
  treeBase: { type: String, default: '' },
})

const state = ref('loading')   // loading | ok | error
const error = ref('')
const manifest = ref(null)

/**
 * Where is the tree root? The leaf page for any profile is served at
 *   <tree>/<bundle>/<profile>/index.html
 * so the manifest sits three levels up. A host embedding the element directly can override with
 * the `tree-base` ATTRIBUTE (<golden-path-check tree-base="https://host/doxa-maps">). Falls back
 * to the bundle's own script URL (bundleTreeRoot), then to location.pathname for the dev server.
 */
const treeBase = computed(() => {
  if (props.treeBase) return props.treeBase.replace(/\/+$/, '')
  // The bundle's OWN script URL first. Embedded on a host page (/embed-test, a partner site) the
  // DOCUMENT is the host's, so the page path below points at the host and the manifest fetch misses,
  // which rendered an empty checklist. bundleTreeRoot() reads <tree>/<bundle>/<bundle>.js.
  const fromScript = bundleTreeRoot()
  if (fromScript) return fromScript.replace(/\/+$/, '')
  if (typeof location === 'undefined') return '.'
  const parts = location.pathname.split('/').filter(Boolean)
  // drop index.html + <profile> + <bundle> when they are present
  const trimmed = parts.slice(0, Math.max(0, parts.length - 3))
  return `${location.origin}/${trimmed.join('/')}`.replace(/\/+$/, '')
})

onMounted(async () => {
  try {
    const res = await fetch(`${treeBase.value}/manifest.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`manifest.json → HTTP ${res.status}`)
    manifest.value = await res.json()
    state.value = 'ok'
  } catch (e) {
    error.value = String(e && e.message ? e.message : e)
    state.value = 'error'
  }
})

const bundles = computed(() => (manifest.value?.bundles || []))
const profiles = computed(() => bundles.value.flatMap(b => b.profiles || []))
const described = computed(() =>
  profiles.value.filter(p => String(p.description || '').trim().length > 0).length)
const selfListed = computed(() =>
  bundles.value.some(b => (b.name || b.bundle) === 'golden-path-check'))

const rows = computed(() => [
  { label: 'bundles in the catalog',  value: String(bundles.value.length) },
  { label: 'profiles in the catalog', value: String(profiles.value.length) },
  { label: 'profiles that describe themselves',
    value: `${described.value} / ${profiles.value.length}` },
  { label: 'this plugin is listed',   value: selfListed.value ? 'yes' : 'no' },
])
</script>

<template>
  <div class="gpc">
    <h2 class="gpc-h">Golden path — live self-test</h2>

    <p v-if="state === 'loading'" class="gpc-note">Reading the catalog manifest…</p>

    <p v-else-if="state === 'error'" class="gpc-note gpc-err">
      Could not read <code>manifest.json</code> beside this page.<br>
      <small>{{ error }}</small>
    </p>

    <template v-else>
      <dl class="gpc-rows">
        <div v-for="r in rows" :key="r.label" class="gpc-row">
          <dt>{{ r.label }}</dt>
          <dd>{{ r.value }}</dd>
        </div>
      </dl>
      <p class="gpc-note">
        This element was authored in <code>plugin-designs/</code>, built with
        <code>bun run build</code>, and published to the catalog. It is reading the manifest it
        shipped beside — so if these numbers are here, the whole path worked.
      </p>
    </template>
  </div>
</template>

<style>
/* Material LIGHT only — no dark mode, no prefers-color-scheme:dark (standing palette rule). */
:host { display: block; }

.gpc {
  background: #f3f3f1;
  color: #3b463d;
  border: 1px solid #d1d4cd;
  border-radius: 10px;
  padding: 18px 20px;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

.gpc-h {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.gpc-rows { margin: 0; }

.gpc-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid #d1d4cd;
}

.gpc-row:last-child { border-bottom: 0; }

.gpc-row dt { color: #6d766e; }

.gpc-row dd {
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.gpc-note {
  margin: 14px 0 0;
  color: #6d766e;
  font-size: 12.5px;
}

.gpc-err { color: #3b463d; }

.gpc code {
  background: #fff;
  border: 1px solid #d1d4cd;
  border-radius: 4px;
  padding: 1px 5px;
  font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
