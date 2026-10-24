<template>
        <div class="wall-container">
            <div class="wall-header">
                <h1>{{ mode === 'bless' ? $t('wall.blessBanner') : $t('wall.title') }}</h1>
                <div class="wall-controls">
                    <!-- Landscape / portrait arranges the SOCIAL board; in Bless mode the wall is the poster itself. -->
                    <button v-if="mode === 'social'" @click="toggleOrientation" class="control-btn orientation-btn">
                        <span class="btn-label">{{ isLandscape ? $t('wall.toPortrait') : $t('wall.toLandscape') }}</span>
                        <span class="current-mode">{{ isLandscape ? $t('wall.currentLandscape') : $t('wall.currentPortrait') }}</span>
                    </button>
                    <!-- Loading every card's HD photo can take a while: the button shows it is busy, counts the
                         photos as they arrive, and cannot start a second load while the first is still running. -->
                    <button @click="onPrint" class="control-btn" :class="{ busy: printing }" :disabled="printing" :aria-busy="printing ? 'true' : 'false'">{{ printLabel }}</button>
                    <button @click="resetZoom" class="control-btn">{{ $t('wall.resetZoom') }}</button>
                    <!-- BLESS (default): name, photo and a blessing verse under every group, made to print.
                         SOCIAL: the interactive card (pray, comments, share). -->
                    <label v-if="mode === 'bless'" class="poster-size">
                        <span>{{ $t('wall.posterSize') }}</span>
                        <select v-model="posterPreset" class="control-btn">
                            <option v-for="p in posterPresets" :key="p.id" :value="p.id">{{ p.label }}</option>
                        </select>
                    </label>
                    <div class="mode-toggle" role="group" :aria-label="$t('wall.modeLabel')">
                        <button type="button" class="control-btn" :class="{ on: mode === 'bless' }" :aria-pressed="mode === 'bless' ? 'true' : 'false'" @click="setMode('bless')">{{ $t('wall.modeBless') }}</button>
                        <button type="button" class="control-btn" :class="{ on: mode === 'social' }" :aria-pressed="mode === 'social' ? 'true' : 'false'" @click="setMode('social')">{{ $t('wall.modeSocial') }}</button>
                    </div>
                    <button v-if="helpHosted" type="button" class="control-btn wall-help" :aria-label="$t('buttons.aboutThisMap')"
                            :title="$t('buttons.aboutThisMap')" @click="askForHelp($event.currentTarget)">?</button>
                    <span class="group-count">{{ $t('wall.groupsLoaded', { n: totalGroups }) }}</span>
                </div>
            </div>
            
            <!-- Every Bless size is 2-8 ft, paper no desktop printer takes: say up front that it goes to a print shop
                 as a PDF, before the reader meets a print dialog showing a 3 ft page. -->
            <p v-if="mode === 'bless'" class="print-hint" role="note">{{ $t('wallPrint.printShopHint') }}</p>
            <div ref="canvas" class="wall-canvas"></div>
            <div v-if="toast" class="wall-toast" role="status">{{ toast }}</div>
            <!-- While the poster prepares (its photos load before the print dialog can open, a minute or more on a slow
                 connection), the shared print card says so in the middle of the screen: the count and a clock, so a
                 long wait never reads as nothing happening. -->
            <map-print-progress :visible="printing" :kind="$t('wall.printPoster')" :title="printTitle" :progress="printPercent" />
            
            <div v-if="loading" class="loading-overlay">
                <div class="spinner"></div>
                <p>{{ $t('wall.loading') }}</p>
            </div>

            <!-- OFFLINE / BLOCKED: the live API could not be reached. Measured on a local dev server,
                 where pray.doxa.life refuses a 127.0.0.1 origin (CORS): the wall used to sit at
                 "0 Groups Loaded" with nothing saying why. Say what failed and offer a retry. -->
            <div v-else-if="loadError && totalGroups === 0" class="wall-offline" role="status">
                <p class="wall-offline-title">{{ $t('wall.offlineTitle') }}</p>
                <p>{{ $t('wall.offlineBody') }}</p>
                <button type="button" class="control-btn" @click="fetchData">{{ $t('wall.tryAgain') }}</button>
            </div>
        </div>
    
</template>

