#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { translateText, clearTranslationCache, resetRateLimitState } = require('@iobroker/adapter-dev/build/translate');

const LANGS = ['es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
const MIN_WORDS = 1;
const DELAY_MS = 150;
/** Keys that may stay identical to English (product names). */
const SKIP_IDENTICAL = new Set([
    'modulePreset_opt_sw225poly',
    'modulePreset_opt_sw225mono',
    'pikoModel_opt_piko3.0',
    'pikoModel_opt_piko3.6',
    'pikoModel_opt_piko4.2',
    'pikoModel_opt_piko5.5',
    'pikoModel_opt_piko7.0',
    'pikoModel_opt_piko8.3',
    'pikoModel_opt_piko10.1',
]);

function countWords(text) {
    return String(text)
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateFile(en, existing, lang) {
    const out = { ...existing };

    for (const [key, value] of Object.entries(en)) {
        if (typeof value !== 'string' || !value.trim()) {
            continue;
        }
        if (SKIP_IDENTICAL.has(key)) {
            continue;
        }
        if (existing[key] && existing[key] !== value) {
            continue;
        }
        if (countWords(value) < MIN_WORDS) {
            continue;
        }

        try {
            out[key] = await translateText(value, lang, key);
        } catch (err) {
            console.warn(`[${lang}] ${key}: ${err.message}`);
        }
        await sleep(DELAY_MS);
    }

    return out;
}

async function main() {
    const i18nDir = path.join(__dirname, '..', 'admin', 'i18n');
    const en = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json'), 'utf8'));

    resetRateLimitState();
    clearTranslationCache();

    for (const lang of LANGS) {
        console.log(`Translating admin/i18n/${lang}.json ...`);
        const existing = JSON.parse(fs.readFileSync(path.join(i18nDir, `${lang}.json`), 'utf8'));
        const translated = await translateFile(en, existing, lang);
        const sorted = Object.fromEntries(Object.keys(translated).sort().map(k => [k, translated[k]]));
        fs.writeFileSync(path.join(i18nDir, `${lang}.json`), `${JSON.stringify(sorted, null, 2)}\n`);
        console.log(`  wrote admin/i18n/${lang}.json`);
    }

    console.log('Done.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
