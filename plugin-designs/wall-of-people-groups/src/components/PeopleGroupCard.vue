<template>
        <div 
            class="people-group-card" 
            :style="{ transform: 'translate(' + x + 'px, ' + y + 'px)' }"
        >
            <!-- Header with People Group Name -->
            <div class="card-header">
                <h3 class="group-name">
                    <a 
                        v-if="hasJoshuaProjectLink()" 
                        :href="getJoshuaProjectUrl()" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        class="group-name-link"
                    >
                        {{ group.name || group.post_title || $t('wall.unknownGroup') }}
                    </a>
                    <span v-else class="group-name-no-link" :title="$t('wall.noPeopleId')">
                        {{ group.name || group.post_title || $t('wall.unknownGroup') }}
                    </span>
                </h3>
                <span class="group-status">{{ group.status || $t('wall.statusUnknown') }}</span>
            </div>
            
            <!-- Image Placeholder -->
            <div class="card-image" @click="$emit('view-detail', group)">
                <img 
                    :src="getImageUrl()" 
                    :alt="group.name"
                    @error="handleImageError"
                />
            </div>
            
            <!-- Action Buttons (Instagram style) -->
            <div class="card-actions">
                <button 
                    class="action-btn heart-btn" 
                    @click="handlePrayer"
                    :class="{ active: hasPrayed }"
                >
                    <span class="icon">{{ hasPrayed ? '❤️' : '🤍' }}</span>
                </button>
                
                <button 
                    class="action-btn comment-btn" 
                    @click="$emit('open-comments', group)"
                >
                    <span class="icon">💬</span>
                </button>
                
                <button 
                    class="action-btn share-btn" 
                    @click="handleShare"
                >
                    <span class="icon">📤</span>
                </button>
            </div>
            
            <!-- Prayer Count -->
            <div class="card-footer">
                <p class="prayer-count">
                    <strong>{{ prayerCount }}</strong> {{ prayerCount === 1 ? 'person' : 'people' }} 
                    prayed that they would receive God's love and the love of a missionary
                </p>
                
                <button 
                    class="view-comments-btn" 
                    @click="$emit('open-comments', group)"
                >
                    View prayers and comments
                </button>
            </div>
        </div>
    
</template>

<script>
// No third-party placeholder service: a missing photo is drawn inline.
const NO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400'%3E%3Crect width='100%25' height='100%25' fill='%23f3f3f1'/%3E%3Ctext x='50%25' y='50%25' fill='%236d766e' font-family='sans-serif' font-size='22' text-anchor='middle' dominant-baseline='middle'%3ENo image available%3C/text%3E%3C/svg%3E"
// People Group Card Component - Instagram style
export default {
    name: 'PeopleGroupCard',
    props: {
        group: {
            type: Object,
            required: true
        },
        x: {
            type: Number,
            default: 0
        },
        y: {
            type: Number,
            default: 0
        }
    },
    data() {
        return {
            imageError: false,
            hasPrayed: false
        };
    },
    computed: {
        prayerCount() {
            // Access the prayers state directly
            const groupId = this.group.id || this.group.PeopleID3;
            return this.$store?.prayers?.[groupId] || 0;
        }
    },
    methods: {
        hasJoshuaProjectLink() {
            const peopleID3 = this.group.peopleID3 || this.group.PeopleID3;
            return peopleID3 && peopleID3.trim() !== '';
        },
        
        getJoshuaProjectUrl() {
            const peopleID3 = this.group.peopleID3 || this.group.PeopleID3;
            if (!peopleID3 || peopleID3.trim() === '') {
                return null;
            }
            return `https://joshuaproject.net/people_groups/${peopleID3}`;
        },
        
        getImageUrl() {
            if (this.imageError) {
                return NO_IMAGE;
            }
            
            // The live API's image_url; uupg.doxa.life no longer answers.
            return this.group.imageUrl || NO_IMAGE;
        },
        
        handleImageError(event) {
            this.imageError = true;
            event.target.src = NO_IMAGE;
        },
        
        handlePrayer() {
            this.hasPrayed = !this.hasPrayed;
            if (this.hasPrayed) {
                this.$emit('add-prayer', this.group.id || this.group.PeopleID3);
            }
        },
        
        handleShare() {
            alert('Sharing functionality coming later!');
        }
    }
};
</script>
