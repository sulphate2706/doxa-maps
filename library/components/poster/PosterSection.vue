<script setup>
/**
 * PosterSection.vue — ONE section of a poster wall: its head (the name, the count, the collapse toggle) and its
 * cards (the preview, "show on map", and the print options).
 *
 * LIFTED, NOT COPIED, out of PosterWall.vue: the wall renders every group through this component and PROVIDES
 * everything a section uses (its props, its collapse state, the print actions and their progress overlay) under
 * POSTER_WALL_CTX. So every wall looks and behaves as before, and a section is never a second implementation.
 * The section's CSS stays in PosterWall's one shadow-style string (it applies to this markup in the same root).
 * A standalone section (the <dxm-poster-section> element) is a PosterWall in section-only mode, which brings its
 * own print overlay.
 */
import { inject } from 'vue'
import { POSTER_WALL_CTX } from './posterWallContext.js'

defineProps({
  sec: { type: Object, required: true },   // { name, items, total, … } from the wall's sections
  z:   { type: Number, default: 0 },        // stacking: each section sits above the ones after it
})
const {
  collapsible, columnsControl, headerAction, hidePrayerListWhenSoon, instanceId, previewSrc, sectionHeads, unit, unsupported, PER_ROW_AUTO, T, canPrintRows, countOf, deckKey, deckOpenFor, emit, exportPoster, generated, gridStyle, hud, isCollapsed, lastShown, missing, onPreviewError, packetVariants, perRowChoices, perRowShown, pickedStock, previewIsControl, previewUrl, printDeckAt, printPacketAs, sectionCount, setPreviewEl, showOnMap, stockLabel, stockOptions, t, toggleDeck, toggleSection,
} = inject(POSTER_WALL_CTX)
</script>

