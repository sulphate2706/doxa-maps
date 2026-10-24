// People Groups Store - Manages data from the Doxa prayer API
// Moved 2026-09-25 from the wall-of-people-groups no-build SPA: Pinia now comes from the package
// (it was the Pinia CDN global), localStorage keys carry a 'wall-pg:' prefix so an embedded wall
// cannot collide with the host page's own keys, and the source list is the one live API.
import { defineStore } from 'pinia'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
const LS = (k) => 'wall-pg:' + k

export const usePeopleGroupsStore = (pinia) => {
    
    return defineStore('peopleGroups', {
        state: () => ({
            // The page's profile-config, set by the wall before it fetches: its people-group LIST.
            profileConfig: null,
            peopleGroups: [],
            loading: false,
            error: null,
            prayers: {}, // Track prayers per people group ID
            comments: {}, // Track comments per people group ID
            dataSource: 'PRAY_API',
            // The one source. The Doxa WordPress endpoint (uupg.doxa.life) no longer answers, and the CSV
            // fallback was a 2.6 MB copy of what the live API already serves, so neither ships, and with
            // them went the source picker (it only showed with two sources or more) and their loaders.
            availableSources: [
                { id: 'PRAY_API', name: 'Prayer.Tools API (Live)', url: 'https://pray.doxa.life/api/people-groups/list', description: 'Live prayer data with images' }
            ]
        }),
        
        getters: {
            totalGroups: (state) => state.peopleGroups.length,
            
            getPrayerCount: (state) => (groupId) => {
                return state.prayers[groupId] || 0;
            },
            
            getComments: (state) => (groupId) => {
                return state.comments[groupId] || [];
            }
        },
        
        actions: {
            async fetchPeopleGroups() {
                this.loading = true;
                this.error = null;
                
                
                try {
                    await this.fetchFromPrayAPI();
                } catch (error) {
                    // warn, not error: the wall now SAYS so on screen (PeopleGroupsWall's offline notice)
                    // and offers a retry; an unreachable API is an expected state, not a crash.
                    console.warn(`Could not fetch people groups from ${this.dataSource}:`, error && error.message);
                    this.error = error.message;
                    this.peopleGroups = [];
                } finally {
                    this.loading = false;
                }
            },
            
            async fetchFromPrayAPI() {
                const source = this.availableSources.find(s => s.id === 'PRAY_API');
                const apiUrl = source.url;
                
                const response = await fetch(apiUrl);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                // Guard against HTML responses (bot protection, Nuxt SPA shell)
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('text/html')) {
                    throw new Error('Server returned HTML instead of JSON — the API endpoint may be blocked or unavailable');
                }
                
                const data = await response.json();
                // Only the groups of this page's people-group LIST (library/lists/).
                const posts = await applyPeopleGroupList(data.posts && Array.isArray(data.posts) ? data.posts : (Array.isArray(data) ? data : []), this.profileConfig);
                
                if (posts.length === 0) {
                    console.error('Unexpected API response format:', data);
                    this.peopleGroups = [];
                    return;
                }
                
                this.peopleGroups = posts.map(group => {
                    // Extract labels from nested value/label objects
                    const regionLabel = group.wagf_region?.label || group.wagf_region || '';
                    const blockLabel = group.wagf_block?.label || group.wagf_block || '';
                    const countryLabel = group.country_code?.label || group.country_code || '';
                    const countryCode = group.country_code?.value || group.country_code || '';
                    const religionLabel = group.religion?.label || group.religion || '';
                    const religionCode = group.religion?.value || '';
                    const affinityLabel = group.rop1?.label || '';
                    
                    // The API's own photo URL, or none. Today every group has one (a group without its own
                    // photo gets a regional one). The stock "no image" photo this used to fall back to answers
                    // 404 (2026-09-29), so a group with no URL now gets none: the canvas draws its grey box
                    // without a request, and the print its .noimg box, the same on both.
                    const hasPhoto = group.has_photo === true || group.has_photo === 'true' || group.has_photo === 1;
                    const imageUrl = group.image_url || '';
                    
                    return {
                        // Standard fields
                        ID: group.slug || `pray-${Math.random().toString(36).slice(2)}`,
                        post_title: group.name || 'Unknown',
                        name: group.name || 'Unknown',
                        slug: group.slug || '',
                        status: '',
                        country: countryLabel,
                        countryCode: countryCode,
                        region: regionLabel,
                        wagfBlock: blockLabel,
                        population: group.population || '',
                        religion: religionLabel,
                        religionCode: religionCode,
                        affinityBlock: affinityLabel,
                        latitude: group.latitude || null,
                        longitude: group.longitude || null,
                        description: group.location_description || '',
                        
                        // Prayer & engagement data (THE KEY FIELDS!)
                        peoplePraying: Number(group.people_praying || 0),
                        peopleCommitted: Number(group.people_committed || 0),
                        adoptedByChurches: Number(group.adopted_by_churches || 0),
                        
                        // Image fields
                        imageUrl: imageUrl,
                        hasPhoto: hasPhoto,
                        photoCredit: group.picture_credit || null,

                        // Keep all original API data
                        ...group
                    };
                });
                // No background photo test. It loaded EVERY photo, three at a time, to learn which ones
                // fail: 932 photos, 132 MB by their Content-Length (2026-09-29; the 77 IMB photos alone are
                // 115 MB), for as long as the page stayed open, whether or not anyone zoomed in.
                // All 939 photo URLs answered 200. The canvas already loads only the photos in view and
                // draws the grey box for any that fail, so the test bought nothing it did not already have.
            },
            
            addPrayer(groupId) {
                if (!this.prayers[groupId]) {
                    this.prayers[groupId] = 0;
                }
                this.prayers[groupId]++;
                
                // Save to localStorage for persistence
                localStorage.setItem(LS('prayers'), JSON.stringify(this.prayers));
            },
            
            addComment(groupId, comment) {
                if (!this.comments[groupId]) {
                    this.comments[groupId] = [];
                }
                
                this.comments[groupId].push({
                    id: Date.now(),
                    text: comment,
                    timestamp: new Date().toISOString()
                });
                
                // Save to localStorage for persistence
                localStorage.setItem(LS('comments'), JSON.stringify(this.comments));
            },
            
            loadFromLocalStorage() {
                try {
                    const savedPrayers = localStorage.getItem(LS('prayers'));
                    const savedComments = localStorage.getItem(LS('comments'));
                    
                    if (savedPrayers) {
                        this.prayers = JSON.parse(savedPrayers);
                    }
                    
                    if (savedComments) {
                        this.comments = JSON.parse(savedComments);
                    }
                } catch (error) {
                    console.error('Error loading from localStorage:', error);
                }
            }
        }
    })(pinia);
};



