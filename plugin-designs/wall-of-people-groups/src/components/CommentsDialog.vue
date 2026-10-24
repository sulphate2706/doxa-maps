<template>
        <div v-if="visible" class="dialog-overlay" @click="closeDialog">
            <div class="dialog-container" @click.stop ref="dialogBox" role="dialog" aria-modal="true" :aria-label="$t('wall.chatsTitle')" tabindex="-1">
                <!-- Dialog Header -->
                <div class="dialog-header">
                    <h2>{{ $t('wall.chatsTitle') }}</h2>
                    <button class="close-btn" :aria-label="$t('wall.close')" @click="closeDialog">✕</button>
                </div>
                
                <!-- People Group Image (Instagram style) -->
                <div class="group-image-container">
                    <img 
                        :src="getImageUrl()" 
                        :alt="group?.name || $t('wall.peopleGroup')"
                        class="group-image"
                        @error="handleImageError"
                    />
                </div>
                
                <div class="group-name-dialog">{{ group?.name || $t('wall.unknownGroup') }}</div>
                
                <!-- People Group Info -->
                <div class="dialog-content">
                    <div class="group-info">
                        <div class="info-row">
                            <strong>{{ $t('wall.status') }}</strong> {{ group?.status || $t('wall.unknown') }}
                        </div>
                        <div class="info-row">
                            <strong>{{ $t('wall.id') }}</strong> {{ group?.ID || $t('wall.na') }}
                        </div>
                        <div class="info-row" v-if="group?.lat && group?.lng">
                            <strong>{{ $t('wall.location') }}</strong> {{ group.lat }}, {{ group.lng }}
                        </div>
                        <div class="info-row prayer-stat">
                            <span class="heart-icon">❤️</span>
                            {{ $t('wall.havePrayed', { n: prayerCount }, prayerCount) }}
                        </div>
                    </div>
                    
                    <!-- Prayer Button -->
                    <div class="prayer-action">
                        <button 
                            class="prayer-btn" 
                            @click="addPrayer"
                            :class="{ active: justPrayed }"
                        >
                            {{ justPrayed ? $t('wall.youPrayed') : $t('wall.prayForGroup') }}
                        </button>
                    </div>
                    
                    <!-- Comments Section -->
                    <div class="comments-section">
                        <h3>{{ $t('wall.prayersComments') }}</h3>
                        
                        <!-- Comment List -->
                        <div class="comments-list">
                            <div 
                                v-if="comments.length === 0" 
                                class="no-comments"
                            >
                                {{ $t('wall.noComments') }}
                            </div>
                            
                            <div 
                                v-for="comment in comments" 
                                :key="comment.id"
                                class="comment-item"
                            >
                                <div class="comment-header">
                                    <span class="comment-icon">💭</span>
                                    <span class="comment-date">{{ formatDate(comment.timestamp) }}</span>
                                </div>
                                <div class="comment-text">{{ comment.text }}</div>
                            </div>
                        </div>
                        
                        <!-- Add Comment Form -->
                        <div class="add-comment">
                            <textarea 
                                v-model="newComment"
                                :placeholder="$t('wall.commentPlaceholder')"
                                rows="3"
                                maxlength="500"
                            ></textarea>
                            <div class="comment-actions">
                                <span class="char-count">{{ newComment.length }}/500</span>
                                <button 
                                    @click="submitComment"
                                    :disabled="!newComment.trim()"
                                    class="submit-btn"
                                >
                                    {{ $t('wall.postComment') }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    
</template>

<script>
import { trapDialog } from '../trapDialog.js'
// No third-party placeholder service: a missing photo is drawn inline.
const NO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400'%3E%3Crect width='100%25' height='100%25' fill='%23f3f3f1'/%3E%3Ctext x='50%25' y='50%25' fill='%236d766e' font-family='sans-serif' font-size='22' text-anchor='middle' dominant-baseline='middle'%3ENo image available%3C/text%3E%3C/svg%3E"
// Comments and Prayers Dialog Component
export default {
    name: 'CommentsDialog',
    props: {
        group: {
            type: Object,
            default: null
        },
        visible: {
            type: Boolean,
            default: false
        }
    },
    data() {
        return {
            newComment: '',
            justPrayed: false,
            imageError: false
        };
    },
    computed: {
        prayerCount() {
            if (!this.group || !this.$store) return 0;
            // Access the prayers state directly
            return this.$store.prayers?.[this.group.ID] || 0;
        },
        
        comments() {
            if (!this.group || !this.$store) return [];
            // Access the comments state directly
            return this.$store.comments?.[this.group.ID] || [];
        }
    },
    beforeUnmount() { this._releaseTrap?.(); this._releaseTrap = null; },
    methods: {
        closeDialog() {
            this.$emit('close');
            this.newComment = '';
            this.justPrayed = false;
        },
        
        addPrayer() {
            if (this.group && this.$store) {
                this.$store.addPrayer(this.group.ID);
                this.justPrayed = true;
                
                // Reset after 2 seconds
                setTimeout(() => {
                    this.justPrayed = false;
                }, 2000);
            }
        },
        
        submitComment() {
            if (this.newComment.trim() && this.group && this.$store) {
                this.$store.addComment(
                    this.group.ID,
                    this.newComment.trim()
                );
                this.newComment = '';
            }
        },
        
        formatDate(timestamp) {
            const date = new Date(timestamp);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            
            // The reader's language, from the platform: "just now" / "5 minutes ago" / "hace 5 minutos" …
            // (Intl.RelativeTimeFormat), so no hand-built English "m ago" and no catalogue keys to drift.
            const locale = String(this.$i18n?.locale || 'en');
            let rtf = null;
            try { rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }); } catch (_) { /* old engine: fall back below */ }
            if (rtf) {
                if (diffMins < 1) return rtf.format(0, 'second');
                if (diffMins < 60) return rtf.format(-diffMins, 'minute');
                if (diffHours < 24) return rtf.format(-diffHours, 'hour');
                if (diffDays < 7) return rtf.format(-diffDays, 'day');
            }
            return date.toLocaleDateString(locale);
        },
        
        getImageUrl() {
            if (this.imageError) {
                return NO_IMAGE;
            }
            
            // The card's own photo (the live API's image_url); uupg.doxa.life no longer answers.
            return this.group?.imageUrl || NO_IMAGE;
        },
        
        handleImageError(event) {
            this.imageError = true;
            event.target.src = NO_IMAGE;
        }
    },
    watch: {
        visible(newVal) {
            if (newVal) this.$nextTick(() => { this._releaseTrap?.(); this._releaseTrap = trapDialog(this.$refs.dialogBox, () => this.closeDialog()); });
            else { this._releaseTrap?.(); this._releaseTrap = null; }
            if (newVal) {
                // Reset state when dialog opens
                this.justPrayed = false;
            }
        }
    }
};
</script>
