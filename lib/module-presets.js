'use strict';

/** Datenblatt-Werte – siehe docs/KonzeptPikoTemperatur.md */
const MODULE_PRESETS = {
    sw225poly: {
        name: 'Solarworld Sunmodule SW 225 poly',
        wp: 225,
        voc: 36.8,
        vmpp: 29.5,
        vmppNoct: 26.5,
        vocNoct: 33.1,
        isc: 8.17,
        impp: 7.63,
        imppNoct: 6.08,
        betaVmpp: 0.0045,
        betaPmax: 0.0048,
        betaVoc: 0.0034,
        betaIsc: 0.00034,
        noct: 46,
    },
    sw225mono: {
        name: 'Solarworld SW 225 mono',
        wp: 225,
        voc: 37.3,
        vmpp: 29.7,
        vmppNoct: 26.8,
        vocNoct: 33.5,
        isc: 8.1,
        impp: 7.63,
        imppNoct: 6.1,
        betaVmpp: 0.0043,
        betaPmax: 0.0043,
        betaVoc: 0.0033,
        betaIsc: 0.00034,
        noct: 45,
    },
};

function getModulePresetFields(presetId) {
    const preset = presetId ? MODULE_PRESETS[presetId] : null;
    if (!preset) {
        return null;
    }
    return {
        moduleWp: preset.wp,
        moduleVoc: preset.voc,
        moduleVmpp: preset.vmpp,
        modulePreset: presetId,
    };
}

module.exports = { MODULE_PRESETS, getModulePresetFields };
