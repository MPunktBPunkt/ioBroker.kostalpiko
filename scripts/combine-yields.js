#!/usr/bin/env node
'use strict';

/**
 * Monatserträge aus history-cache.json (und optional monthly-yields.json) berechnen
 * und für mehrere PIKO-Instanzen zu einer Tabelle zusammenführen.
 *
 * Auf dem ioBroker-Server ausführen, z. B.:
 *   node /opt/iobroker/node_modules/iobroker.kostalpiko/scripts/combine-yields.js \
 *     /opt/iobroker/iobroker-data kostalpiko.0 kostalpiko.1 --from 2018-05
 *
 * Ausgabe: Markdown-Tabelle auf stdout, optional --csv datei.csv
 */

const fs = require('fs');
const path = require('path');

const MONTH_NAMES = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function parseArgs(argv) {
    const args = {
        dataRoot : null,
        instances: [],
        fromYear : 2018,
        fromMonth: 5,
        csv      : null,
        tariff   : 0.3925,
    };
    const positional = [];
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--from' && argv[i + 1]) {
            const m = /^(\d{4})-(\d{2})$/.exec(argv[++i]);
            if (m) {
                args.fromYear = parseInt(m[1]);
                args.fromMonth = parseInt(m[2]);
            }
        } else if (a === '--csv' && argv[i + 1]) {
            args.csv = argv[++i];
        } else if (a === '--tariff' && argv[i + 1]) {
            args.tariff = parseFloat(argv[++i].replace(',', '.'));
        } else if (!a.startsWith('-')) {
            positional.push(a);
        }
    }
    if (positional.length < 2) {
        console.error('Verwendung: node combine-yields.js <iobroker-data> <instanz> [instanz2 ...] [--from 2018-05] [--csv out.csv]');
        process.exit(1);
    }
    args.dataRoot = positional[0];
    args.instances = positional.slice(1);
    return args;
}

function monthKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function calcDailyKwh(rows) {
    if (!rows.length) return 0;
    const sorted = [...rows].sort((a, b) => a.ts - b.ts);
    const withEnergy = sorted.filter(r => r.totalEnergy > 0);
    if (withEnergy.length >= 2) {
        const delta = withEnergy[withEnergy.length - 1].totalEnergy - withEnergy[0].totalEnergy;
        if (delta > 0 && delta < 500) return Math.round(delta * 100) / 100;
    }
    const totalWh = sorted.reduce((sum, r) => sum + (r.acTotalPower || 0) * 0.25, 0);
    return Math.round(totalWh) / 1000;
}

