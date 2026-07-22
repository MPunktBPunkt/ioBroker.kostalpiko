'use strict';

const { expect } = require('chai');
const { MODULE_PRESETS, getModulePresetFields } = require('../lib/module-presets');

describe('Module presets', () => {
    it('SW 225 poly matches datasheet STC values', () => {
        const p = MODULE_PRESETS.sw225poly;
        expect(p.wp).to.equal(225);
        expect(p.voc).to.equal(36.8);
        expect(p.vmpp).to.equal(29.5);
        expect(p.impp).to.equal(7.63);
        expect(p.noct).to.equal(46);
        expect(p.vmppNoct).to.equal(26.5);
        expect(p.betaPmax).to.equal(0.0048);
    });

    it('getModulePresetFields returns native config fields', () => {
        const fields = getModulePresetFields('sw225poly');
        expect(fields).to.deep.equal({
            moduleWp: 225,
            moduleVoc: 36.8,
            moduleVmpp: 29.5,
            modulePreset: 'sw225poly',
        });
    });
});