<script>
import { WallCanvas, groupLink } from '../wallCanvas.js'
import { buildBlessPosterHtml, screenPoster, PRESETS, DEFAULT_PRESET } from '../blessPoster.js'
import { openPrintFrame, printDocument, isPhonePrint } from '@map/composables/printInPlace.js'
import { watchPrintFrame } from '../printWatch.js'
import { useHostedHelp } from '@map/composables/useHostedHelp.js'
import MapPrintProgress from '@map/components/poster/MapPrintProgress.vue'
// Wall of People Groups: a zoomable canvas wall (wallCanvas.js), Bless or Social cards, and the poster print.
export default {
    name: 'PeopleGroupsWall',
    components: { MapPrintProgress },
    // The page's profile-config, for its people-group LIST (library/lists/); handed to the store.
    inject: { profileConfig: { default: null } },
    // The wall's "?" asks its HOST for the wall's help (doxa:help); it shows only where a host answers.
    setup() {
        const { hosted, askForHelp } = useHostedHelp()
        return { helpHosted: hosted, askForHelp }
    },
    data() {
        return {
            mode: 'bless',     // 'bless' (default) | 'social'
            posterPreset: DEFAULT_PRESET,   // blessPoster.js PRESETS: 3×4 ft by default; 2×3 ft; 5×8 ft on three glued sheets
            // Each label is isolated left to right (U+2066 … U+2069): "5 × 8 ft · 3×" would otherwise be reordered
            // by an RTL page into "×ft · 3 8 × 5" (an <option> cannot hold a <bdi>).
            posterPresets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: '\u2066' + p.label + (p.sheets > 1 ? ' · ' + p.sheets + '×' : '') + '\u2069' })),
            printing: false,    // the HD poster print is loading photos (drives the button's busy state)
            printProgress: null, // { n, total, failed }: the print frame's photos, counted while they load
            printStarted: 0,     // when the current print was asked for (the progress card's clock)
            printClock: 0,       // seconds since then, ticked once a second while printing
            toast: '',          // a short status line over the wall (e.g. "Copied!"), cleared by flash()
            cardWidth: 50,      
            cardHeight: 70,     
            cardSpacing: 8,        // Increased horizontal spacing (was 2)
            cardVerticalSpacing: 8, // same as the horizontal gap, so the rows don't read as one block
            canvasWidth: 0,
            canvasHeight: 0,
            isLandscape: true,
            lodState: { mode: 'placeholder', loaded: 0, total: 0, cardPx: 0 }
        };
    },
    computed: {
        loading() {
            return this.$store?.loading || false;
        },
        
        totalGroups() {
            return this.$store?.totalGroups || 0;
        },
        
        peopleGroups() {
            return this.$store?.peopleGroups || [];
        },

        loadError() {
            return this.$store?.error || null;
        },

        // The progress card: "Preparing the poster: n of total photos · m:ss" (the count once the frame reports it).
        printTitle() {
            const s = this.printClock, clock = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
            const p = this.printProgress
            return p ? this.$t('wall.printPreparing', { n: p.n.toLocaleString('en-US'), total: p.total.toLocaleString('en-US') }) + ' · ' + clock : clock
        },
        printPercent() {
            const p = this.printProgress
            return { percent: p && p.total ? (100 * p.n) / p.total : 0 }
        },
        printLabel() {
            const p = this.printing && this.printProgress
            return p ? this.$t('wall.printPreparing', { n: p.n.toLocaleString('en-US'), total: p.total.toLocaleString('en-US') }) : this.$t('wall.printPoster');
        }
    },
    mounted() {
        // A test hook on the HOST element (not window): the level-of-detail state, as before.
        try { const host = this.$el?.getRootNode?.()?.host; if (host) host.__wallLod = () => ({ ...this.lodState, cardPx: this._wc ? this._wc.stats.cardPx : this.lodState.cardPx, stats: this._wc ? { ...this._wc.stats } : null }); } catch (_) { /* no host */ }
        this.initializeCanvas();
        this.fetchData();
        // The canvas is not reactive: redraw when a prayer is added (heart + count) or the language changes.
        this.$watch(() => this.$store?.prayers, () => this._wc?.request(), { deep: true });
        this.$watch(() => this.$i18n?.locale, () => { this.showPoster(); this._wc?.request(); });
        this.$watch(() => this.posterPreset, () => this.showPoster());
    },
    beforeUnmount() {
        // Release the canvas, its listeners and every cached photo (the fleet's leak rule).
        this._wc?.destroy(); this._wc = null;
        clearInterval(this._printTick); this._printTick = null;
        try { const host = this.$el?.getRootNode?.()?.host; if (host) delete host.__wallLod; } catch (_) { /* no host */ }
    },
    methods: {
        async fetchData() {
            if (this.$store) {
                this.$store.profileConfig = this.profileConfig;
                await this.$store.fetchPeopleGroups();
                this.renderCards();
            } else {
                console.error('❌ Store not available!');
            }
        },
        
        // ONE <canvas> (wallCanvas.js) instead of an SVG of ~36,000 nodes: the same world, grid and
        // gestures, drawn per frame for the cards in view only.
        initializeCanvas() {
            this.canvasWidth = this.isLandscape ? 4000 : 3000;
            this.canvasHeight = this.isLandscape ? 3000 : 4000;
            if (this._wc) { this._wc.setWorld(this.canvasWidth, this.canvasHeight); return; }
            this._wc = new WallCanvas(this.$refs.canvas, {
                worldW: this.canvasWidth, worldH: this.canvasHeight,
                label: this.$t('wall.title'),
                spacing: this.cardSpacing, vSpacing: this.cardVerticalSpacing,
                labels: (k, p, n) => (n === undefined ? this.$t(k, p) : this.$t(k, p, n)),
                prayCount: (d) => Number(d.peoplePraying || 0) + (this.$store?.prayers?.[d.ID] || 0),
                onPray: (d) => this.openPrayerDialog(d),
                onComments: (d) => this.openComments(d),
                onShare: (d) => this.shareGroup(d),
            });
            this._wc.setMode(this.mode);
        },
        renderCards() {
            if (!this._wc || !this.peopleGroups || this.peopleGroups.length === 0) return;
            this._wc.setGroups(this.peopleGroups);
            this.showPoster();
            this.$nextTick(() => this._wc?.startView(96));
            this.lodState = { mode: 'canvas', loaded: 0, total: this.peopleGroups.length, cardPx: 0 };
        },
        // Print always prints the poster (blessPoster.js): 3 × 4 ft by default; 5 × 8 ft is three stacked sheets.
        onPrint() { return this.printBlessPoster(); },
        printBlessPoster() {
            if (this.printing) return;
            const groups = (this.peopleGroups || []).map((d) => ({ name: d.name || d.post_title || '', imageUrl: d.imageUrl || '' }));
            if (!groups.length) return;
            this.printing = true;
            this.startPrintClock();
            const texts = this.posterTexts(groups.length);
            // A PHONE PRINTS THE PAGE (printInPlace.printDocument): there is no frame to watch, and printDocument
            // itself waits for the photos before it prints.
            if (isPhonePrint()) {
                printDocument(buildBlessPosterHtml(groups, this.posterPreset, texts), { labels: { print: this.$t('wall.printPoster'), close: this.$t('buttons.close') } })
                    .finally(() => setTimeout(() => { this.printing = false; this.printProgress = null; }, 300));
                return;
            }
            const win = openPrintFrame(buildBlessPosterHtml(groups, this.posterPreset, texts), { autoprint: true });
            // Busy until the photos have loaded and the print dialog is up (the frame prints on its own 'load',
            // which waits for every photo). Never silently incomplete: the button counts the photos as they
            // arrive (printWatch.js), and a photo that could not load is counted out loud, since it prints as
            // a grey box.
            const done = () => { this.printing = false; this.printProgress = null; };
            if (!win) { done(); return; }
            watchPrintFrame(win, {
                onProgress: (c) => { this.printProgress = c; },
                onDone: (c) => {
                    if (c && c.failed) this.flash(this.$t('wall.printMissing', { n: c.failed.toLocaleString('en-US') }), 10000);
                    setTimeout(done, 300);
                },
            });
        },
        // The progress card's clock: from the click until the print is done (stops itself once printing ends).
        startPrintClock() {
            clearInterval(this._printTick);
            this.printStarted = Date.now(); this.printClock = 0;
            this._printTick = setInterval(() => {
                if (!this.printing) { clearInterval(this._printTick); this._printTick = null; return; }
                this.printClock = Math.floor((Date.now() - this.printStarted) / 1000);
            }, 1000);
        },
        // The wall in Bless mode IS the poster (WYSIWYG): the same sheets, cards, title, chart and footer that
        // print, from the same blessPoster layout. Re-planned when the groups, the size or the language change.
        showPoster() {
            const n = (this.peopleGroups || []).length;
            if (!this._wc || !n) return;
            const groups = this.peopleGroups.map((d) => ({ name: d.name || d.post_title || '' }));
            this._wc.setPoster(screenPoster(groups, this.posterPreset, this.posterTexts(n)));
            // A new size or language shows the whole poster again; the Social board keeps its own zoom.
            if (this.mode === 'bless') this._wc.fitAll();
        },
        posterTexts(n) {
            return {
                banner: this.$t('wall.blessBanner'),
                subtitle: this.$t('wall.posterSubtitle', { n: n.toLocaleString('en-US') }),
                glueHere: this.$t('wall.glueHere'),
                // The chart labels, the journey's station names and the closing line are translated. The
                // scripture (cards, chart, blessing, journey) prints in the WEB's English in EVERY locale on
                // purpose, until per-locale Bibles are chosen (sheet row 103).
                labels: {
                    themesLabel: this.$t('wall.themesLabel'),
                    oldTestament: this.$t('wall.oldTestament'),
                    newTestament: this.$t('wall.newTestament'),
                    theme_treasure: this.$t('wall.themeTreasure'),
                    theme_mountain: this.$t('wall.themeMountain'),
                    theme_sea: this.$t('wall.themeSea'),
                    closing: this.$t('wall.posterClosing'),
                    journey_called: this.$t('wall.journeyCalled'),
                    journey_promised: this.$t('wall.journeyPromised'),
                    journey_redeemed: this.$t('wall.journeyRedeemed'),
                    journey_cornerstone: this.$t('wall.journeyCornerstone'),
                    journey_children: this.$t('wall.journeyChildren'),
                    journey_priesthood: this.$t('wall.journeyPriesthood'),
                    journey_sent: this.$t('wall.journeySent'),
                },
                lang: String(this.$i18n?.locale || 'en'),
                dir: /^(ar|he|fa|ur)/.test(String(this.$i18n?.locale || '')) ? 'rtl' : 'ltr',
            };
        },
        // SHARE (Social mode): the group's prayer page (groupLink: pray.doxa.life, else Joshua Project).
        // The phone's share sheet where there is one; otherwise the link is copied, and "Copied!" says so.
        // If the clipboard is refused (an http page, a denied permission), the page opens instead.
        async shareGroup(g) {
            const url = groupLink(g);
            if (!url) return;
            const title = g.name || g.post_title || '';
            if (typeof navigator !== 'undefined' && navigator.share) {
                try { await navigator.share({ title, url }); return; }
                catch (e) { if (e && e.name === 'AbortError') return; }
            }
            try { await navigator.clipboard.writeText(url); this.flash(this.$t('messages.copied')); }
            catch (_) { window.open(url, '_blank', 'noopener,noreferrer'); }
        },
        // Show a status line for a moment. Cleared by IDENTITY (the token it set), never by comparing text,
        // so a translated message clears just the same.
        flash(msg, ms = 2000) {
            const token = {};
            this._toastToken = token;
            this.toast = msg;
            setTimeout(() => { if (this._toastToken === token) this.toast = ''; }, ms);
        },
        setMode(m) {
            if (this.mode === m) return;
            this.mode = m;
            this._wc?.setMode(m);
        },
        handlePrayer(group) {
            // This method is deprecated - now using openPrayerDialog
            this.openPrayerDialog(group);
        },
        
        openPrayerDialog(group) {
            this.$emit('open-prayer', group);
        },
        
        // Comments are not built yet: the comment and "view prayers" taps say so instead of opening an empty board.
        openComments() {
            this.flash(this.$t('wallSocial.commentsSoon'), 3000);
        },
        
        truncateText(text, maxLength) {
            if (!text) return '';
            return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
        },
        
        // The wall opens where the photos are (wallCanvas.startView: cards ~96 px); Reset Zoom shows it all.
        resetZoom() { this._wc?.resetZoom(); },
        toggleOrientation() {
            this.isLandscape = !this.isLandscape;
            this.initializeCanvas();
            this.renderCards();
        },
    },
};
</script>
