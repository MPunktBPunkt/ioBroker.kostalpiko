#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { translateText, clearTranslationCache, resetRateLimitState } = require('@iobroker/adapter-dev/build/translate');

const LANGS = ['es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
const MIN_WORDS = 5;
const DELAY_MS = 150;

function countWords(text) {
    return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateFile(en, lang) {
    const out = { ...en };

    for (const [key, value] of Object.entries(en)) {
        if (typeof value !== 'string' || !value.trim()) {
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
        const translated = await translateFile(en, lang);
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