function calcMonthWh(rows, year, month) {
    const monthRows = rows.filter(r => {
        const d = new Date(r.ts || r.date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
    if (!monthRows.length) return 0;
    const byDay = {};
    monthRows.forEach(r => {
        const day = (r.date || new Date(r.ts).toISOString()).substring(0, 10);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(r);
    });
    let totalKwh = 0;
    Object.values(byDay).forEach(dayRows => {
        totalKwh += calcDailyKwh(dayRows);
    });
    return Math.round(totalKwh * 1000);
}

function loadJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (_) {
        return null;
    }
}

function loadHistoryRows(instanceDir) {
    for (const file of ['history-cache.json', 'history-cache.json.bak']) {
        const data = loadJson(path.join(instanceDir, file));
        if (data?.rows?.length) {
            return { rows: data.rows, file, count: data.rows.length };
        }
    }
    return { rows: [], file: null, count: 0 };
}

function loadManualMonths(instanceDir) {
    for (const file of ['monthly-yields.json', 'monthly-yields.json.bak']) {
        const data = loadJson(path.join(instanceDir, file));
        if (data?.months && Object.keys(data.months).length) {
            return { months: data.months, file, tariff: data.feedInTariff };
        }
    }
    return { months: {}, file: null, tariff: null };
}

function buildInstanceData(instanceDir, fromYear, fromMonth) {
    const hist = loadHistoryRows(instanceDir);
    const manual = loadManualMonths(instanceDir);
    const months = {};
    const sorted = [...hist.rows].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const historyFrom = sorted.length
        ? (sorted[0].date || new Date(sorted[0].ts).toISOString()).substring(0, 10)
        : null;
    const historyTo = sorted.length
        ? (sorted[sorted.length - 1].date || new Date(sorted[sorted.length - 1].ts).toISOString()).substring(0, 10)
        : null;

    const cy = new Date().getFullYear();
    const cm = new Date().getMonth() + 1;
    for (let y = fromYear; y <= cy; y++) {
        const mStart = y === fromYear ? fromMonth : 1;
        const mEnd = y === cy ? cm : 12;
        for (let m = mStart; m <= mEnd; m++) {
            const key = monthKey(y, m);
            const man = manual.months[key];
            if (man?.wh > 0 && man.source === 'manual') {
                months[key] = { wh: man.wh, source: 'manual' };
                continue;
            }
            const wh = calcMonthWh(hist.rows, y, m);
            if (wh > 0) months[key] = { wh, source: 'auto' };
            else if (man?.wh > 0) months[key] = { wh: man.wh, source: man.source || 'import' };
        }
    }

    return {
        historyFrom,
        historyTo,
        historyFile: hist.file,
        historyCount: hist.count,
        yieldsFile  : manual.file,
        months,
    };
}

function fmtWh(wh) {
    if (!wh) return '–';
    if (wh >= 1e6) return (wh / 1e6).toFixed(2).replace('.', ',') + ' M';
    return Math.round(wh).toLocaleString('de-DE');
}

function fmtMwh(wh) {
    if (!wh) return '–';
    return (wh / 1e6).toFixed(3).replace('.', ',');
}

function printMarkdown(instances, dataByInst, years, tariff) {
    console.log('# Monatserträge kombiniert\n');
    instances.forEach(inst => {
        const d = dataByInst[inst];
        console.log(`- **${inst}**: History ${d.historyFrom || '–'} – ${d.historyTo || '–'} ` +
            `(${d.historyCount} Punkte${d.historyFile ? ', ' + d.historyFile : ''})` +
            (d.yieldsFile ? `, Ertrag-Datei: ${d.yieldsFile}` : ''));
    });
    console.log('');

    const header = ['Monat'];
    instances.forEach(inst => years.forEach(y => header.push(`${inst} ${y}`)));
    years.forEach(y => header.push(`Σ ${y}`));
    console.log('| ' + header.join(' | ') + ' |');
    console.log('|' + header.map(() => '---').join('|') + '|');

    for (let m = 1; m <= 12; m++) {
        const row = [MONTH_NAMES[m - 1]];
        years.forEach(y => {
            instances.forEach(inst => {
                const wh = dataByInst[inst].months[monthKey(y, m)]?.wh || 0;
                row.push(fmtMwh(wh));
            });
            let sum = 0;
            instances.forEach(inst => {
                sum += dataByInst[inst].months[monthKey(y, m)]?.wh || 0;
            });
            row.push(fmtMwh(sum));
        });
        console.log('| ' + row.join(' | ') + ' |');
    }

    const sumRow = ['**Σ Jahr [MWh]**'];
    years.forEach(y => {
        instances.forEach(inst => {
            let s = 0;
            for (let m = 1; m <= 12; m++) s += dataByInst[inst].months[monthKey(y, m)]?.wh || 0;
            sumRow.push('**' + fmtMwh(s) + '**');
        });
        let total = 0;
        instances.forEach(inst => {
            for (let m = 1; m <= 12; m++) total += dataByInst[inst].months[monthKey(y, m)]?.wh || 0;
        });
        sumRow.push('**' + fmtMwh(total) + '**');
    });
    console.log('| ' + sumRow.join(' | ') + ' |');

    const eurRow = ['**€ / Jahr**'];
    years.forEach(y => {
        instances.forEach(inst => {
            let s = 0;
            for (let m = 1; m <= 12; m++) s += dataByInst[inst].months[monthKey(y, m)]?.wh || 0;
            eurRow.push((s / 1000 * tariff).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
        });
        let total = 0;
        instances.forEach(inst => {
            for (let m = 1; m <= 12; m++) total += dataByInst[inst].months[monthKey(y, m)]?.wh || 0;
        });
        eurRow.push((total / 1000 * tariff).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
    });
    console.log('| ' + eurRow.join(' | ') + ' |');
    console.log(`\n_Vergütung: ${tariff} €/kWh · Werte in MWh_`);
}

function writeCsv(file, instances, dataByInst, years) {
    const lines = [];
    const header = ['Monat'];
    instances.forEach(inst => years.forEach(y => header.push(`${inst}_${y}_Wh`)));
    years.forEach(y => header.push(`Summe_${y}_Wh`));
    lines.push(header.join(';'));

    for (let m = 1; m <= 12; m++) {
        const row = [MONTH_NAMES[m - 1]];
        years.forEach(y => {
            instances.forEach(inst => {
                row.push(String(dataByInst[inst].months[monthKey(y, m)]?.wh || ''));
            });
            let sum = 0;
            instances.forEach(inst => { sum += dataByInst[inst].months[monthKey(y, m)]?.wh || 0; });
            row.push(String(sum || ''));
        });
        lines.push(row.join(';'));
    }
    fs.writeFileSync(file, '\uFEFF' + lines.join('\n'), 'utf-8');
    console.error(`CSV geschrieben: ${file}`);
}

function main() {
    const args = parseArgs(process.argv);
    const dataByInst = {};
    for (const inst of args.instances) {
        const dir = path.join(args.dataRoot, inst);
        if (!fs.existsSync(dir)) {
            console.error(`Ordner nicht gefunden: ${dir}`);
            process.exit(1);
        }
        dataByInst[inst] = buildInstanceData(dir, args.fromYear, args.fromMonth);
    }

    const cy = new Date().getFullYear();
    const years = [];
    for (let y = args.fromYear; y <= cy; y++) years.push(y);

    printMarkdown(args.instances, dataByInst, years, args.tariff);
    if (args.csv) writeCsv(args.csv, args.instances, dataByInst, years);
}

main();
