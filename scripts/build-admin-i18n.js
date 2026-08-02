#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TRANSLATABLE = ['label', 'help', 'text', 'placeholder', 'title'];
const LANGS = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

/** English translations keyed like itemId_attr */
const EN = {
    _h1_text: 'Inverter connection',
    pikoModel_label: 'PIKO model',
    pikoModel_help: 'Inverter model – determines the number of PV strings',
    _h_network_text: 'Network access',
    networkMode_label: 'Network mode',
    networkMode_help:
        'Local: direct access on the same network. Via fritzwireguard: access through the FritzBox WireGuard tunnel (same IP, different network).',
    fritzwgInstance_label: 'fritzwireguard instance',
    fritzwgInstance_help: 'Name of the fritzwireguard adapter instance, e.g. fritzwireguard.0',
    fritzwgConnectedState_label: 'State ID: connection status',
    fritzwgConnectedState_help:
        'Optional ioBroker state indicating whether the WireGuard tunnel is active (boolean). Leave empty to use fritzwireguard.X.info.connection automatically.',
    fritzwgConnectedState_placeholder: 'e.g. fritzwireguard.0.info.connection',
    ip_label: 'Inverter IP address',
    ip_help: 'e.g. 192.168.178.30',
    port_label: 'HTTP port',
    port_help: 'Default: 80',
    _btnTest_label: 'Test connection',
    _h2_text: 'Authentication',
    user_label: 'Username',
    user_help: 'Default: pvserver',
    password_label: 'Password',
    password_help: 'HTTP Basic Auth password of the PIKO web server (default: pvwr)',
    _h3_text: 'Live polling',
    pollInterval_label: 'Poll interval (seconds)',
    pollInterval_help: 'How often live measurements are fetched from the inverter. Recommended: 30 seconds',
    _h4_text: 'History data & InfluxDB sync',
    _info4_text:
        "LogDaten.dat contains 15-minute series for the last ~6 months. The adapter downloads this file automatically at the interval below, calculates the actual timestamps and sends new data points to InfluxDB. Configure the InfluxDB connection (host, port, database, token) in ioBroker Admin under 'Adapters → InfluxDB' – not here.",
    historyFetch_label: 'Load history data (LogDaten.dat)',
    historyFetch_help: 'Loads ~6 months of measurement data from the PIKO and displays it in the web UI. InfluxDB not required.',
    influxSync_label: 'Also send to InfluxDB',
    influxSync_help: 'Additionally sends history data to InfluxDB for long-term analysis. Only useful if the InfluxDB adapter is installed.',
    syncInterval_label: 'Sync interval (minutes)',
    syncInterval_help: 'How often LogDaten.dat is fetched and new data points are sent to InfluxDB? Recommended: 15 (matches PIKO measurement interval)',
    influxInstance_label: 'InfluxDB adapter instance',
    influxInstance_help: 'Name of the installed InfluxDB instance in ioBroker. Connection settings (host, port, DB, token) are configured there.',
    _h5_text: 'Web interface',
    webPort_label: 'Web UI port',
    webPort_help: 'Port for the built-in dashboard (tabs: Data, History, Nodes, Logs, System). Default: 8092',
    _h6_text: 'Logging',
    _h_modules_text: 'PV module & temperature calculation',
    _info_modules_text:
        'For string analysis and Vmpp temperature: choose a module preset and enter modules per string (e.g. PIKO 5.5: 13+13, PIKO 8.3: 20+19). Without preset or module count there is no temperature display.',
    modulePreset_label: 'Module preset',
    modulePreset_help: 'Applies datasheet values (Wp, Voc, Vmpp, β, NOCT). Then only enter modules per string.',
    _preset_sw225poly_text: 'Automatic: 225 Wp · Voc 36.8 V · Vmpp 29.5 V · Impp 7.63 A · β 0.48 %/K · NOCT 46 °C · Vmpp@NOCT 26.5 V',
    _preset_sw225mono_text: 'Automatic: 225 Wp · Voc 37.3 V · Vmpp 29.7 V · Impp 7.63 A · β 0.43 %/K · NOCT 45 °C',
    btnApplyModulePreset_label: 'Apply preset values',
    moduleManualOverride_label: 'Override module values manually (expert)',
    moduleManualOverride_help: 'Default: preset takes precedence. Only enable if your module differs from the datasheet.',
    moduleNoctEff_label: 'Effective NOCT (°C, optional)',
    moduleNoctEff_help: '0 = datasheet NOCT (46 °C). PIKO 5.5 roof often ~34 °C, PIKO 8.3 often ~46–61 °C – for advanced plausibility only.',
    moduleWp_label: 'Module power (Wp)',
    moduleWp_help: 'Nominal power of one module, e.g. 225',
    moduleVoc_label: 'Open-circuit voltage Voc (V)',
    moduleVoc_help: 'Open-circuit voltage at STC (no load), e.g. 36.8',
    moduleVmpp_label: 'MPP voltage Vmpp (V)',
    moduleVmpp_help: 'Voltage at MPP at STC, e.g. 29.5 – empty = auto from Voc',
    string1Modules_label: 'String 1: number of modules',
    string1Modules_help: 'Modules in string 1 (e.g. 13 for PIKO 5.5, 20 for PIKO 8.3)',
    string2Modules_label: 'String 2: number of modules',
    string2Modules_help: 'Modules in string 2 (e.g. 13 for PIKO 5.5, 19 for PIKO 8.3)',
    string3Modules_label: 'String 3: number of modules (PIKO 5.5 only)',
    string3Modules_help: 'Number of modules in string 3 (PIKO 5.5 only)',
    _h_yields_text: 'Yield analysis (web UI tab "Yield")',
    _info_yields_text:
        'Monthly yields are stored in iobroker-data. Historical months can be entered manually in the web UI. Automatic months are calculated from LogDaten.dat (last ~6 months).',
    yieldFeedInTariff_label: 'Feed-in tariff (€/kWh)',
    yieldFeedInTariff_help: 'Tariff for € calculation, e.g. 0.3925 for 39.25 ct/kWh',
    yieldInstalledKwp_label: 'Installed capacity (kWp, 0=auto)',
    yieldInstalledKwp_help: '0 = calculated from module configuration (Wp × modules)',
    yieldPlz_label: 'Postal code (5 digits)',
    yieldPlz_help: 'For weather/sun expectation on the data tab and regional yield comparison (ertragsdatenbank.de)',
    verbose_label: 'Verbose logging (debug)',
    _h_notify_text: 'Notifications',
    _info_notify_text:
        'Reports by e-mail (HTML). Based on LogDaten.dat – "Load history data" must be enabled. SMTP credentials are configured in the ioBroker e-mail adapter, not here.',
    notifyEnabled_label: 'Enable notifications',
    reportLabel_label: 'Report label (subject)',
    reportLabel_help: 'Optional name for e-mail subjects, e.g. "Small" or "Large". Empty = instance title from ioBroker.',
    reportLabel_placeholder: 'e.g. Small',
    notifyInstanceEmail_label: 'E-mail instance',
    notifyInstanceEmail_help: 'Name of the ioBroker e-mail adapter instance, e.g. email.0',
    notifyRecipient_label: 'Recipient (primary address)',
    notifyRecipient_help:
        'One or more e-mail addresses, comma-separated. Used for daily report and alert; weekly/monthly report additionally to optional extra recipients.',
    notifyRecipient_placeholder: 'e.g. user@example.com or user@a.com, partner@b.com',
    notifyRecipientWeekly_label: 'Additional recipients weekly report',
    notifyRecipientWeekly_help: 'Optional – comma-separated e-mail addresses, in addition to the primary address',
    notifyRecipientWeekly_placeholder: 'e.g. partner@example.com',
    notifyRecipientMonthly_label: 'Additional recipients monthly report',
    notifyRecipientMonthly_help: 'Optional – comma-separated e-mail addresses, in addition to the primary address',
    notifyRecipientMonthly_placeholder: 'e.g. accounting@example.com',
    _h_notify_daily_text: 'Daily report',
    notifyDaily_label: 'Enable daily report',
    notifyDaily_help: 'Daily report with power curve of the previous day',
    notifyDailyTime_label: 'Time (HH:MM)',
    _h_notify_weekly_text: 'Weekly report',
    notifyWeekly_label: 'Enable weekly report',
    notifyWeekly_help: 'Every Monday: daily yields of the previous week',
    notifyWeeklyTime_label: 'Time (HH:MM)',
    _h_notify_monthly_text: 'Monthly report',
    notifyMonthly_label: 'Enable monthly report',
    notifyMonthly_help: 'On the 1st of the month: all daily yields of the previous month',
    notifyMonthlyTime_label: 'Time (HH:MM)',
    _h_notify_alert_text: 'Alert',
    notifyAlert_label: 'Enable alert',
    notifyAlert_help: 'Notification if previous day has no data or is below threshold',
    notifyAlertTime_label: 'Time (HH:MM)',
    notifyThresholdKwh_label: 'Threshold (kWh, 0=disabled)',
    notifyThresholdKwh_help: 'Alert if daily yield is below this value',
    _h_notify_test_text: 'Test reports (preview by e-mail)',
    _info_notify_test_text:
        'Sends a test report immediately to configured recipients – subject with [TEST]. HTML layout in DIN A4 format with curves (day), bar chart (week) or table (month).',
    _btnTestDaily_label: 'Send test daily report',
    _btnTestWeekly_label: 'Send test weekly report',
    _btnTestMonthly_label: 'Send test monthly report',
};

