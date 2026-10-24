<template>
    <!-- availableSources, the computed below: the template read an undefined `sources`, so this
         threw "reading 'length'" on EVERY render, online or not (Vue logs it; nothing crashes) -->
    <div v-if="availableSources.length > 1">
        <div class="source-selector">
            <div class="source-header">
                <h3>📊 Data Source</h3>
                <span class="current-source-label">Current: {{ currentSource?.name }}</span>
            </div>
            
            <div class="source-buttons">
                <button 
                    v-for="source in availableSources" 
                    :key="source.id"
                    @click="selectSource(source.id)"
                    :class="['source-btn', { active: dataSource === source.id }]"
                >
                    <span class="source-icon">{{ getSourceIcon(source.id) }}</span>
                    <span class="source-name">{{ source.name }}</span>
                    <span v-if="dataSource === source.id" class="active-indicator">✓</span>
                </button>
            </div>
            
            <div class="source-info">
                <p v-if="currentSource">
                    <strong>Source URL:</strong><br>
                    <code>{{ currentSource.url }}</code>
                </p>
                <p v-if="dataSource === 'CSV'" class="csv-info">
                    <span aria-hidden="true">ⓘ</span> CSV includes ~1,439 groups with images from Joshua Project
                </p>
                <p v-if="dataSource === 'DOXA_API'" class="api-info">
                    <span aria-hidden="true">ⓘ</span> WordPress API — descriptions & photos, no prayer data
                </p>
                <p v-if="dataSource === 'PRAY_API'" class="api-info">
                    <span aria-hidden="true">ⓘ</span> Live prayer data — people praying, committed workers, adoption, images
                </p>
            </div>
        </div>
    
    </div>
</template>

<script>
// Source Selector Component - Switch between API and CSV data sources
export default {
    name: 'SourceSelector',
    computed: {
        dataSource() {
            return this.$store?.dataSource || 'API';
        },
        
        availableSources() {
            return this.$store?.availableSources || [];
        },
        
        currentSource() {
            return this.$store?.currentSource || null;
        }
    },
    methods: {
        selectSource(sourceId) {
            if (this.$store) {
                this.$store.setDataSource(sourceId);
            }
        },
        
        getSourceIcon(sourceId) {
            switch(sourceId) {
                case 'PRAY_API':
                    return '🙏';
                case 'DOXA_API':
                    return '🌐';
                case 'API':
                    return '🌐';
                case 'CSV':
                    return '📄';
                default:
                    return '📊';
            }
        }
    }
};
</script>
