<script setup>
/**
 * ListSelectorLegend.vue — the Driver's VERTICAL LEGEND, used to SELECT a list and filter by it.
 *
 * @description The shared vertical legend wired as a SELECTOR: it renders the region → zone tree of
 *   a people-group list and emits the selection, so any dashboard can filter its groups by it.
 *
 * ★ IT WRAPS <SemanticTreeLegend>, IT DOES NOT REPLACE IT. That component is already the Driver's
 * vertical legend and already drives my-upg-100-list's 26-zone tapestry, so every fix it receives —
 * theme-awareness, the progress bar, the mobile-sheet path, the scroll-to-selected watcher — keeps
 * applying here. A second widget would have to re-earn all of it.
 *
 * ★ IT EMITS A ZONE ID, NOT A SELECTOR OR RESOLVED GROUPS (gospel's contract). An id is
 * SERIALISABLE — it survives ?zone=, profile-config and a deep link, which is the chain this
 * dashboard already resolves its list from — and a predicate is none of those. It also keeps this
 * component promotable: the moment it emits a selector it has to know what it selects OVER, and the
 * consuming dashboard holds four different row shapes across its tabs.
 * And the join stays in ONE place. Resolving zones to groups means folding diacritics (the
 * membership keys are ASCII while the province data is not — a naive join silently lost 495 groups),
 * bridging provinces, and asserting a known total. That logic lives in the consumer; a second copy
 * here would drift, and the drift would surface as a wrong COUNT, which nobody notices.

 * ★ AND IT NEVER DROPS A ZONE THE TREE FORGOT. Four joinable zones are absent from zone-regions.json
 * today — guizhou, xinjiang (100 groups on its own), bihar, madhya-pradesh — so grouping by region
 * loses them with no error and no empty state, just a shorter tree. Pass `allZoneIds` and they
 * appear in an explicit bucket instead. The consumer said it plainly: better the legend look wrong
 * than look fine.
 *
 * A REGION ROW SELECTS THE UNION OF ITS ZONES (dx-shepherd, provisional and reversible): clicking a
 * parent means "everything under here", which is what a reader expects of a tree and what makes the
 * top row useful as "all of this list".
 */
import { computed } from 'vue'
import SemanticTreeLegend from './SemanticTreeLegend.vue'
// The selection rule lives beside this file so it can be tested without mounting a component.
import { withUnassigned, selectedId } from './listSelection.js'

const props = defineProps({
  // The region → zone tree, as built from the list's own zoning. Passed in rather than built here:
  // the builder lives in the plugin that owns the zoning today, and a cross-plugin import is barred
  // by check:no-cross-plugin-imports — so promoting it to library/ is a separate, coordinated move.
  nodes: { type: Array, default: () => [] },
  // Every zone the data can join, tree or no tree. Any id absent from `nodes` is rendered in an
  // explicit bucket rather than dropped — see withUnassigned(). Omit it and the legend behaves as
  // before, which is why this is a prop and not a rewrite.
  allZoneIds: { type: Array, default: null },
  unassignedLabel: { type: String, default: 'Unassigned' },
  // Which list this tree belongs to. Emitted back with every selection so a consumer holding more
  // than one list can tell them apart without tracking it itself.
  listId: { type: String, default: '' },
  title: { type: String, default: 'Select a list' },
  // Which generation the legend opens on; passed through (country-posters needed this).
  defaultTab: { type: Number, default: 0 },
  columns: { type: Array, default: () => ['count'] },
  columnLabel: { type: String, default: '' },
  open: { type: Boolean, default: null },
})

const emit = defineEmits(['zone-change', 'update:open'])

// The tree the legend actually renders: the caller's, plus a bucket for any joinable zone it omits.
const treeNodes = computed(() => (
  props.allZoneIds ? withUnassigned(props.nodes, props.allZoneIds, props.unassignedLabel) : (props.nodes || [])
))
const hasNodes = computed(() => treeNodes.value.length > 0)

function onSelect(node) {
  // null is a real value — "cleared" — and the consumer needs it to drop its filter. Emitting
  // nothing on clear would leave a dashboard stuck on the last zone with no way back.
  emit('zone-change', selectedId(node))
}
</script>

<template>
  <SemanticTreeLegend
    v-if="hasNodes"
    :nodes="treeNodes"
    :title="title"
    :default-tab="defaultTab"
    :columns="columns"
    :column-label="columnLabel"
    :open="open"
    @select="onSelect"
    @update:open="$emit('update:open', $event)"
  />
  <!-- No tree yet: say so rather than rendering an empty frame that looks like a broken legend. -->
  <p v-else class="lsl-empty" role="status">{{ $t ? $t('legend.noList') : 'No list loaded.' }}</p>
</template>

<style scoped>
.lsl-empty { padding: 12px; font-size: 13px; color: var(--dx-muted, #6d766e); }
</style>
