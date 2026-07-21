#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LANGS = ['de', 'en', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

function withLangs(de, en) {
    const out = {};
    for (const lang of LANGS) {
        out[lang] = lang === 'de' ? de : en;
    }
    return out;
}

const pkgPath = path.join(__dirname, '..', 'io-package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const news = pkg.common.news || {};
const keepVersions = [
    '0.4.3', '0.5.0', '0.5.1', '0.5.2', '0.6.0', '0.6.1', '0.6.2', '0.6.3',
    '0.6.4', '0.6.5', '0.6.6', '0.6.7', '0.6.8', '0.6.10', '0.6.11', '0.6.12',
    '0.6.13', '0.6.14', '0.6.15',
];
const newNews = {};
for (const v of keepVersions) {
    if (!news[v]) continue;
    newNews[v] = withLangs(news[v].de, news[v].en);
}
newNews['0.6.16'] = withLangs(
    'Repo-Checker: Objektstruktur, CI-Tests, io-package-Schema, Adapter-Timer',
    'Repo checker: object structure, CI tests, io-package schema, adapter timers',
);
pkg.common.news = newNews;
pkg.common.version = '0.6.16';

pkg.common.titleLang = withLangs(
    'Kostal PIKO Wechselrichter',
    'Kostal PIKO Inverter',
);
pkg.common.desc = withLangs(
    'Liest Echtzeit- und Historiendaten vom Kostal PIKO Wechselrichter via HTTP-Scraping.',
    'Reads real-time and history data from Kostal PIKO inverters via HTTP scraping.',
);

pkg.common.extIcon = 'admin/kostal-piko-icon.svg';
pkg.common.compact = false;
pkg.common.licenseInformation = {
    type: 'free',
    license: 'GPL-3.0-only',
};
delete pkg.common.supportMessages;
pkg.common.supportedMessages = { custom: true };

const channels = [
    'info', 'ac', 'ac.l1', 'ac.l2', 'ac.l3', 'energy', 'pv', 'pv.string1', 'pv.string2',
    'pv.string3', 'device', 'string1', 'string2', 'string3', 'temperature', 'dc',
    'efficiency', 'weather', 'history', 'rs485',
];
const channelObjects = channels.map(id => ({
    _id: id,
    type: 'channel',
    common: { name: id },
    native: {},
}));
pkg.instanceObjects = [
    ...channelObjects,
    ...(pkg.instanceObjects || []).filter(o => o.type === 'state'),
];

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`io-package.json updated: ${Object.keys(newNews).length} news entries`);

const cfgPath = path.join(__dirname, '..', 'admin', 'jsonConfig.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.i18n = false;

function fixSizes(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        obj.forEach(fixSizes);
        return;
    }
    if (obj.sm !== undefined) {
        const sm = obj.sm;
        obj.xs = obj.xs ?? 12;
        obj.md = obj.md ?? sm;
        obj.lg = obj.lg ?? sm;
        obj.xl = obj.xl ?? sm;
    }
    Object.values(obj).forEach(fixSizes);
}
fixSizes(cfg.items);
fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
console.log('jsonConfig.json updated: i18n=false, responsive sizes');