<template>
<section class="sec" :style="{ zIndex: z }">
    <!-- A <button> when collapsible so the whole head is keyboard-reachable. -->
    <component v-if="sectionHeads" :is="collapsible ? 'button' : 'div'" class="sec-head"
      :class="{ 'is-toggle': collapsible, 'is-shut': collapsible && isCollapsed(sec.name) }"
      :type="collapsible ? 'button' : null"
      :aria-expanded="collapsible ? String(!isCollapsed(sec.name)) : null"
      @click="collapsible && toggleSection(sec.name)">
      <span v-if="collapsible" class="sec-caret" :class="{ 'is-open': !isCollapsed(sec.name) }">▶</span>
      <h3 class="sec-name">{{ sec.name }}</h3>
      <span class="sec-count">
        {{ sectionCount(sec) }}
      </span>
    </component>

    <!-- ★ THE PER-ROW CONTROL. A <select>, not a stepper or a pair of chevrons: it is the control
         every reader already knows for "choose one of a few", it is keyboard- and
         screen-reader-operable with no work, and it shows the current value without a second
         element. Imitating the solved pattern rather than inventing one.
         Rendered once per section, beside the grid it governs, and only where the caller asked
         for it — so neither existing pane grows a knob it did not request. -->
    <div v-if="columnsControl && !isCollapsed(sec.name)" class="perrow">
      <label class="perrow__label" :for="`perrow-${instanceId}-${sec.name}`">{{ t('buttons.postersPerRow') }}</label>
      <select :id="`perrow-${instanceId}-${sec.name}`" class="perrow__select" v-model.number="perRowShown">
        <option v-for="n in perRowChoices" :key="n" :value="n">{{ n === PER_ROW_AUTO ? t('buttons.postersPerRowAuto') : n }}</option>
      </select>
    </div>
    <div v-show="!isCollapsed(sec.name)" class="grid" :style="gridStyle">
      <!-- ★ 'has-tape-open' RAISES THE WHOLE CARD while one of its tapes is revealed. Reported
           from mobile 2026-09-28: the Card deck options tape rendered under the surrounding
           cards. Cause: .pstocks hangs at top:100%, i.e. BELOW its own card and over the
           next one, but every .card is position:relative with NO z-index — so they all sit at the
           same stacking level and LATER cards paint over earlier ones in document order. The
           tape's own z-index:2 only orders it WITHIN its card, which is why it looked fine on the
           last card of a row and disappeared under the next one everywhere else. It is worse on a
           phone because the grid is one column, so the very next card is directly beneath.
           Raising the CARD lifts its whole stacking context above its siblings. -->
      <div v-for="item in sec.items" :key="item.id" class="card"
        :class="{ 'is-last': lastShown === item.id,
                  'has-tape-open': deckOpenFor === deckKey(item.id, 'deck') || deckOpenFor === deckKey(item.id, 'packet') }"
        :data-list-id="item.id">

        <!-- A TOGGLE (showOnMap clears the selection on a second press), so it says whether it is on:
             without aria-pressed a second press sounded identical to the first to a screen reader. -->
        <button v-if="!headerAction" type="button" class="tape tape-h" :aria-pressed="lastShown === item.id ? 'true' : 'false'"
          :aria-label="t('buttons.showOnMapAria', { label: item.label })" @click="showOnMap(item)">
          <span class="hcount">{{ item.count }} {{ unit }}</span>
          <span class="hsep">·</span>
          <span class="hlabel">{{ t('buttons.showOnMap') }}</span>
        </button>
        <!-- headerAction set: a plain button that hands the item to the host (see the prop). -->
        <button v-else type="button" class="tape tape-h"
          :aria-label="t(headerAction.ariaKey || headerAction.labelKey, { label: item.label })" @click="emit('header-action', item)">
          <template v-if="item.count != null">
            <span class="hcount">{{ item.count }} {{ unit }}</span>
            <span class="hsep">·</span>
          </template>
          <span class="hlabel">{{ t(headerAction.labelKey) }}</span>
        </button>

        <div class="main">
          <!-- Unsupported comes FIRST: there is no poster to try to load. -->
          <div v-if="unsupported(item)" class="ph is-soon">
            <div class="ph-label">{{ item.label }}</div>
            <div v-if="item.count" class="ph-count">{{ countOf('wall.peopleGroupCount', item.count) }}</div>
            <div class="ph-soon">{{ unsupported(item) }}</div>
          </div>
          <!-- previewAction='print': the poster preview IS the control. Keyboard-
               reachable (role/tabindex/Enter/Space), not click-only. -->
          <!-- previewSrc set and the preview not arrived yet: the card's label, never a spinner. -->
          <div v-else-if="previewSrc && !generated[item.id] && !missing[item.id]" class="ph is-pending"
            :ref="(el) => setPreviewEl(item.id, el)">
            <div class="ph-label">{{ item.label }}</div>
            <div v-if="item.count" class="ph-count">{{ countOf('wall.peopleGroupCount', item.count) }}</div>
          </div>
          <img v-else-if="!missing[item.id]" class="img"
            :class="{ 'is-clickable': previewIsControl }" :src="previewSrc ? generated[item.id] : previewUrl(item.id)"
            :alt="previewIsControl
              ? hud('wall.posterAltAction', '{label} — prayer poster (click to preview and print)', { label: item.label })
              : hud('wall.posterAlt', '{label} — prayer poster', { label: item.label })"
            loading="lazy" decoding="async"
            :role="previewIsControl ? 'button' : null"
            :tabindex="previewIsControl ? 0 : null"
            :title="previewIsControl ? t('buttons.previewPrintPoster', { label: item.label }) : null"
            @click="previewIsControl && exportPoster(item)"
            @keydown.enter.prevent="previewIsControl && exportPoster(item)"
            @keydown.space.prevent="previewIsControl && exportPoster(item)"
            @error="onPreviewError(item.id)" />
          <div v-else class="ph">
            <div class="ph-label">{{ item.label }}</div>
            <div v-if="item.count" class="ph-count">{{ countOf('wall.peopleGroupCount', item.count) }}</div>
            <!-- NOT "not generated yet": reaching this branch means the preview IMAGE did
                 not arrive after both bases were tried, which says nothing about whether a
                 poster exists. A record with genuinely no poster carries its own
                 unsupportedReason and renders the branch above. Saying "not generated" of a
                 poster that is sitting on disk is how this was found.
                 i18n DEBT: this literal predates t() here and is still untranslated, like
                 the two beside it. -->
            <div class="ph-note">{{ T('poster.preview_unavailable', 'preview unavailable') }}</div>
          </div>

          <!-- ★ THE PRINT ROW LIVES INSIDE .main, NOT BESIDE IT.
               It is `position:absolute; top:100%`, which resolves against the nearest
               positioned ANCESTOR. As a SIBLING of .main that ancestor was .card, whose
               bottom sits 26px past the frame — measured: frame bottom 426, row top 452.
               That 26px of nothing is why it read as a detached row instead of tape.
               Moved INSIDE .main, top:100% is the frame's own bottom edge, so the row
               starts exactly on the border it is taping over. -->
          <fieldset class="tape pfs">
            <legend>{{ t('buttons.printOptions') }}</legend>
            <!-- ★ PRAYER LIST IS NOW A DISCLOSURE TOO, using the SAME
                 mechanism as Card Deck below — same toggleDeck, same one-open-at-a-time key,
                 same revealed .tape of plain buttons. NOT a <select> and NOT a new component,
                 for the reason already given at the Card Deck comment: a native dropdown
                 collides with other dropdowns on the host page.
                 It reveals the two PACKETS — Full detail and Lightweight. Clicking the button
                 no longer prints immediately, because there are now two things it could mean. -->
            <button v-if="!(hidePrayerListWhenSoon && !canPrintRows)" type="button" class="pbtn"
              :aria-expanded="String(deckOpenFor === deckKey(item.id, 'packet'))"
              @click.stop="toggleDeck(item.id, $event, 'packet')">{{ t('buttons.prayerList') }}</button>
            <button type="button" class="pbtn" @click="exportPoster(item)">{{ t('buttons.posterMap') }}</button>
            <!-- ★ CARD DECK IS NOT A PEER OPTION, AND ITS SIZE PICKER IS HIDDEN UNTIL ASKED
                 FOR: Cards is not the second option, and a visible dropdown for it would make it
                 hard for the host page's own dropdowns to coexist; the size choice appears only
                 once Print cards is clicked.
                 So the deck is a DISCLOSURE, not a sibling button: clicking it reveals this
                 card's own size row, and the size buttons there are what actually print.
                 A 162px <select> was the single widest control in a 172px row — removing it
                 from the default row is most of why the row now fits on one line. -->
            <button v-if="canPrintRows" type="button" class="pbtn pbtn-deck"
              :aria-expanded="String(deckOpenFor === deckKey(item.id, 'deck'))"
              @click.stop="toggleDeck(item.id, $event, 'deck')">{{ t('buttons.cardDeck') }}</button>
          </fieldset>

          <!-- The revealed PACKET row — deliberately the same markup shape and the same .tape /
               .pstock classes as the card-size row below, because to the reader these are the
               same gesture. Two entries, both shipped together: a one-item dropdown would be a
               caret that explains nothing. -->
          <div v-if="deckOpenFor === deckKey(item.id, 'packet')"
            class="tape pstocks" role="group" :aria-label="t('buttons.packetVariantAria')">
            <button v-for="v in packetVariants" :key="v.id" type="button" class="pstock"
              @click.stop="printPacketAs(item, v.id)">{{ t(v.labelKey) }}</button>
          </div>

          <!-- The revealed size row. Rendered as SIBLINGS in a second tape rather than a
               <select> so there is no native dropdown to collide with other dropdowns —
               which is the constraint, not a styling preference. -->
          <div v-if="canPrintRows && stockOptions.length && deckOpenFor === deckKey(item.id, 'deck')"
            class="tape pstocks" role="group" :aria-label="t('buttons.cardStockAria')">
            <button v-for="s in stockOptions" :key="s.id" type="button" class="pstock"
              :class="{ 'is-on': pickedStock === s.id }"
              @click.stop="printDeckAt(item, s.id)">{{ stockLabel(s.stock) }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>

</template>