function collectEntries(node, itemId = '', state = { insideSelectOptions: false }) {
    const results = [];
    if (!node || typeof node !== 'object') {
        return results;
    }
    if (Array.isArray(node)) {
        node.forEach(item => results.push(...collectEntries(item, itemId, state)));
        return results;
    }

    const nodeType = typeof node.type === 'string' ? node.type : '';
    const isSelect = nodeType.startsWith('select');

    for (const [key, value] of Object.entries(node)) {
        if (key === 'items' && typeof value === 'object') {
            for (const [id, child] of Object.entries(value)) {
                results.push(...collectEntries(child, id, state));
            }
            continue;
        }
        if (TRANSLATABLE.includes(key) && typeof value === 'string') {
            if (state.insideSelectOptions && key === 'label') {
                continue;
            }
            results.push({ key: `${itemId}_${key}`, itemId, attr: key, de: value });
        }
        const childState = key === 'options' && isSelect ? { ...state, insideSelectOptions: true } : state;
        if (typeof value === 'object' && value && !Array.isArray(value) && key !== 'items') {
            results.push(...collectEntries(value, itemId, childState));
        } else if (Array.isArray(value)) {
            value.forEach(item => {
                if (typeof item === 'object' && item) {
                    results.push(...collectEntries(item, itemId, childState));
                }
            });
        }
    }
    return results;
}

