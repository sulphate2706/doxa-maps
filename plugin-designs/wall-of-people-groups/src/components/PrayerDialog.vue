<template>
        <div v-if="isOpen" class="dialog-overlay" @click.self="closeDialog">
            <div class="dialog-container prayer-dialog" ref="dialogBox" role="dialog" aria-modal="true" :aria-label="$t('wall.prayerTools')" tabindex="-1">
                <div class="dialog-header">
                    <h2>{{ $t('wall.prayerTools') }}</h2>
                    <button @click="closeDialog" class="close-btn" :aria-label="$t('wall.close')">&times;</button>
                </div>
                
                <div class="group-image-container">
                    <img 
                        :src="getImageUrl()" 
                        :alt="group?.name || $t('wall.peopleGroup')"
                        @error="handleImageError"
                    />
                </div>
                
                <div class="group-name-dialog">
                    {{ group?.name || $t('wall.unknown') }}
                </div>
                
                <div class="dialog-content">
                    <div class="group-info">
                        <div class="info-row">
                            <strong>{{ $t('wall.status') }}</strong> {{ group?.status || $t('wall.unengaged') }}
                        </div>
                    </div>
                    
                    <div v-if="!hasPrayed" class="prayer-prompt">
                        <h3>{{ $t('wall.prayingNow') }}</h3>
                        <button @click="confirmPrayer" class="prayer-confirm-btn">
                            <svg class="heart-icon" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.2-4.4-9.2-8.8C1.3 8.3 3.2 4.6 6.7 4.6c2 0 3.5 1.1 4.3 2.4.8-1.3 2.3-2.4 4.3-2.4 3.5 0 5.4 3.7 3.9 7.1-2 4.4-9.2 8.8-9.2 8.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                            {{ $t('wall.yesPraying') }}
                        </button>
                    </div>
                    
                    <!-- The group's own sign-up on pray.doxa.life (its #signup-section): commit to pray for it there. -->
                    <a v-if="signUpUrl" :href="signUpUrl" target="_blank" rel="noopener noreferrer" class="signup-link">{{ $t('wallSocial.signUpToPray', { name: group?.name || '' }) }}</a>

                    <div v-if="hasPrayed" class="prayer-confirmed">
                        <div class="confirmed-message">
                            <svg class="heart-icon" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.2-4.4-9.2-8.8C1.3 8.3 3.2 4.6 6.7 4.6c2 0 3.5 1.1 4.3 2.4.8-1.3 2.3-2.4 4.3-2.4 3.5 0 5.4 3.7 3.9 7.1-2 4.4-9.2 8.8-9.2 8.8z" fill="#ed4956" stroke="#ed4956" stroke-width="1.8" stroke-linejoin="round"/></svg>
                            <span>{{ $t('wall.thankYou') }}</span>
                        </div>
                        
                        <div class="prayer-input-section">
                            <h4>{{ $t('wall.sharePrayer') }}</h4>
                            <textarea 
                                v-model="prayerText" 
                                :placeholder="$t('wall.prayerPlaceholder')"
                                rows="4"
                            ></textarea>
                            <button 
                                @click="sendPrayer" 
                                :disabled="!prayerText.trim()"
                                class="send-prayer-btn"
                            >
                                {{ $t('wall.sendPrayer') }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    
</template>

<script>
import { trapDialog } from '../trapDialog.js'
// No third-party placeholder service: a missing photo is drawn inline.
// The locales pray.doxa.life serves under a path prefix (English is unprefixed).
const PRAY_LOCALES = new Set(['ar', 'de', 'es', 'fr', 'hi', 'it', 'pt', 'ro', 'ru', 'zh'])
const NO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400'%3E%3Crect width='100%25' height='100%25' fill='%23f3f3f1'/%3E%3Ctext x='50%25' y='50%25' fill='%236d766e' font-family='sans-serif' font-size='22' text-anchor='middle' dominant-baseline='middle'%3ENo image available%3C/text%3E%3C/svg%3E"
export default {
    name: 'PrayerDialog',
    props: {
        isOpen: {
            type: Boolean,
            default: false
        },
        group: {
            type: Object,
            default: null
        }
    },
    data() {
        return {
            hasPrayed: false,
            prayerText: '',
            imageError: false
        };
    },
    computed: {
        // The group's prayer sign-up on pray.doxa.life (the #signup-section of its page), in the reader's language:
        // the site serves its group pages under /<lc>/ for these ten locales and English unprefixed (read from its
        // routes; /ar/<slug> carries the same section). None without a slug.
        signUpUrl() {
            const slug = this.group && this.group.slug
            if (!slug) return ''
            const lc = String(this.$i18n?.locale || 'en').split('-')[0].toLowerCase()
            const prefix = PRAY_LOCALES.has(lc) ? '/' + lc : ''
            return `https://pray.doxa.life${prefix}/${encodeURIComponent(slug)}#signup-section`
        },
    },
    watch: {
        isOpen(newVal) {
            if (newVal) this.$nextTick(() => { this._releaseTrap?.(); this._releaseTrap = trapDialog(this.$refs.dialogBox, () => this.closeDialog()); });
            else { this._releaseTrap?.(); this._releaseTrap = null; }
            if (newVal) {
                // Check if user already prayed for this group
                // Access the prayers state directly
                const prayerCount = this.$store?.prayers?.[this.group?.ID] || 0;
                this.hasPrayed = prayerCount > 0;
                this.prayerText = '';
                this.imageError = false;
            }
        }
    },
    beforeUnmount() { this._releaseTrap?.(); this._releaseTrap = null; },
    methods: {
        closeDialog() {
            this.$emit('close');
        },
        
        confirmPrayer() {
            if (this.group?.ID) {
                this.$store.addPrayer(this.group.ID);
                this.hasPrayed = true;
                
                // Emit event to update the card's heart icon
                this.$emit('prayer-confirmed', this.group.ID);
            }
        },
        
        sendPrayer() {
            if (this.prayerText.trim() && this.group?.ID) {
                // Add prayer to comments as a special type
                const pseudonym = this.generatePseudonym();
                const prayerComment = `🙏 ${pseudonym} prayed: ${this.prayerText.trim()}`;
                
                this.$store.addComment(this.group.ID, prayerComment);
                
                this.prayerText = '';
                
                // Close dialog after sending
                setTimeout(() => {
                    this.closeDialog();
                }, 500);
            }
        },
        
        generatePseudonym() {
            const adjectives = ['Faithful', 'Devoted', 'Humble', 'Earnest', 'Hopeful', 'Grateful', 'Compassionate'];
            const nouns = ['Servant', 'Believer', 'Intercessor', 'Warrior', 'Witness', 'Disciple', 'Friend'];
            
            const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
            const noun = nouns[Math.floor(Math.random() * nouns.length)];
            const num = Math.floor(Math.random() * 999) + 1;
            
            return `${adj} ${noun} ${num}`;
        },
        
        getImageUrl() {
            if (this.imageError) {
                return NO_IMAGE;
            }
            
            // The same photo the card shows (the live API's image_url). This used to build a URL on
            // uupg.doxa.life, which no longer answers, so every dialog fell back to "No image".
            return this.group?.imageUrl || NO_IMAGE;
        },
        
        handleImageError(event) {
            this.imageError = true;
            event.target.src = NO_IMAGE;
        }
    }
};
</script>
