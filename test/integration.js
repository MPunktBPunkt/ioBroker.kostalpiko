'use strict';

process.env.TZ = 'UTC';

const path = require('node:path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');

async function waitForObject(harness, relativeId, timeoutMs = 15000) {
    const id = `${harness.adapterName}.0.${relativeId}`;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const obj = await harness.objects.getObjectAsync(id);
            if (obj) return obj;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`Object not found: ${id}`);
}

tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [0],
    defineAdditionalTests({ suite }) {
        suite('Object structure', (getHarness) => {
            let harness;

            before(async () => {
                harness = getHarness();
                await harness.changeAdapterConfig(harness.adapterName, {
                    native: {
                        modulePreset: 'sw225poly',
                        string1Modules: 13,
                        string2Modules: 13,
                    },
                });
                await harness.startAdapterAndWait();
            });

            it('creates info channel and connection state', async () => {
                const info = await waitForObject(harness, 'info');
                const conn = await waitForObject(harness, 'info.connection');
                expect(info.type).to.equal('channel');
                expect(conn.common.type).to.equal('boolean');
                expect(conn.common.role).to.equal('indicator.connected');
            });

            it('creates AC channel hierarchy and power state', async () => {
                const ac = await waitForObject(harness, 'ac');
                await waitForObject(harness, 'ac.l1');
                const power = await waitForObject(harness, 'ac.power');
                expect(ac.type).to.equal('channel');
                expect(power.common.type).to.equal('number');
                expect(power.common.role).to.equal('value.power.active');
            });

            it('creates weather channel and precipitation state', async () => {
                await waitForObject(harness, 'weather');
                const precip = await waitForObject(harness, 'weather.precipitation');
                expect(precip.common.type).to.equal('number');
                expect(precip.common.read).to.equal(true);
                expect(precip.common.write).to.equal(false);
            });

            it('creates history meta states', async () => {
                await waitForObject(harness, 'history');
                await waitForObject(harness, 'history.recordCount');
            });

            it('creates temperature states when module preset is configured', async () => {
                await waitForObject(harness, 'string1');
                const temp = await waitForObject(harness, 'string1.tempEquivalentC');
                expect(temp.common.type).to.equal('number');
                expect(temp.common.role).to.equal('value.temperature');
            });
        });
    },
});
