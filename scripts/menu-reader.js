var MenuReader = {};

// Glyph code to string mapping (Carbon HIToolbox/Events.h kMenuXxxGlyph constants)
MenuReader.GLYPH_MAP = {
    0x03: 'Enter',
    0x04: 'Tab',
    0x05: '\u2326',    // ⌦ Forward Delete
    0x06: 'Esc',
    0x09: 'Space',
    0x0B: 'Page Up',
    0x0C: 'Page Down',
    0x0D: 'Home',      // ↖
    0x0E: 'End',       // ↘
    0x17: '\u232B',    // ⌫ Delete
    0x60: 'F1',
    0x61: 'F2',
    0x62: 'F3',
    0x63: 'F4',
    0x64: 'F5',
    0x65: 'F6',
    0x66: 'F7',
    0x67: 'F8',
    0x68: 'F9',
    0x69: 'F10',
    0x6A: 'F11',
    0x6B: 'F12',
    0x6C: 'F13',
    0x6D: 'F14',
    0x6E: 'F15',
    0x6F: 'F16',
    0x70: 'F17',
    0x71: 'F18',
    0x72: 'F19',
    0x73: 'F20',
    0x18: '\u2190',    // ← Left Arrow
    0x19: '\u2191',    // ↑ Up Arrow
    0x1A: '\u2192',    // → Right Arrow
    0x1B: '\u2193',    // ↓ Down Arrow
    0x1C: '\u21A9'     // ↩ Return
};

/**
 * Decode AXMenuItemCmdModifiers bitmask to modifier symbols.
 * Command is included by default (bit 3 clears it — inverted logic).
 * Order follows macOS HIG: ⌘⌃⌥⇧
 */
MenuReader._decodeModifiers = function (mask) {
    if (mask === undefined || mask === null) return '';
    var result = '';
    // bit 3 clear → Command is present (default)
    if (!(mask & 8)) result += '\u2318';  // ⌘
    if (mask & 4)    result += '\u2303';  // ⌃
    if (mask & 2)    result += '\u2325';  // ⌥
    if (mask & 1)    result += '\u21E7';  // ⇧
    return result;
};

/**
 * Convert glyph code to human-readable string.
 */
MenuReader._glyphToString = function (glyph) {
    return MenuReader.GLYPH_MAP[glyph] || ('Glyph:' + glyph);
};

/**
 * Extract shortcut info from a menu item's accessibility attributes.
 * Returns { modifiers: string, key: string }
 */
MenuReader._getShortcut = function (menuItem) {
    var modifiers = '';
    var key = '';

    try {
        var attrs = menuItem.attributes();
        var cmdModifiers = null;
        var cmdChar = null;
        var cmdGlyph = null;

        for (var k = 0; k < attrs.length; k++) {
            var attrName = attrs[k].name();
            if (attrName === 'AXMenuItemCmdModifiers') {
                cmdModifiers = attrs[k].value();
            } else if (attrName === 'AXMenuItemCmdChar') {
                cmdChar = attrs[k].value();
            } else if (attrName === 'AXMenuItemCmdGlyph') {
                cmdGlyph = attrs[k].value();
            }
        }

        if (cmdChar || cmdGlyph) {
            modifiers = MenuReader._decodeModifiers(cmdModifiers);
            key = cmdChar || MenuReader._glyphToString(cmdGlyph);
        }
    } catch (e) {
        // No shortcut for this item
    }

    return { modifiers: modifiers, key: key };
};

/**
 * Recursively scan a menu and collect all leaf menu items.
 * @param {Object} menu  - System Events menu object
 * @param {Array}  path  - current hierarchy path (e.g. ["File", "New"])
 * @param {Array}  results - accumulator
 * @param {boolean} includeDisabled - whether to include disabled items
 */
MenuReader._scanMenu = function (menu, path, results, includeDisabled) {
    var items;
    try {
        items = menu.menuItems();
    } catch (e) {
        return;
    }

    for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var itemName;
        try {
            itemName = item.name();
        } catch (e) {
            continue;
        }

        // Skip separators (empty name)
        if (!itemName || itemName === '') continue;

        // Skip disabled items if configured
        if (!includeDisabled) {
            try {
                if (!item.enabled()) continue;
            } catch (e) {
                // If we can't check, include it
            }
        }

        // Check for submenus
        var subMenus;
        try {
            subMenus = item.menus();
        } catch (e) {
            subMenus = [];
        }

        if (subMenus.length > 0) {
            // Has submenu — recurse
            MenuReader._scanMenu(subMenus[0], path.concat([itemName]), results, includeDisabled);
        } else {
            // Leaf item — collect shortcut and add to results
            var shortcut = MenuReader._getShortcut(item);
            results.push({
                path: path.concat([itemName]),
                modifiers: shortcut.modifiers,
                key: shortcut.key
            });
        }
    }
};

/**
 * Read all menu items from the given frontmost process.
 * @param {Object} process - System Events process object
 * @param {boolean} includeDisabled - include disabled (greyed out) items
 * @returns {Array} Array of { path: string[], modifiers: string, key: string }
 */
MenuReader.readAllMenuItems = function (process, includeDisabled) {
    var results = [];
    var menuBar = process.menuBars[0];
    var menuBarItems = menuBar.menuBarItems();

    for (var i = 0; i < menuBarItems.length; i++) {
        var menuBarItem = menuBarItems[i];
        var level1Name;
        try {
            level1Name = menuBarItem.name();
        } catch (e) {
            continue;
        }

        // Skip Apple menu ()
        if (level1Name === 'Apple' || level1Name === '') continue;

        try {
            var menu = menuBarItem.menus[0];
            MenuReader._scanMenu(menu, [level1Name], results, includeDisabled);
        } catch (e) {
            // Skip menus that can't be accessed
        }
    }

    return results;
};
