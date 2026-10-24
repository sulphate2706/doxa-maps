/**
 * Avatar Generator Composable
 *
 * Generates two-letter avatars with color-coded backgrounds
 * Used in popups, legends, and people group detail views
 */

/**
 * Avatar color palette
 * 8 colors provide good distribution across alphabet
 */
const AVATAR_COLORS = [
    '#e74c3c', // Red
    '#3498db', // Blue
    '#2ecc71', // Green
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Teal
    '#e67e22', // Dark Orange
    '#34495e'  // Dark Gray
];

/**
 * Generate avatar data for a people group
 * @param {string} name - People group name
 * @returns {object} Avatar data { letter, color, backgroundColor }
 */
export function generateAvatar(name) {
    const firstLetter = (name || 'U')[0].toUpperCase();
    const colorIndex = firstLetter.charCodeAt(0) % AVATAR_COLORS.length;
    const backgroundColor = AVATAR_COLORS[colorIndex];

    return {
        letter: firstLetter,
        color: '#ffffff', // White text
        backgroundColor
    };
}

/**
 * Generate avatar HTML for inline use (popups, etc.)
 * @param {string} name - People group name
 * @param {object} options - { size: 32, borderRadius: 4 }
 * @returns {string} HTML string
 */
export function generateAvatarHTML(name, options = {}) {
    const { size = 32, borderRadius = 4 } = options;
    const avatar = generateAvatar(name);

    return `
        <div style="
            width: ${size}px;
            height: ${size}px;
            border-radius: ${borderRadius}px;
            background-color: ${avatar.backgroundColor};
            color: ${avatar.color};
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: ${Math.floor(size * 0.5)}px;
            flex-shrink: 0;
        ">${avatar.letter}</div>
    `;
}

/**
 * Get avatar style object for Vue :style binding
 * @param {string} name - People group name
 * @param {object} options - { size: 32, borderRadius: 4 }
 * @returns {object} Style object
 */
export function getAvatarStyle(name, options = {}) {
    const { size = 32, borderRadius = 4 } = options;
    const avatar = generateAvatar(name);

    return {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${borderRadius}px`,
        backgroundColor: avatar.backgroundColor,
        color: avatar.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: '600',
        fontSize: `${Math.floor(size * 0.5)}px`,
        flexShrink: '0'
    };
}

export default {
    generateAvatar,
    generateAvatarHTML,
    getAvatarStyle,
    AVATAR_COLORS
};