function applyKeys(node, itemId = '', state = { insideSelectOptions: false }, keyMap) {
    if (!node || typeof node !== 'object') {
        return;
    }
    if (Array.isArray(node)) {
        node.forEach(item => applyKeys(item, itemId, state, keyMap));
        return;
    }

    const nodeType = typeof node.type === 'string' ? node.type : '';
    const isSelect = nodeType.startsWith('select');

    for (const [key, value] of Object.entries(node)) {
        if (key === 'items' && typeof value === 'object') {
            for (const [id, child] of Object.entries(value)) {
                applyKeys(child, id, state, keyMap);
            }
            continue;
        }
        if (TRANSLATABLE.includes(key) && typeof value === 'string') {
            if (!(state.insideSelectOptions && key === 'label')) {
                const mapKey = `${itemId}_${key}`;
                if (keyMap.has(mapKey)) {
                    node[key] = mapKey;
                }
            }
        }
        const childState = key === 'options' && isSelect ? { ...state, insideSelectOptions: true } : state;
        if (typeof value === 'object' && value && !Array.isArray(value) && key !== 'items') {
            applyKeys(value, itemId, childState, keyMap);
        } else if (Array.isArray(value)) {
            value.forEach(item => {
                if (typeof item === 'object' && item) {
                    applyKeys(item, itemId, childState, keyMap);
                }
            });
        }
    }
}

const root = path.join(__dirname, '..');
const configPath = path.join(root, 'admin', 'jsonConfig.json');
const jsonConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const entries = collectEntries(jsonConfig);
const de = {};
const en = {};

for (const entry of entries) {
    de[entry.key] = entry.de;
    if (!EN[entry.key]) {
        throw new Error(`Missing English translation for ${entry.key}`);
    }
    en[entry.key] = EN[entry.key];
}

const i18nDir = path.join(root, 'admin', 'i18n');
fs.mkdirSync(i18nDir, { recursive: true });

for (const lang of LANGS) {
    const translations = lang === 'de' ? de : en;
    fs.writeFileSync(path.join(i18nDir, `${lang}.json`), `${JSON.stringify(translations, null, 2)}\n`);
}

const keyMap = new Set(entries.map(e => e.key));
applyKeys(jsonConfig, '', { insideSelectOptions: false }, keyMap);
jsonConfig.i18n = true;

fs.writeFileSync(configPath, `${JSON.stringify(jsonConfig, null, 2)}\n`);
console.log(`Migrated ${entries.length} strings to admin/i18n/*.json`);
