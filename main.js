'use strict';

/**
 * ioBroker Kostal PIKO Adapter
 * Liest Echtzeit- und Historiendaten vom Kostal PIKO Wechselrichter via HTTP-Scraping
 * Version: 0.6.3
 */

const utils = require('@iobroker/adapter-core');
const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const url   = require('url');

// ─── Konstanten ────────────────────────────────────────────────────────────────
const ADAPTER_NAME    = 'kostalpiko';
const ADAPTER_VERSION = '0.6.3';

const POLL_URLS = {
    main : '/index.fhtml',
    info : '/Inf.fhtml',
    log  : '/LogDaten.dat',
};

// Spaltenindizes für LogDaten.dat (Tab-separiert)
const COL = {
    ZEIT:0, DC1_U:1,DC1_I:2,DC1_P:3,DC1_T:4,DC1_S:5,
    DC2_U:6,DC2_I:7,DC2_P:8,DC2_T:9,DC2_S:10,
    DC3_U:11,DC3_I:12,DC3_P:13,DC3_T:14,DC3_S:15,
    AC1_U:16,AC1_I:17,AC1_P:18,AC1_T:19,
    AC2_U:20,AC2_I:21,AC2_P:22,AC2_T:23,
    AC3_U:24,AC3_I:25,AC3_P:26,AC3_T:27,
    AC_F:28,FC_I:29,
    AIN1:30,AIN2:31,AIN3:32,AIN4:33,
    AC_S:34,ERR:35,ENS_S:36,ENS_ERR:37,KB_S:38,
    TOTAL_E:39,ISO_R:40,
};

// History-States für InfluxDB (erhalten historische ts-Werte beim setState)
const HISTORY_STATES = [
    { id:'history.dc1.voltage',   col:COL.DC1_U,  factor:1,     unit:'V',  name:'String 1 Spannung (15-min)' },
    { id:'history.dc1.current',   col:COL.DC1_I,  factor:0.001, unit:'A',  name:'String 1 Strom (15-min)' },
    { id:'history.dc1.power',     col:COL.DC1_P,  factor:1,     unit:'W',  name:'String 1 Leistung (15-min)' },
    { id:'history.dc2.voltage',   col:COL.DC2_U,  factor:1,     unit:'V',  name:'String 2 Spannung (15-min)' },
    { id:'history.dc2.current',   col:COL.DC2_I,  factor:0.001, unit:'A',  name:'String 2 Strom (15-min)' },
    { id:'history.dc2.power',     col:COL.DC2_P,  factor:1,     unit:'W',  name:'String 2 Leistung (15-min)' },
    { id:'history.dc3.voltage',   col:COL.DC3_U,  factor:1,     unit:'V',  name:'String 3 Spannung (15-min)' },
    { id:'history.dc3.current',   col:COL.DC3_I,  factor:0.001, unit:'A',  name:'String 3 Strom (15-min)' },
    { id:'history.dc3.power',     col:COL.DC3_P,  factor:1,     unit:'W',  name:'String 3 Leistung (15-min)' },
    { id:'history.ac1.voltage',   col:COL.AC1_U,  factor:1,     unit:'V',  name:'L1 Spannung (15-min)' },
    { id:'history.ac1.current',   col:COL.AC1_I,  factor:0.001, unit:'A',  name:'L1 Strom (15-min)' },
    { id:'history.ac1.power',     col:COL.AC1_P,  factor:1,     unit:'W',  name:'L1 Leistung (15-min)' },
    { id:'history.ac2.voltage',   col:COL.AC2_U,  factor:1,     unit:'V',  name:'L2 Spannung (15-min)' },
    { id:'history.ac2.current',   col:COL.AC2_I,  factor:0.001, unit:'A',  name:'L2 Strom (15-min)' },
    { id:'history.ac2.power',     col:COL.AC2_P,  factor:1,     unit:'W',  name:'L2 Leistung (15-min)' },
    { id:'history.ac3.voltage',   col:COL.AC3_U,  factor:1,     unit:'V',  name:'L3 Spannung (15-min)' },
    { id:'history.ac3.current',   col:COL.AC3_I,  factor:0.001, unit:'A',  name:'L3 Strom (15-min)' },
    { id:'history.ac3.power',     col:COL.AC3_P,  factor:1,     unit:'W',  name:'L3 Leistung (15-min)' },
    { id:'history.ac.totalPower', col:null,        factor:1,     unit:'W',  name:'AC Gesamtleistung (15-min)' },
    { id:'history.dc.totalPower', col:null,        factor:1,     unit:'W',  name:'DC Gesamtleistung (15-min)' },
    { id:'history.efficiency.ratio', col:null,     factor:1,     unit:'%',  name:'Wirkungsgrad DC\u2192AC (15-min)' },
    { id:'history.ac.frequency',  col:COL.AC_F,   factor:1,     unit:'Hz', name:'Netzfrequenz (15-min)' },
    { id:'history.acStatus',      col:COL.AC_S,   factor:1,     unit:'',   name:'Betriebsstatus-Code (15-min)' },
    { id:'history.errorCode',     col:COL.ERR,    factor:1,     unit:'',   name:'Fehlercode (15-min)' },
    { id:'history.energy.total',  col:COL.TOTAL_E, factor:1,    unit:'kWh', name:'Gesamtenergie-Z\u00e4hler (15-min)' },
];

// Live-States die bei aktiviertem InfluxDB-Sync mitgeschrieben werden
const LIVE_INFLUX_STATES = [
    'ac.power', 'energy.today', 'energy.total',
    'ac.l1.voltage', 'ac.l1.power', 'ac.l2.voltage', 'ac.l2.power', 'ac.l3.voltage', 'ac.l3.power',
    'pv.string1.voltage', 'pv.string1.current',
    'pv.string2.voltage', 'pv.string2.current',
    'pv.string3.voltage', 'pv.string3.current',
    'dc.totalPower', 'efficiency.ratio', 'efficiency.expected',
    'weather.sunshineHours', 'weather.tempMax', 'weather.cloudCover', 'weather.precipitation',
];

// Typische Modul-Vorlagen (Solarworld 225 Wp, ~2010)
const MODULE_PRESETS = {
    sw225poly: {
        name    : 'Solarworld Sunmodule Plus 225 poly',
        wp      : 225,
        voc     : 36.8,
        vmpp    : 29.5,
        vmppNoct: 26.5,
        impp    : 7.63,
    },
    sw225mono: {
        name    : 'Solarworld SW 225 mono',
        wp      : 225,
        voc     : 37.3,
        vmpp    : 29.7,
        vmppNoct: 26.8,
        impp    : 7.63,
    },
};
const VMPP_VOC_RATIO = 29.5 / 36.8; // typisch poly 225 Wp

// Kostal PIKO Grenzwerte laut Datenblatt (PIKO 4.2–10.1)
const PIKO_SPECS = {
    'piko3.0' : { name:'PIKO 3.0',  strings:1, dcMaxV:950, dcMinV:180, dcMaxA:9,    mppMin2:500, mppMax:850, udcNom:680, pacNom:3000  },
    'piko3.6' : { name:'PIKO 3.6',  strings:2, dcMaxV:950, dcMinV:180, dcMaxA:9,    mppMin2:360, mppMax:850, udcNom:680, pacNom:3600  },
    'piko4.2' : { name:'PIKO 4.2',  strings:2, dcMaxV:950, dcMinV:180, dcMaxA:9,    mppMin2:360, mppMax:850, udcNom:680, pacNom:4200  },
    'piko5.5' : { name:'PIKO 5.5',  strings:3, dcMaxV:950, dcMinV:180, dcMaxA:9,    mppMin1:660, mppMin2:360, mppMax:850, udcNom:680, pacNom:5500  },
    'piko7.0' : { name:'PIKO 7.0',  strings:2, dcMaxV:950, dcMinV:180, dcMaxA:12.5, mppMin2:400, mppMax:850, udcNom:680, pacNom:7000  },
    'piko8.3' : { name:'PIKO 8.3',  strings:2, dcMaxV:950, dcMinV:180, dcMaxA:12.5, mppMin2:400, mppMax:850, udcNom:680, pacNom:8300  },
    'piko10.1': { name:'PIKO 10.1', strings:3, dcMaxV:950, dcMinV:180, dcMaxA:12.5, mppMin2:420, mppMax:850, udcNom:680, pacNom:10000 },
};
const GRID_LIMITS_DE = { acMaxV:264.5, acMinV:184, fMax:51.5, fMin:47.5 };

// ─── Adapter-Klasse ────────────────────────────────────────────────────────────
class KostalPikoAdapter extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: ADAPTER_NAME });
        this._pollTimer       = null;
        this._webServer       = null;
        this._logBuffer       = [];
        this._maxLogs         = 500;
        this._lastData        = {};
        this._lastHistoryRows = [];
        this._lastNotifySent  = '';    // verhindert doppeltes Senden
        this._nodes           = {};
        this._pikoEpoch       = null;  // Unix-Sekunden (Geräteinbetriebnahme)
        this._lastImportedTs  = 0;     // ms - zuletzt importierter Timestamp
        this._lastImportIso   = null;  // ISO-Zeitpunkt des letzten History-Imports
        this._lastHistoryFetch= 0;
        this._historyCachePath = null;
        this._yieldsCachePath  = null;
        this._monthlyYields    = null;
        this._lastWeather        = null;
        this._lastWeatherFetch   = 0;
        this._weatherGeoCache    = null;

        this.on('ready',       this._onReady.bind(this));
        this.on('stateChange', this._onStateChange.bind(this));
        this.on('unload',      this._onUnload.bind(this));
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────────

    async _onReady() {
        this._log('SYSTEM', `Kostal PIKO Adapter v${ADAPTER_VERSION} gestartet`);

        this._cfg = {
            ip                   : (this.config.ip                   || '192.168.178.30').trim(),
            port                 : parseInt(this.config.port)                  || 80,
            user                 : (this.config.user                 || 'pvserver').trim(),
            password             : (this.config.password             || 'pvwr').trim(),
            pollInterval         : parseInt(this.config.pollInterval)          || 30,
            webPort              : parseInt(this.config.webPort)               || 8092,
            verbose              : !!this.config.verbose,
            historyFetch         : !!this.config.historyFetch,
            influxSync           : !!this.config.influxSync,   // InfluxDB-Sync separat
            syncInterval         : parseInt(this.config.syncInterval || this.config.historyInterval) || 15,
            influxInstance       : (this.config.influxInstance       || 'influxdb.0').trim(),
            // influxEnable = nur wenn BEIDE aktiviert sind
            influxEnable         : !!this.config.historyFetch && !!this.config.influxSync,
            // Netzwerk-Modus: 'local' = direkt, 'fritzwireguard' = via WireGuard-Tunnel
            networkMode          : (this.config.networkMode          || 'local').trim(),
            fritzwgInstance      : (this.config.fritzwgInstance      || 'fritzwireguard.0').trim(),
            // State-ID des Verbindungsstatus im fritzwireguard-Adapter
            // Typisch: fritzwireguard.0.info.connection oder fritzwireguard.0.connected
            fritzwgConnectedState: (this.config.fritzwgConnectedState || '').trim(),
            // Modell-Override: 'auto' = aus HTML lesen, sonst z.B. 'piko5.5'
            pikoModel      : (this.config.pikoModel || 'auto').trim(),
            // Benachrichtigungen
            notifyEnabled      : !!this.config.notifyEnabled,
            notifyAdapter      : (this.config.notifyAdapter   || 'email').trim(),
            // Instanz je nach gewähltem Adapter (Fallback auf altes notifyInstance-Feld)
            notifyInstance     : (() => {
                const adp = (this.config.notifyAdapter || 'email').trim();
                const legacy = (this.config.notifyInstance || '').trim();
                if (adp === 'telegram') return (this.config.notifyInstanceTelegram || legacy || 'telegram.0').trim();
                if (adp === 'pushover') return (this.config.notifyInstancePushover || legacy || 'pushover.0').trim();
                return (this.config.notifyInstanceEmail || legacy || 'email.0').trim();
            })(),
            notifyRecipient    : (this.config.notifyRecipient || '').trim(),
            notifyDaily        : !!this.config.notifyDaily,
            notifyDailyTime    : (this.config.notifyDailyTime  || '07:00').trim(),
            notifyWeekly       : !!this.config.notifyWeekly,
            notifyWeeklyTime   : (this.config.notifyWeeklyTime || '07:00').trim(),
            notifyMonthly      : !!this.config.notifyMonthly,
            notifyMonthlyTime  : (this.config.notifyMonthlyTime|| '07:00').trim(),
            notifyAlert        : !!this.config.notifyAlert,
            notifyAlertTime    : (this.config.notifyAlertTime  || '07:00').trim(),
            notifyThresholdKwh : parseFloat(this.config.notifyThresholdKwh) || 0,
            // Modul-Konfiguration (optional, für String-Analyse)
            moduleWp       : parseFloat(this.config.moduleWp)       || 0,
            moduleVoc      : parseFloat(this.config.moduleVoc)      || 0,
            moduleVmpp     : parseFloat(this.config.moduleVmpp)     || 0,
            modulePreset   : (this.config.modulePreset || '').trim(),
            string1Modules : parseInt(this.config.string1Modules)   || 0,
            string2Modules : parseInt(this.config.string2Modules)   || 0,
            string3Modules : parseInt(this.config.string3Modules)   || 0,
            yieldFeedInTariff: parseFloat(this.config.yieldFeedInTariff) || 0.3925,
            yieldInstalledKwp: parseFloat(this.config.yieldInstalledKwp) || 0,
            yieldPlz         : (() => {
                const plz = String(this.config.yieldPlz || '').trim();
                const legacy = String(this.config.yieldPlzRegion || '').trim();
                if (/^\d{5}$/.test(plz)) return plz;
                if (/^\d{5}$/.test(legacy)) return legacy;
                return plz || legacy || '87781';
            })(),
        };

        const networkInfo = this._cfg.networkMode === 'fritzwireguard'
            ? `Via ${this._cfg.fritzwgInstance} (WireGuard)`
            : 'Lokal (direkter Zugriff)';
        this._log('SYSTEM', `Auth: user=${this._cfg.user}, password=${this._cfg.password ? 'gesetzt' : 'LEER!'}`);
        this._log('SYSTEM',
            `Ziel: http://${this._cfg.ip}:${this._cfg.port} | ` +
            `Netzwerk: ${networkInfo} | ` +
            `Poll: ${this._cfg.pollInterval}s | ` +
            `Sync: ${this._cfg.historyFetch ? 'alle ' + this._cfg.syncInterval + ' min' + (this._cfg.influxEnable ? ' → ' + this._cfg.influxInstance : ' (nur Web-UI, kein InfluxDB)') : 'deaktiviert'}`
        );

        await this._ensureBaseStates();
        await this._ensureHistoryStates();
        this._historyCachePath = this._getHistoryCachePath();
        this._yieldsCachePath  = this._getYieldsCachePath();
        await this._loadHistoryCache();
        await this._loadMonthlyYields();

        // Letzten importierten Timestamp aus State laden
        try {
            const st = await this.getStateAsync('history.lastImportedTs');
            if (st && st.val) {
                this._lastImportedTs = parseInt(st.val) || 0;
                this._log('INFO', `History-Cursor: ${new Date(this._lastImportedTs).toISOString()}`);
            }
            const stLi = await this.getStateAsync('history.lastImport');
            if (stLi && stLi.val) this._lastImportIso = stLi.val;
        } catch (_) {}

        this._startWebServer();

        await this._poll();
        this._pollTimer = setInterval(() => this._poll(), this._cfg.pollInterval * 1000);
        this._refreshWeather().catch(e => this._log('DEBUG', `Wetter: ${e.message}`));

        // Nach Neustart sofort Historie vom PIKO nachladen (Cache zeigt bis dahin alte Daten)
        if (this._cfg.historyFetch) {
            this._lastHistoryFetch = 0;
            setTimeout(() => {
                this._fetchAndImportHistory(false).catch(e =>
                    this._log('WARN', `Startup History-Fetch: ${e.message}`)
                );
            }, 5000);
        }

        // Benachrichtigungs-Timer
        if (this._cfg.notifyEnabled) {
            if (!this._cfg.historyFetch) {
                this._log('WARN', 'Benachrichtigungen aktiv, aber Historiendaten laden ist deaktiviert – Berichte haben keine Daten');
            }
            this._startNotifyTimer();
        }
    }

    _onStateChange(id, state) {
        if (state && !state.ack && this._cfg.verbose) {
            this._log('DEBUG', `State geändert: ${id} = ${state.val}`);
        }
    }

    // ─── Admin-Nachrichten (Verbindungstest) ────────────────────────────────────

    _onMessage(obj) {
        if (!obj || obj.command !== 'test') return;
        const { ip, port, user, password } = obj.message || {};
        const testIp   = (ip   || this._cfg.ip).trim();
        const testPort = parseInt(port) || this._cfg.port;
        const testUser = (user || this._cfg.user).trim();
        const testPass = (password || this._cfg.password).trim();

        const http = require('http');
        const auth = Buffer.from(`${testUser}:${testPass}`).toString('base64');
        const req  = http.request({
            hostname: testIp, port: testPort,
            path: '/index.fhtml', method: 'GET',
            headers: { 'Authorization': `Basic ${auth}` },
            timeout: 5000,
        }, (res) => {
            let data = '';
            res.setEncoding('latin1');
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                const ok = res.statusCode === 200 && data.includes('PIKO');
                this.sendTo(obj.from, obj.command, {
                    result: ok
                        ? `✅ Verbindung OK – PIKO gefunden (HTTP ${res.statusCode})`
                        : `⚠️ HTTP ${res.statusCode} – PIKO nicht erkannt`,
                    error: ok ? null : 'Gerät antwortet aber kein PIKO erkannt',
                }, obj.callback);
            });
        });
        req.on('error', (e) => {
            this.sendTo(obj.from, obj.command, {
                result: null,
                error: `❌ Verbindung fehlgeschlagen: ${e.message}`,
            }, obj.callback);
        });
        req.on('timeout', () => {
            req.destroy();
            this.sendTo(obj.from, obj.command, {
                result: null,
                error: '❌ Timeout – Gerät nicht erreichbar (5s)',
            }, obj.callback);
        });
        req.end();
    }

    _onUnload(callback) {
        try {
            if (this._pollTimer)  clearInterval(this._pollTimer);
            if (this._notifyTimer) clearInterval(this._notifyTimer);
            if (this._webServer)   this._webServer.close();
        } catch (_) {}
        callback();
    }

    // ─── Netzwerk-Verfügbarkeit prüfen (fritzwireguard) ────────────────────────

    async _checkNetwork() {
        if (this._cfg.networkMode !== 'fritzwireguard') return true;

        const stateId = this._cfg.fritzwgConnectedState ||
                        `${this._cfg.fritzwgInstance}.info.connection`;
        try {
            const st = await this.getForeignStateAsync(stateId);
            if (!st || !st.val) {
                this._log('WARN',
                    `WireGuard-Tunnel nicht aktiv (${stateId} = ${st ? st.val : 'null'}) → Poll übersprungen`);
                return false;
            }
            if (this._cfg.verbose) {
                this._log('DEBUG', `WireGuard-Tunnel aktiv (${stateId} = true) → Poll via Tunnel`);
            }
            return true;
        } catch (e) {
            this._log('WARN', `WireGuard-Status konnte nicht gelesen werden (${stateId}): ${e.message} → Poll übersprungen`);
            return false;
        }
    }

    // ─── Polling-Hauptschleife ───────────────────────────────────────────────────

    async _poll() {
        // 0. Netzwerk-Check (nur bei fritzwireguard-Modus)
        if (!(await this._checkNetwork())) {
            await this.setStateAsync('info.connection', { val: false, ack: true }).catch(() => {});
            return;
        }

        // 1. Live-Daten
        try {
            const [mainHtml, infoHtml] = await Promise.all([
                this._fetchPage(POLL_URLS.main),
                this._fetchPage(POLL_URLS.info),
            ]);
            await this._writeStates({
                ...this._parseMainPage(mainHtml),
                ...this._parseInfoPage(infoHtml),
            });
            await this.setStateAsync('info.connection',  { val: true,  ack: true });
            await this.setStateAsync('info.lastPoll',    { val: new Date().toISOString(), ack: true });
            await this.setStateAsync('info.networkMode', { val: this._cfg.networkMode, ack: true });
            await this._writeModuleStates();
            if (this._cfg.verbose) this._log('DEBUG', 'Live-Poll OK');
        } catch (err) {
            this._log('ERROR', `Live-Poll: ${err.message}`);
            await this.setStateAsync('info.connection', { val: false, ack: true }).catch(() => {});
        }

        // 2. History-Sync (nur alle syncInterval Minuten)
        // 3s Verzögerung damit PIKO nach dem Live-Poll wieder frei ist
        if (this._cfg.historyFetch) {
            const now        = Date.now();
            const intervalMs = this._cfg.syncInterval * 60 * 1000;
            if (now - this._lastHistoryFetch >= intervalMs) {
                this._lastHistoryFetch = now;
                setTimeout(() => {
                    this._fetchAndImportHistory(false).catch(e =>
                        this._log('WARN', `History-Sync: ${e.message}`)
                    );
                }, 3000);
            }
        }

        // 3. Wetter (alle 30 Minuten, wenn PLZ gesetzt)
        if (this._cfg.yieldPlz && Date.now() - this._lastWeatherFetch >= 30 * 60 * 1000) {
            this._refreshWeather().catch(e => {
                if (this._cfg.verbose) this._log('DEBUG', `Wetter: ${e.message}`);
            });
        }
    }

    // ─── Wetter / Sonnenerwartung (Open-Meteo) ───────────────────────────────────

    _fetchHttpsJson(reqUrl, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            const req = https.get(reqUrl, { timeout: timeoutMs }, (res) => {
                let data = '';
                res.on('data', c => { data += c; });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('JSON ungültig'));
                    }
                });
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.on('error', reject);
        });
    }

    _berlinDateKey(ts = Date.now()) {
        return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    }

    _weatherLabelFromMetrics(cloudPct, sunshineH, weatherCode) {
        if (cloudPct != null) {
            if (cloudPct <= 15) return 'Sonnig';
            if (cloudPct <= 35) return 'Überwiegend sonnig';
            if (cloudPct <= 60) return 'Teilweise bewölkt';
            if (cloudPct <= 85) return 'Bewölkt';
            return 'Stark bewölkt';
        }
        if (sunshineH != null && sunshineH >= 10) return 'Sonnig';
        return weatherCode != null ? this._wmoLabel(weatherCode) : null;
    }

    _wmoLabel(code) {
        const labels = {
            0 : 'Klar',
            1 : 'Überwiegend klar',
            2 : 'Teilweise bewölkt',
            3 : 'Bewölkt',
            45: 'Neblig',
            48: 'Neblig',
            51: 'Leichter Nieselregen',
            53: 'Nieselregen',
            55: 'Starker Nieselregen',
            61: 'Leichter Regen',
            63: 'Regen',
            65: 'Starker Regen',
            71: 'Leichter Schneefall',
            73: 'Schneefall',
            75: 'Starker Schneefall',
            80: 'Regenschauer',
            81: 'Regenschauer',
            82: 'Starke Regenschauer',
            95: 'Gewitter',
            96: 'Gewitter mit Hagel',
            99: 'Gewitter mit Hagel',
        };
        return labels[code] || `Wettercode ${code}`;
    }

    async _geocodePlz(plz) {
        if (this._weatherGeoCache && this._weatherGeoCache.plz === plz) {
            return this._weatherGeoCache;
        }
        const zip = await this._fetchHttpsJson(`https://api.zippopotam.us/de/${plz}`);
        const place = zip.places && zip.places[0];
        if (!place) throw new Error(`PLZ ${plz} nicht gefunden`);
        const geo = {
            plz,
            lat  : parseFloat(place.latitude),
            lon  : parseFloat(place.longitude),
            place: `${place['place name']}`,
            state: place.state || '',
        };
        this._weatherGeoCache = geo;
        return geo;
    }

    async _refreshWeather() {
        const plz = this._cfg.yieldPlz;
        if (!plz || !/^\d{5}$/.test(plz)) return;

        const geo = await this._geocodePlz(plz);
        const q = new URLSearchParams({
            latitude : String(geo.lat),
            longitude: String(geo.lon),
            daily    : 'sunshine_duration,weather_code,temperature_2m_max,precipitation_sum',
            hourly   : 'cloud_cover',
            timezone : 'Europe/Berlin',
            forecast_days: '1',
        });
        const fc = await this._fetchHttpsJson(`https://api.open-meteo.com/v1/forecast?${q}`);

        const sunshineSec = fc.daily?.sunshine_duration?.[0];
        const weatherCode = fc.daily?.weather_code?.[0];
        const tempMax     = fc.daily?.temperature_2m_max?.[0];
        const precip      = fc.daily?.precipitation_sum?.[0];

        let cloudAvg = null;
        const times = fc.hourly?.time || [];
        const clouds = fc.hourly?.cloud_cover || [];
        const todayBerlin = this._berlinDateKey();
        if (times.length && clouds.length) {
            const dayClouds = [];
            times.forEach((t, i) => {
                const h = parseInt(t.substring(11, 13), 10);
                if (t.startsWith(todayBerlin) && h >= 7 && h <= 19 && clouds[i] != null) {
                    dayClouds.push(clouds[i]);
                }
            });
            if (dayClouds.length) {
                cloudAvg = Math.round(dayClouds.reduce((s, v) => s + v, 0) / dayClouds.length);
            }
        }

        const sunshineH = sunshineSec != null ? Math.round(sunshineSec / 3600 * 10) / 10 : null;
        const weatherLabel = this._weatherLabelFromMetrics(cloudAvg, sunshineH, weatherCode);

        this._lastWeather = {
            plz,
            place    : geo.place,
            state    : geo.state,
            date     : todayBerlin,
            sunshineH,
            weather  : weatherLabel,
            weatherCode,
            tempMax  : tempMax != null ? Math.round(tempMax * 10) / 10 : null,
            precipMm : precip != null ? Math.round(precip * 10) / 10 : null,
            cloudPct : cloudAvg,
            source   : 'Open-Meteo',
            updatedAt: new Date().toISOString(),
        };
        this._lastWeatherFetch = Date.now();
        if (this._cfg.verbose) {
            this._log('DEBUG', `Wetter ${plz} ${geo.place}: ${this._lastWeather.sunshineH}h Sonne, ${this._lastWeather.weather}`);
        }
        await this._writeWeatherStates();
    }

    async _writeWeatherStates() {
        const w = this._lastWeather;
        if (!w) return;
        await this._writeStates({
            'weather.sunshineHours' : w.sunshineH ?? 0,
            'weather.tempMax'       : w.tempMax ?? 0,
            'weather.cloudCover'    : w.cloudPct ?? 0,
            'weather.precipitation' : w.precipMm ?? 0,
            'weather.description'   : w.weather || '',
            'weather.plz'           : w.plz || '',
            'weather.place'           : w.place || '',
            'weather.updatedAt'     : w.updatedAt || '',
        }, { skipDerived: true });
    }

    _calcDerivedStates(data) {
        const str = n => ({
            v: parseFloat(data[`pv.string${n}.voltage`]) || 0,
            a: parseFloat(data[`pv.string${n}.current`]) || 0,
        });
        const strings = [str(1), str(2), str(3)];
        const stringCount = this._getStringCount();
        const dcTotal = Math.round(strings
            .slice(0, stringCount)
            .reduce((sum, s) => sum + s.v * s.a, 0));
        const acPower = parseFloat(data['ac.power']) || 0;
        let ratio = 0;
        if (dcTotal >= 50 && acPower >= 0) {
            ratio = Math.round(acPower / dcTotal * 1000) / 10;
        }
        const tempMax = this._lastWeather?.tempMax;
        let expected = 97;
        if (tempMax != null) {
            const cellTempEst = tempMax + 18;
            const tempFactor = 1 - 0.004 * Math.max(0, cellTempEst - 25);
            expected = Math.round(97 * tempFactor * 10) / 10;
        }
        return {
            'dc.totalPower'      : dcTotal,
            'efficiency.ratio'   : ratio,
            'efficiency.expected': expected,
        };
    }

    // ─── History: Abruf + Import ─────────────────────────────────────────────────

    async _fetchAndImportHistory(syncAll = false, retryCount = 0) {
        this._historyLoading = true;
        this._log('INFO', syncAll
            ? 'Starte VOLLSYNC (alle Datenpunkte) → InfluxDB...'
            : 'Starte History-Sync (nur neue Datenpunkte)...'
        );

        // Zeitpunkt des HTTP-Abrufs merken (für Epochen-Berechnung)
        const fetchUnixSec = Math.floor(Date.now() / 1000);
        const raw = await this._fetchPage(POLL_URLS.log);

        // "akt. Zeit" aus Header lesen (Tab-separiert: "akt. Zeit:\t 495381409")
        const m = raw.match(/akt\.\s*Zeit[:\s\t]+\s*(\d+)/);
        if (!m) {
            const preview = raw.substring(0, 300).replace(/\r/g, '').split('\n').slice(0,5).join(' | ');
            const isBusy  = /service.*busy|nicht.*verf.gbar/i.test(raw.substring(0, 200));
            if (isBusy && retryCount < 2) {
                // PIKO ist beschäftigt → in 30s nochmal versuchen
                this._historyLoading = false;
                this._log('WARN', `History-Sync: PIKO meldet "service busy" → Retry in 30s (Versuch ${retryCount + 1}/2)`);
                setTimeout(() => this._fetchAndImportHistory(syncAll, retryCount + 1).catch(e =>
                    this._log('WARN', `History-Sync Retry: ${e.message}`)
                ), 30000);
                return;
            }
            throw new Error('"akt. Zeit" nicht im Header gefunden. Header-Preview: ' + preview);
        }
        const aktZeit = parseInt(m[1]);

        // PIKO-Epoche berechnen:
        // Gerät läuft aktZeit Sekunden → Inbetriebnahme war vor aktZeit Sekunden
        this._pikoEpoch = fetchUnixSec - aktZeit;
        this._log('INFO',
            `PIKO Epoche: ${new Date(this._pikoEpoch * 1000).toISOString().substring(0, 10)} ` +
            `| akt. Zeit des Geräts: ${aktZeit} s`
        );
        await this.setStateAsync('history.pikoEpoch',
            { val: new Date(this._pikoEpoch * 1000).toISOString(), ack: true }
        );

        // CSV parsen
        const rows = this._parseLogDaten(raw, this._pikoEpoch);

        if (rows.length === 0) {
            this._log('WARN', 'LogDaten.dat: keine verwertbaren Zeilen gefunden – bestehende Historie bleibt erhalten');
            this._historyLoading = false;
            return;
        }

        const prevRows = this._lastHistoryRows;
        const prevMaxTs = prevRows.reduce((m, r) => Math.max(m, r.ts), 0);
        const newMaxTs  = rows.reduce((m, r) => Math.max(m, r.ts), 0);

        if (this._isHistoryParseSuspicious(prevRows, rows)) {
            this._log('WARN',
                `LogDaten.dat wirkt unvollständig (${rows.length} Punkte, zuvor ${prevRows.length}, ` +
                `${rows[0].date.substring(0,10)} – ${rows[rows.length-1].date.substring(0,10)}) – ` +
                `Cache wird per Merge aktualisiert, ältere Punkte bleiben erhalten`
            );
        } else if (prevRows.length && newMaxTs < prevMaxTs - 45 * 60 * 1000) {
            this._log('WARN',
                `LogDaten.dat endet früher als Cache (${new Date(newMaxTs).toISOString()} vs. ` +
                `${new Date(prevMaxTs).toISOString()}) – Cache wird per Merge beibehalten`
            );
        }

        const merged = this._mergeHistoryRows(prevRows, rows);
        const added  = merged.length - prevRows.length;
        const removed = (prevRows.length + rows.length) - merged.length;
        this._lastHistoryRows = merged;
        if (removed > 0) {
            this._log('INFO', `${removed} doppelte History-Punkte beim Merge entfernt`);
        }
        if (added > 0) {
            this._log('INFO', `${added} neue Punkte per Merge (gesamt ${merged.length})`);
        }

        await this._saveHistoryCache().catch(e =>
            this._log('WARN', `History-Cache speichern: ${e.message}`)
        );
        await this._refreshAutoYields().catch(e =>
            this._log('WARN', `Monatserträge aktualisieren: ${e.message}`)
        );

        const allRows = this._lastHistoryRows;
        this._log('INFO',
            `${allRows.length} Datenpunkte gesamt | ` +
            `${allRows[0].date.substring(0,10)} – ${allRows[allRows.length-1].date.substring(0,10)}`
        );

        // Deduplication: bei syncAll Cursor auf 0 setzen → alles übertragen
        if (syncAll) {
            this._log('INFO', 'Sync-All: Cursor zurückgesetzt, übertrage alle Datenpunkte');
            this._lastImportedTs = 0;
        }

        // Nur neue Zeilen importieren (gegen gesamte Historie inkl. Cache)
        const newRows = syncAll
            ? allRows.filter(r => r.ts > 0)
            : allRows.filter(r => r.ts > this._lastImportedTs);
        this._log('INFO', `${newRows.length} Datenpunkte ${syncAll ? '(alle)' : '(neu)'} → InfluxDB`);

        if (newRows.length === 0) {
            this._lastImportIso = new Date().toISOString();
            await this.setStateAsync('history.lastImport',  { val: this._lastImportIso, ack: true });
            await this.setStateAsync('history.recordCount', { val: allRows.length, ack: true });
            await this._refreshAutoYields().catch(e =>
                this._log('WARN', `Monatserträge aktualisieren: ${e.message}`)
            );
            this._historyLoading = false;
            return;
        }

        let influxSent = 0;
        let maxTs      = this._lastImportedTs;

        for (const row of newRows) {
            await this._writeHistoryRow(row);

            if (this._cfg.influxEnable) {
                const n = await this._sendRowToInflux(row);
                influxSent += n;
            }

            if (row.ts > maxTs) maxTs = row.ts;
        }

        // Cursor speichern
        this._lastImportedTs = maxTs;
        await this.setStateAsync('history.lastImportedTs', { val: maxTs,                         ack: true });
        this._lastImportIso = new Date().toISOString();
        await this.setStateAsync('history.lastImport',     { val: this._lastImportIso,          ack: true });
        await this.setStateAsync('history.recordCount',    { val: allRows.length,               ack: true });
        await this.setStateAsync('history.newRecords',     { val: newRows.length,                 ack: true });
        await this.setStateAsync('history.oldestRecord',   { val: allRows[0].date,                ack: true });
        await this.setStateAsync('history.newestRecord',   { val: allRows[allRows.length-1].date, ack: true });
        if (this._cfg.influxEnable) {
            await this.setStateAsync('history.influxSent', { val: influxSent,                     ack: true });
        }

        this._historyLoading = false;
        this._log('INFO',
            `Sync ${syncAll ? '(Vollsync)' : ''} fertig: ${newRows.length} Punkte` +
            (this._cfg.influxEnable ? `, ${influxSent} → ${this._cfg.influxInstance}` : '')
        );
    }

    // ─── History → ioBroker-States (mit historischem ts) ────────────────────────

    async _writeHistoryRow(row) {
        for (const def of HISTORY_STATES) {
            const val = this._calcHistVal(row, def);
            if (val === null) continue;
            try {
                // ts = historischer UNIX-Timestamp in ms
                // Der ioBroker InfluxDB-Adapter schreibt diesen ts in die DB
                await this.setStateAsync(def.id, {
                    val,
                    ack : true,
                    ts  : row.ts,  // ← DAS ist der Schlüssel für korrekte Zeitreihen
                    q   : 0,
                });
            } catch (e) {
                if (this._cfg.verbose) this._log('WARN', `${def.id}: ${e.message}`);
            }
        }
    }

    // ─── History → InfluxDB direkt via sendTo (Batch) ────────────────────────────

    async _sendRowToInflux(row) {
        const points = [];
        for (const def of HISTORY_STATES) {
            const val = this._calcHistVal(row, def);
            if (val === null) continue;
            points.push({
                id   : `${this.namespace}.${def.id}`,
                state: { val, ts: row.ts, ack: true, q: 0 },
            });
        }
        if (!points.length) return 0;

        await new Promise((resolve) => {
            this.sendTo(this._cfg.influxInstance, 'storeState', points, (result) => {
                if (result && result.error) {
                    this._log('WARN', `InfluxDB sendTo: ${result.error}`);
                }
                resolve();
            });
        });
        return points.length;
    }

    async _syncLiveToInflux(data) {
        if (!this._cfg.influxEnable) return;
        const ts = Date.now();
        const points = [];
        for (const id of LIVE_INFLUX_STATES) {
            if (data[id] === null || data[id] === undefined) continue;
            points.push({
                id   : `${this.namespace}.${id}`,
                state: { val: data[id], ts, ack: true, q: 0 },
            });
        }
        if (!points.length) return;

        await new Promise((resolve) => {
            this.sendTo(this._cfg.influxInstance, 'storeState', points, (result) => {
                if (result && result.error && this._cfg.verbose) {
                    this._log('WARN', `InfluxDB Live-Sync: ${result.error}`);
                }
                resolve();
            });
        });
    }

    _dedupeHistoryRows(rows) {
        const SLOT_MS = 15 * 60 * 1000;
        const bySlot = new Map();
        for (const r of rows) {
            if (!r?.ts) continue;
            const slot = Math.floor(r.ts / SLOT_MS);
            bySlot.set(slot, r);
        }
        return [...bySlot.values()].sort((a, b) => a.ts - b.ts);
    }

    _mergeHistoryRows(prevRows, newRows) {
        if (!prevRows.length) return this._dedupeHistoryRows(newRows);
        if (!newRows.length) return this._dedupeHistoryRows(prevRows);
        return this._dedupeHistoryRows([...prevRows, ...newRows]);
    }

    _isHistoryParseSuspicious(prevRows, newRows) {
        if (!prevRows.length || !newRows.length) return false;
        if (prevRows.length < 100) return false;
        const prevMax = prevRows[prevRows.length - 1].ts;
        const newMax  = newRows[newRows.length - 1].ts;
        // Abgeschnittene Datei: neuester Punkt deutlich älter als im Cache (z. B. fehlender Nachmittag)
        if (newMax < prevMax - 45 * 60 * 1000) return true;
        if (newRows.length >= prevRows.length * 0.5) return false;
        const prevSpan = prevRows[prevRows.length - 1].ts - prevRows[0].ts;
        const newSpan  = newRows[newRows.length - 1].ts - newRows[0].ts;
        if (newRows.length < prevRows.length * 0.1) return true;
        if (prevSpan > 7 * 86400000 && newSpan < 2 * 86400000) return true;
        return false;
    }

    _resolvePikoModelKey() {
        const cfgModel = (this._cfg.pikoModel || 'auto').toLowerCase();
        if (cfgModel !== 'auto' && PIKO_SPECS[cfgModel]) return cfgModel;
        const live = (this._lastData['device.model'] || '').toLowerCase();
        if (live.includes('10.1')) return 'piko10.1';
        if (live.includes('8.3'))  return 'piko8.3';
        if (live.includes('7.0'))  return 'piko7.0';
        if (live.includes('5.5'))  return 'piko5.5';
        if (live.includes('4.2'))  return 'piko4.2';
        if (live.includes('3.6'))  return 'piko3.6';
        if (live.includes('3.0'))  return 'piko3.0';
        return null;
    }

    _getInverterSpecs() {
        const key = this._resolvePikoModelKey();
        const spec = key ? PIKO_SPECS[key] : null;
        if (!spec) return { enabled: false };
        const activeStrings = [
            this._cfg.string1Modules,
            this._cfg.string2Modules,
            this._cfg.string3Modules,
        ].filter(n => n > 0).length || spec.strings;
        const mppMin = activeStrings >= 2 ? (spec.mppMin2 || spec.mppMin1) : (spec.mppMin1 || spec.mppMin2);
        return {
            enabled    : true,
            modelKey   : key,
            modelName  : spec.name,
            ...spec,
            mppMinActive: mppMin,
            grid       : GRID_LIMITS_DE,
        };
    }

    _checkStringInverterLimits(voltage, current, inv) {
        if (!inv?.enabled || !voltage) return { ok:true, warnings:[] };
        const w = [];
        if (voltage > inv.dcMaxV) w.push(`Spannung ${voltage}V > Udcmax ${inv.dcMaxV}V`);
        if (voltage < inv.dcMinV && current > 0.1) w.push(`Spannung ${voltage}V < Udcmin ${inv.dcMinV}V`);
        if (inv.dcMaxA && current > inv.dcMaxA) {
            w.push(`Strom ${current}A > Idmax ${inv.dcMaxA}A`);
        }
        return { ok: !w.length, warnings: w };
    }

    _getHistoryCachePath() {
        const dataRoot = path.join(process.cwd(), 'iobroker-data', this.namespace);
        return path.join(dataRoot, 'history-cache.json');
    }

    _compactHistoryRow(row) {
        return {
            ts: row.ts,
            date: row.date,
            dc1: row.dc1,
            dc2: row.dc2,
            dc3: row.dc3,
            ac1: row.ac1,
            ac2: row.ac2,
            ac3: row.ac3,
            frequency: row.frequency,
            acStatus: row.acStatus,
            errorCode: row.errorCode,
            acTotalPower: row.acTotalPower,
            totalEnergy: row.totalEnergy,
        };
    }

    async _saveHistoryCache() {
        if (!this._historyCachePath || !this._lastHistoryRows.length) return;
        const dir = path.dirname(this._historyCachePath);
        await fs.promises.mkdir(dir, { recursive: true });
        try {
            await fs.promises.access(this._historyCachePath);
            await fs.promises.copyFile(this._historyCachePath, `${this._historyCachePath}.bak`);
        } catch (_) {}
        const payload = {
            savedAt  : new Date().toISOString(),
            pikoEpoch: this._pikoEpoch,
            rows     : this._lastHistoryRows.map(r => this._compactHistoryRow(r)),
        };
        await fs.promises.writeFile(this._historyCachePath, JSON.stringify(payload), 'utf-8');
    }

    async _loadHistoryCache() {
        if (!this._historyCachePath) return;
        for (const file of [this._historyCachePath, `${this._historyCachePath}.bak`]) {
            try {
                const raw = await fs.promises.readFile(file, 'utf-8');
                const data = JSON.parse(raw);
                if (!data.rows || !Array.isArray(data.rows) || data.rows.length < 10) continue;
                this._lastHistoryRows = this._dedupeHistoryRows(data.rows);
                if (data.pikoEpoch) this._pikoEpoch = data.pikoEpoch;
                const removed = data.rows.length - this._lastHistoryRows.length;
                this._log('INFO',
                    `History-Cache geladen: ${this._lastHistoryRows.length} Punkte` +
                    (removed > 0 ? ` (${removed} Duplikate entfernt)` : '') +
                    (data.savedAt ? ` (Stand ${data.savedAt.substring(0, 19).replace('T', ' ')})` : '') +
                    (file.endsWith('.bak') ? ' [Backup]' : '')
                );
                if (removed > 0) {
                    await this._saveHistoryCache().catch(e =>
                        this._log('WARN', `History-Cache bereinigen: ${e.message}`)
                    );
                }
                return;
            } catch (e) {
                if (e.code !== 'ENOENT' && this._cfg.verbose) {
                    this._log('DEBUG', `History-Cache ${file}: ${e.message}`);
                }
            }
        }
    }

    _getYieldsCachePath() {
        const dataRoot = path.join(process.cwd(), 'iobroker-data', this.namespace);
        return path.join(dataRoot, 'monthly-yields.json');
    }

    _defaultMonthlyYields() {
        const kwp = this._cfg.yieldInstalledKwp || this._getInstalledKwp();
        let commissionYear = null;
        if (this._pikoEpoch) commissionYear = new Date(this._pikoEpoch * 1000).getFullYear();
        return {
            savedAt       : new Date().toISOString(),
            feedInTariff  : this._cfg.yieldFeedInTariff || 0.3925,
            installedKwp  : kwp || 0,
            plzRegion     : (this._cfg.yieldPlz || '').charAt(0) || '',
            plz           : this._cfg.yieldPlz || '',
            regionalKwpRef: null,
            extraYears    : [],
            months        : {},
        };
    }

    _getYieldsYears(months, extraYears) {
        const fromData = Object.keys(months || {})
            .map(k => this._parseMonthKey(k)?.year)
            .filter(Boolean);
        const pinned = (extraYears || []).map(y => parseInt(y)).filter(y => y >= 1990 && y <= 2100);
        const currentYear = new Date().getFullYear();
        const years = [...new Set([...fromData, ...pinned, currentYear])].sort((a, b) => a - b);
        return years;
    }

    async _loadMonthlyYields() {
        if (!this._yieldsCachePath) return;
        const loaded = await this._readYieldsFile(this._yieldsCachePath);
        if (loaded) {
            this._monthlyYields = loaded;
            const n = Object.keys(this._monthlyYields.months).length;
            this._log('INFO', `Monatserträge geladen: ${n} Monate`);
            if (n < 3) {
                const bak = await this._readYieldsFile(`${this._yieldsCachePath}.bak`);
                if (bak && Object.keys(bak.months).length > n) {
                    this._log('WARN',
                        `Monatserträge wirken unvollständig (${n} Monate) – Backup hat ` +
                        `${Object.keys(bak.months).length} Monate (Ertrag-Tab: „Backup wiederherstellen“)`
                    );
                }
            }
            return;
        }
        const bak = await this._readYieldsFile(`${this._yieldsCachePath}.bak`);
        if (bak && Object.keys(bak.months).length) {
            this._monthlyYields = bak;
            this._log('WARN',
                `Monatserträge aus Backup wiederhergestellt: ${Object.keys(bak.months).length} Monate`
            );
            await this._saveMonthlyYields();
            return;
        }
        this._monthlyYields = this._defaultMonthlyYields();
    }

    async _readYieldsFile(filePath) {
        try {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            if (!data.months || typeof data.months !== 'object') return null;
            return {
                ...this._defaultMonthlyYields(),
                ...data,
                months: { ...data.months },
                extraYears: Array.isArray(data.extraYears) ? [...data.extraYears] : [],
            };
        } catch (e) {
            if (e.code !== 'ENOENT' && this._cfg?.verbose) {
                this._log('DEBUG', `Monatserträge ${filePath}: ${e.message}`);
            }
            return null;
        }
    }

    async _saveMonthlyYields() {
        if (!this._yieldsCachePath || !this._monthlyYields) return;
        const dir = path.dirname(this._yieldsCachePath);
        await fs.promises.mkdir(dir, { recursive: true });
        try {
            await fs.promises.access(this._yieldsCachePath);
            await fs.promises.copyFile(this._yieldsCachePath, `${this._yieldsCachePath}.bak`);
        } catch (_) {}
        this._monthlyYields.savedAt = new Date().toISOString();
        await fs.promises.writeFile(this._yieldsCachePath, JSON.stringify(this._monthlyYields, null, 2), 'utf-8');
    }

    _monthKey(year, month) {
        return `${year}-${String(month).padStart(2, '0')}`;
    }

    _parseMonthKey(key) {
        const m = /^(\d{4})-(\d{2})$/.exec(key || '');
        if (!m) return null;
        return { year: parseInt(m[1]), month: parseInt(m[2]) };
    }

    _getRowsForMonth(year, month) {
        return this._dedupeHistoryRows(this._lastHistoryRows).filter(r => {
            const parts = new Intl.DateTimeFormat('en', {
                timeZone: 'Europe/Berlin',
                year    : 'numeric',
                month   : 'numeric',
            }).formatToParts(new Date(r.ts));
            const y = parseInt(parts.find(p => p.type === 'year').value, 10);
            const m = parseInt(parts.find(p => p.type === 'month').value, 10);
            return y === year && m === month;
        });
    }

    _maxPlausibleMonthWh(kwp) {
        const k = kwp || this._getInstalledKwp() || 10;
        return Math.round(k * 220 * 1000);
    }

    _calcMonthWhFromRows(rows) {
        if (!rows.length) return 0;
        const byDay = {};
        this._dedupeHistoryRows(rows).forEach(r => {
            const day = this._berlinDateKey(r.ts);
            if (!byDay[day]) byDay[day] = [];
            byDay[day].push(r);
        });
        let totalKwh = 0;
        Object.values(byDay).forEach(dayRows => {
            totalKwh += this._calcDailyKwh(dayRows);
        });
        return Math.round(totalKwh * 1000);
    }

    _isManualYieldEntry(entry) {
        return !!(entry && entry.source === 'manual' && entry.wh > 0);
    }

    async _refreshAutoYields(options = {}) {
        if (!this._monthlyYields) this._monthlyYields = this._defaultMonthlyYields();
        if (!this._lastHistoryRows.length) {
            return { updated: 0, historyFrom: null, historyTo: null, monthsInHistory: 0 };
        }

        const force     = !!options.force;
        const fromYear  = options.fromYear ? parseInt(options.fromYear) : null;
        const fromMonth = options.fromMonth ? parseInt(options.fromMonth) : 1;

        const kwp = this._cfg.yieldInstalledKwp || this._getInstalledKwp();
        if (kwp) this._monthlyYields.installedKwp = kwp;
        this._monthlyYields.feedInTariff = this._cfg.yieldFeedInTariff || this._monthlyYields.feedInTariff;
        if (this._cfg.yieldPlz) {
            this._monthlyYields.plzRegion = this._cfg.yieldPlz.charAt(0);
            this._monthlyYields.plz = this._cfg.yieldPlz;
        }

        if (fromYear) {
            if (!this._monthlyYields.extraYears) this._monthlyYields.extraYears = [];
            const cy = new Date().getFullYear();
            for (let y = fromYear; y <= cy; y++) {
                if (!this._monthlyYields.extraYears.includes(y)) {
                    this._monthlyYields.extraYears.push(y);
                }
            }
            this._monthlyYields.extraYears.sort((a, b) => a - b);
        }

        const monthSet = {};
        this._lastHistoryRows.forEach(r => {
            const d = new Date(r.ts);
            const year = d.getFullYear();
            const month = d.getMonth() + 1;
            if (fromYear) {
                const beforeStart = year < fromYear || (year === fromYear && month < fromMonth);
                if (beforeStart) return;
            }
            monthSet[this._monthKey(year, month)] = { year, month };
        });

        let updated = 0;
        let skippedManual = 0;
        Object.values(monthSet).forEach(({ year, month }) => {
            const key = this._monthKey(year, month);
            const existing = this._monthlyYields.months[key];
            if (this._isManualYieldEntry(existing)) {
                skippedManual++;
                return;
            }

            const wh = this._calcMonthWhFromRows(this._getRowsForMonth(year, month));
            if (wh <= 0) return;

            const maxWh = this._maxPlausibleMonthWh(kwp);
            if (wh > maxWh) {
                this._log('WARN',
                    `Monatsertrag ${key}: ${wh} Wh unrealistisch (>${maxWh} Wh) – ` +
                    `bitte „Auto-Werte löschen“ und erneut aus Historie berechnen`
                );
                return;
            }

            const now = new Date();
            const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
            if (!force && existing && existing.source === 'auto' && existing.wh === wh && !isCurrentMonth) return;

            this._monthlyYields.months[key] = {
                wh,
                source   : 'auto',
                updatedAt: new Date().toISOString(),
            };
            updated++;
        });

        if (updated > 0 || skippedManual > 0) {
            if (updated > 0) await this._saveMonthlyYields();
            this._log('INFO',
                `Monatserträge: ${updated} Monat(e) aus Historie aktualisiert` +
                (skippedManual > 0 ? `, ${skippedManual} manuelle Werte unverändert` : '')
            );
        }

        const sorted = [...this._lastHistoryRows].sort((a, b) => a.ts - b.ts);
        return {
            updated,
            skippedManual,
            monthsInHistory: Object.keys(monthSet).length,
            historyFrom    : sorted.length ? sorted[0].date.substring(0, 10) : null,
            historyTo      : sorted.length ? sorted[sorted.length - 1].date.substring(0, 10) : null,
        };
    }

    _buildYieldsApiResponse() {
        const data = this._monthlyYields || this._defaultMonthlyYields();
        const months = data.months || {};
        const years = this._getYieldsYears(months, data.extraYears);

        const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
        const grid = [];
        const monthStats = [];

        for (let m = 1; m <= 12; m++) {
            const row = { month: m, name: monthNames[m - 1], cells: {}, stats: {} };
            const values = [];
            years.forEach(year => {
                const key = this._monthKey(year, m);
                const entry = months[key];
                const wh = entry && entry.wh > 0 ? entry.wh : null;
                row.cells[year] = {
                    wh,
                    source: entry?.source || null,
                };
                if (wh) values.push(wh);
            });
            if (values.length) {
                const avg = values.reduce((s, v) => s + v, 0) / values.length;
                row.stats = {
                    avg : Math.round(avg),
                    min : Math.min(...values),
                    max : Math.max(...values),
                };
            }
            grid.push(row);
            monthStats.push(row.stats);
        }

        const yearTotals = {};
        const yearEuro = {};
        const yearKwp = {};
        const tariff = data.feedInTariff || 0.3925;
        const kwp = data.installedKwp || 0;

        years.forEach(year => {
            let sumWh = 0;
            for (let m = 1; m <= 12; m++) {
                const key = this._monthKey(year, m);
                const wh = months[key]?.wh;
                if (wh > 0) sumWh += wh;
            }
            yearTotals[year] = sumWh;
            yearEuro[year] = Math.round(sumWh / 1000 * tariff * 100) / 100;
            yearKwp[year] = kwp > 0 ? Math.round(sumWh / 1000 / kwp * 10) / 10 : null;
        });

        let totalWh = 0;
        Object.values(yearTotals).forEach(v => { totalWh += v; });
        const totalEuro = Math.round(totalWh / 1000 * tariff * 100) / 100;
        const totalKwh  = Math.round(totalWh / 1000 * 10) / 10;

        return {
            settings: {
                feedInTariff : tariff,
                installedKwp : kwp,
                plzRegion    : data.plzRegion || (data.plz || '').charAt(0) || '',
                plz          : data.plz || this._cfg.yieldPlz || '',
                regionalKwpRef: data.regionalKwpRef || null,
                pikoEpoch    : this._pikoEpoch ? new Date(this._pikoEpoch * 1000).toISOString().substring(0, 10) : null,
            },
            storagePath: this._yieldsCachePath || null,
            backupPath : this._yieldsCachePath ? `${this._yieldsCachePath}.bak` : null,
            historyFrom: this._lastHistoryRows.length
                ? [...this._lastHistoryRows].sort((a, b) => a.ts - b.ts)[0].date.substring(0, 10)
                : null,
            historyTo  : this._lastHistoryRows.length
                ? [...this._lastHistoryRows].sort((a, b) => a.ts - b.ts).pop().date.substring(0, 10)
                : null,
            extraYears : data.extraYears || [],
            years,
            grid,
            yearTotals,
            yearEuro,
            yearKwp,
            totalWh,
            totalKwh,
            totalEuro,
            monthCount: Object.keys(months).length,
        };
    }

    async _handleYieldsPost(body) {
        if (!this._monthlyYields) this._monthlyYields = this._defaultMonthlyYields();
        const action = body.action;

        if (action === 'setCell') {
            const year = parseInt(body.year);
            const month = parseInt(body.month);
            if (!year || month < 1 || month > 12) throw new Error('Ungültiges Jahr/Monat');
            const key = this._monthKey(year, month);
            const wh = body.wh === null || body.wh === '' || body.wh === undefined
                ? null
                : Math.round(parseFloat(String(body.wh).replace(',', '.')));
            if (wh === null || isNaN(wh)) {
                delete this._monthlyYields.months[key];
            } else if (wh < 0) {
                throw new Error('Ertrag darf nicht negativ sein');
            } else {
                this._monthlyYields.months[key] = {
                    wh,
                    source   : 'manual',
                    updatedAt: new Date().toISOString(),
                };
            }
            await this._saveMonthlyYields();
            return { ok: true, message: 'Gespeichert' };
        }

        if (action === 'setSettings') {
            if (body.feedInTariff !== undefined) {
                const t = parseFloat(String(body.feedInTariff).replace(',', '.'));
                if (!isNaN(t) && t >= 0) this._monthlyYields.feedInTariff = t;
            }
            if (body.installedKwp !== undefined) {
                const k = parseFloat(String(body.installedKwp).replace(',', '.'));
                if (!isNaN(k) && k >= 0) this._monthlyYields.installedKwp = k;
            }
            if (body.plzRegion !== undefined) {
                const p = String(body.plzRegion).trim();
                this._monthlyYields.plzRegion = /^\d{5}$/.test(p) ? p.charAt(0) : p;
                if (/^\d{5}$/.test(p)) this._monthlyYields.plz = p;
            }
            if (body.plz !== undefined) {
                const p = String(body.plz).trim();
                if (/^\d{5}$/.test(p)) {
                    this._monthlyYields.plz = p;
                    this._monthlyYields.plzRegion = p.charAt(0);
                    this._cfg.yieldPlz = p;
                    this._weatherGeoCache = null;
                    this._lastWeatherFetch = 0;
                    this._refreshWeather().catch(e => this._log('DEBUG', `Wetter: ${e.message}`));
                }
            }
            if (body.regionalKwpRef !== undefined) {
                if (body.regionalKwpRef === null) {
                    this._monthlyYields.regionalKwpRef = null;
                } else if (Array.isArray(body.regionalKwpRef) && body.regionalKwpRef.length === 12) {
                    this._monthlyYields.regionalKwpRef = body.regionalKwpRef.map(v =>
                        v === null || v === '' ? null : parseFloat(String(v).replace(',', '.'))
                    );
                }
            }
            await this._saveMonthlyYields();
            return { ok: true, message: 'Einstellungen gespeichert' };
        }

        if (action === 'refreshAuto') {
            const result = await this._refreshAutoYields({ force: !!body.force });
            const range = result.historyFrom && result.historyTo
                ? ` (Historie: ${result.historyFrom} – ${result.historyTo})`
                : '';
            return {
                ok: true,
                message: `${result.updated} Monat(e) aus Historie berechnet${range}` +
                    (result.skippedManual ? `, ${result.skippedManual} manuelle Werte beibehalten` : ''),
                ...result,
            };
        }

        if (action === 'rebuildFromHistory') {
            const fromYear = parseInt(body.fromYear) || 2018;
            const fromMonth = parseInt(body.fromMonth) || 5;
            const result = await this._refreshAutoYields({
                fromYear,
                fromMonth,
                force: true,
            });
            const range = result.historyFrom && result.historyTo
                ? `${result.historyFrom} – ${result.historyTo}`
                : 'keine Historie';
            let msg = `${result.updated} Monat(e) neu berechnet (ab ${String(fromMonth).padStart(2, '0')}/${fromYear}). ` +
                `Historie im Cache: ${range}.`;
            if (result.skippedManual) {
                msg += ` ${result.skippedManual} manuelle Werte beibehalten.`;
            }
            if (result.historyFrom && result.historyFrom > `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`) {
                msg += ` Ältere Monate fehlen in der Historie – Backup/Import nutzen oder scripts/combine-yields.js auf dem Server.`;
            }
            return { ok: true, message: msg, ...result };
        }

        if (action === 'restoreBackup') {
            const bak = `${this._yieldsCachePath}.bak`;
            const data = await this._readYieldsFile(bak);
            if (!data || !Object.keys(data.months).length) {
                throw new Error('Kein Backup gefunden oder Backup leer (.bak)');
            }
            this._monthlyYields = data;
            await this._saveMonthlyYields();
            return {
                ok: true,
                message: `${Object.keys(data.months).length} Monate aus Backup wiederhergestellt`,
            };
        }

        if (action === 'clearAuto') {
            let cleared = 0;
            Object.keys(this._monthlyYields.months).forEach(key => {
                if (this._monthlyYields.months[key].source === 'auto') {
                    delete this._monthlyYields.months[key];
                    cleared++;
                }
            });
            await this._saveMonthlyYields();
            return { ok: true, message: `${cleared} automatische Einträge entfernt` };
        }

        if (action === 'addYear') {
            const year = parseInt(body.year);
            if (!year || year < 1990 || year > 2100) throw new Error('Ungültiges Jahr (1990–2100)');
            if (!this._monthlyYields.extraYears) this._monthlyYields.extraYears = [];
            if (!this._monthlyYields.extraYears.includes(year)) {
                this._monthlyYields.extraYears.push(year);
                this._monthlyYields.extraYears.sort((a, b) => a - b);
            }
            await this._saveMonthlyYields();
            return { ok: true, message: `Jahr ${year} hinzugefügt` };
        }

        if (action === 'fillYears') {
            const from = body.fromYear
                ? parseInt(body.fromYear)
                : (this._pikoEpoch ? new Date(this._pikoEpoch * 1000).getFullYear() : 2010);
            const to = body.toYear ? parseInt(body.toYear) : new Date().getFullYear();
            if (!from || from < 1990 || to > 2100 || from > to) {
                throw new Error('Ungültiger Jahresbereich');
            }
            if (!this._monthlyYields.extraYears) this._monthlyYields.extraYears = [];
            let added = 0;
            for (let y = from; y <= to; y++) {
                if (!this._monthlyYields.extraYears.includes(y)) {
                    this._monthlyYields.extraYears.push(y);
                    added++;
                }
            }
            this._monthlyYields.extraYears.sort((a, b) => a - b);
            await this._saveMonthlyYields();
            return { ok: true, message: `${added} Jahr(e) hinzugefügt (${from}–${to})` };
        }

        if (action === 'removeYear') {
            const year = parseInt(body.year);
            if (!year) throw new Error('Jahr fehlt');
            if (this._monthlyYields.extraYears) {
                this._monthlyYields.extraYears = this._monthlyYields.extraYears.filter(y => y !== year);
            }
            if (body.clearData) {
                for (let m = 1; m <= 12; m++) {
                    delete this._monthlyYields.months[this._monthKey(year, m)];
                }
            }
            await this._saveMonthlyYields();
            return { ok: true, message: `Jahr ${year} entfernt` };
        }

        if (action === 'import') {
            const mode = body.mode === 'replace' ? 'replace' : 'merge';
            let imported = 0;

            if (body.data && typeof body.data === 'object') {
                const payload = body.data;
                if (payload.feedInTariff !== undefined) {
                    const t = parseFloat(String(payload.feedInTariff).replace(',', '.'));
                    if (!isNaN(t)) this._monthlyYields.feedInTariff = t;
                }
                if (payload.installedKwp !== undefined) {
                    const k = parseFloat(String(payload.installedKwp).replace(',', '.'));
                    if (!isNaN(k)) this._monthlyYields.installedKwp = k;
                }
                if (payload.plzRegion !== undefined) {
                    this._monthlyYields.plzRegion = String(payload.plzRegion).trim();
                }
                if (Array.isArray(payload.extraYears)) {
                    this._monthlyYields.extraYears = [...new Set([
                        ...(this._monthlyYields.extraYears || []),
                        ...payload.extraYears.map(y => parseInt(y)).filter(Boolean),
                    ])].sort((a, b) => a - b);
                }
                if (mode === 'replace' && payload.months) {
                    this._monthlyYields.months = {};
                }
                if (payload.months && typeof payload.months === 'object') {
                    Object.entries(payload.months).forEach(([key, entry]) => {
                        const parsed = this._parseMonthKey(key);
                        if (!parsed) return;
                        const wh = typeof entry === 'object' ? entry.wh : entry;
                        const n = Math.round(parseFloat(String(wh).replace(',', '.')));
                        if (!n || n <= 0) return;
                        const existing = this._monthlyYields.months[key];
                        if (mode === 'merge' && existing?.source === 'auto' && entry?.source !== 'manual') return;
                        this._monthlyYields.months[key] = {
                            wh       : n,
                            source   : 'manual',
                            updatedAt: new Date().toISOString(),
                        };
                        imported++;
                    });
                }
            } else if (body.csv && typeof body.csv === 'string') {
                imported = this._importYieldsCsv(body.csv, mode);
            } else {
                throw new Error('Keine Import-Daten (data oder csv)');
            }

            await this._saveMonthlyYields();
            return { ok: true, message: `${imported} Monatswerte importiert (${mode})` };
        }

        throw new Error('Unbekannte Aktion');
    }

    _importYieldsCsv(csv, mode) {
        const monthNames = {
            januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, mar: 3, maerz: 3,
            april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7,
            august: 8, aug: 8, september: 9, sep: 9, oktober: 10, okt: 10,
            november: 11, nov: 11, dezember: 12, dez: 12,
        };
        const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return 0;

        const sep = lines[0].includes(';') ? ';' : ',';
        const header = lines[0].split(sep).map(h => h.trim());
        const yearCols = [];
        header.forEach((h, i) => {
            if (i === 0) return;
            const ym = h.match(/(\d{4})/);
            if (ym) yearCols.push({ index: i, year: parseInt(ym[1]) });
        });
        if (!yearCols.length) throw new Error('CSV: keine Jahres-Spalten gefunden');

        if (mode === 'replace') this._monthlyYields.months = {};
        if (!this._monthlyYields.extraYears) this._monthlyYields.extraYears = [];
        yearCols.forEach(c => {
            if (!this._monthlyYields.extraYears.includes(c.year)) {
                this._monthlyYields.extraYears.push(c.year);
            }
        });
        this._monthlyYields.extraYears.sort((a, b) => a - b);

        let imported = 0;
        for (let li = 1; li < lines.length; li++) {
            const cols = lines[li].split(sep).map(c => c.trim());
            const monthKey = monthNames[cols[0].toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')];
            if (!monthKey) continue;
            yearCols.forEach(({ index, year }) => {
                const raw = cols[index];
                if (!raw) return;
                const n = Math.round(parseFloat(raw.replace(/\./g, '').replace(',', '.')));
                if (!n || n <= 0) return;
                const key = this._monthKey(year, monthKey);
                const existing = this._monthlyYields.months[key];
                if (mode === 'merge' && existing?.source === 'auto') return;
                this._monthlyYields.months[key] = {
                    wh       : n,
                    source   : 'manual',
                    updatedAt: new Date().toISOString(),
                };
                imported++;
            });
        }
        return imported;
    }

    _exportYieldsCsv() {
        const resp = this._buildYieldsApiResponse();
        const sep = ';';
        const header = ['Monat', ...resp.years.map(y => `${y} [Wh]`)].join(sep);
        const rows = resp.grid.map(row => {
            const vals = resp.years.map(y => {
                const wh = row.cells[y]?.wh;
                return wh > 0 ? String(wh) : '';
            });
            return [row.name, ...vals].join(sep);
        });
        const sum = ['Σ Jahr [Wh]', ...resp.years.map(y => resp.yearTotals[y] || '')].join(sep);
        return [header, ...rows, sum].join('\n');
    }

    _readPostBody(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', chunk => {
                data += chunk;
                if (data.length > 1e6) {
                    req.destroy();
                    reject(new Error('Request zu groß'));
                }
            });
            req.on('end', () => {
                try {
                    resolve(data ? JSON.parse(data) : {});
                } catch (e) {
                    reject(new Error('Ungültiges JSON'));
                }
            });
            req.on('error', reject);
        });
    }

    _getStringCount() {
        const fromData = parseInt(this._lastData['device.strings']);
        if (fromData === 2 || fromData === 3) return fromData;
        const model = (this._cfg.pikoModel || 'auto').toLowerCase();
        if (model.includes('5.5') || model.includes('10.1')) return 3;
        return 2;
    }

    _calcHistVal(row, def) {
        if (def.col === null) {
            if (def.id === 'history.ac.totalPower') {
                return row.ac1.power + row.ac2.power + row.ac3.power;
            }
            if (def.id === 'history.dc.totalPower') {
                return (row.dc1?.power || 0) + (row.dc2?.power || 0) + (row.dc3?.power || 0);
            }
            if (def.id === 'history.efficiency.ratio') {
                const dc = (row.dc1?.power || 0) + (row.dc2?.power || 0) + (row.dc3?.power || 0);
                const ac = row.acTotalPower || 0;
                if (dc < 50) return null;
                return Math.round(ac / dc * 1000) / 10;
            }
            return null;
        }
        const raw = row._raw[def.col];
        if (raw === null || raw === undefined) return null;
        return Math.round(raw * def.factor * 1000) / 1000;
    }

    // ─── Parser: LogDaten.dat ───────────────────────────────────────────────────

    _parseLogDaten(raw, pikoEpoch) {
        const lines = raw.split(/\r?\n/);
        const rows  = [];

        for (const line of lines) {
            if (!line.trim()) continue;
            const cols = line.split('\t').map(s => s.trim());
            const zeit = parseInt(cols[COL.ZEIT]);
            if (isNaN(zeit) || zeit < 1000) continue;

            // Ereigniszeile erkennen (enthält Hex-Code wie "80001200h")
            const isEvent = cols.some(c => /^[0-9a-fA-F]{4,}h$/.test(c));

            // Nur normale Messzeilen (mind. 38 Spalten mit Zahlen)
            if (!isEvent && cols.length < 38) continue;
            if (isEvent) continue; // Ereigniszeilen vorerst überspringen

            const ts  = (pikoEpoch + zeit) * 1000; // ms
            const raw_nums = cols.map(c => {
                const n = parseFloat(c);
                return isNaN(n) ? null : n;
            });

            const int = i => parseInt(cols[i]) || 0;
            const flt = i => parseFloat(cols[i]) || 0;

            rows.push({
                ts,
                date         : new Date(ts).toISOString(),
                _raw         : raw_nums,
                dc1: { voltage: int(COL.DC1_U), current: int(COL.DC1_I)/1000, power: int(COL.DC1_P), status: int(COL.DC1_S) },
                dc2: { voltage: int(COL.DC2_U), current: int(COL.DC2_I)/1000, power: int(COL.DC2_P), status: int(COL.DC2_S) },
                dc3: { voltage: int(COL.DC3_U), current: int(COL.DC3_I)/1000, power: int(COL.DC3_P), status: int(COL.DC3_S) },
                ac1: { voltage: int(COL.AC1_U), current: int(COL.AC1_I)/1000, power: int(COL.AC1_P) },
                ac2: { voltage: int(COL.AC2_U), current: int(COL.AC2_I)/1000, power: int(COL.AC2_P) },
                ac3: { voltage: int(COL.AC3_U), current: int(COL.AC3_I)/1000, power: int(COL.AC3_P) },
                frequency    : flt(COL.AC_F),
                acStatus     : int(COL.AC_S),
                errorCode    : int(COL.ERR),
                ensStatus    : int(COL.ENS_S),
                busStatus    : int(COL.KB_S),
                acTotalPower : int(COL.AC1_P) + int(COL.AC2_P) + int(COL.AC3_P),
                totalEnergy  : flt(COL.TOTAL_E),
            });
        }

        rows.sort((a, b) => a.ts - b.ts); // älteste zuerst
        return rows;
    }

    // ─── HTTP-Client ─────────────────────────────────────────────────────────────

    _fetchPage(path) {
        return new Promise((resolve, reject) => {
            const auth = Buffer.from(`${this._cfg.user}:${this._cfg.password}`).toString('base64');
            const req  = http.request({
                hostname: this._cfg.ip,
                port    : this._cfg.port,
                path,
                method  : 'GET',
                timeout : 15000,
                headers : {
                    'Authorization': `Basic ${auth}`,
                    'User-Agent'   : `ioBroker-KostalPiko/${ADAPTER_VERSION}`,
                },
            }, (res) => {
                let data = '';
                res.setEncoding('latin1'); // PIKO sendet windows-1252
                res.on('data', c => data += c);
                res.on('end', () => {
                    if (res.statusCode === 401) return reject(new Error('Auth fehlgeschlagen (401)'));
                    if (res.statusCode !== 200)  return reject(new Error(`HTTP ${res.statusCode} für ${path}`));
                    resolve(data);
                });
            });
            req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout für ${path}`)); });
            req.on('error',   e  => reject(e));
            req.end();
        });
    }

    // ─── Parser: Hauptseite (index.fhtml) ────────────────────────────────────────
    // HTML-Tabelle hat interleaved Struktur: String und L-Phase in DERSELBEN Zeile!
    // Korrekte Zellenreihenfolge:
    //   [0]=AC, [1]=GesamtE, [2]=TagE,
    //   [3]=S1U, [4]=L1U, [5]=S1I, [6]=L1P,   ← String+Phase in gleicher Zeile
    //   [7]=S2U, [8]=L2U, [9]=S2I, [10]=L2P,
    //   PIKO 8.3 (2 Strings): [11]=L3U, [12]=L3P
    //   PIKO 5.5 (3 Strings): [11]=S3U, [12]=L3U, [13]=S3I, [14]=L3P

    _parseMainPage(html) {
        // Alle bgcolor="#FFFFFF" Zellen in DOM-Reihenfolge sammeln (inkl. leere)
        const cells = [];
        const re    = /bgcolor="#FFFFFF">\s*([\s\S]*?)\s*<\/td>/gi;
        let m;
        while ((m = re.exec(html)) !== null) cells.push(m[1].trim());

        // Status lesen
        const statusMatch = html.match(/Status<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i);
        const status      = statusMatch ? statusMatch[1].trim() : null;

        // Offline: "x x x" in Messwert-Zellen (beide Modelle)
        const isXxx = (s) => /^x\s+x\s+x$/i.test(s || '');
        const isOff = !status || status.toLowerCase() === 'aus' || cells.some(c => isXxx(c));
        const isOn  = !isOff;

        // Modell-Name: aus Config-Override oder HTML lesen
        let modelName;
        if (this._cfg && this._cfg.pikoModel !== 'auto') {
            const modelMap = {
                'piko3.0':'PIKO 3.0','piko3.6':'PIKO 3.6','piko4.2':'PIKO 4.2',
                'piko5.5':'PIKO 5.5','piko7.0':'PIKO 7.0','piko8.3':'PIKO 8.3',
                'piko10.1':'PIKO 10.1',
            };
            modelName = modelMap[this._cfg.pikoModel] || 'PIKO';
        } else {
            const modelMatch = html.match(/<font[^>]*size="\+3"[^>]*>\s*([\w\s.]+)\s*<br/i) ||
                               html.match(/>(PIKO\s+[\d.]+)</i);
            modelName = modelMatch ? modelMatch[1].trim() : 'PIKO';
        }

        // Strings bestimmen: aus Config-Override oder Auto-Erkennung über Zellenanzahl
        //   13 Zellen = 2 Strings (PIKO 3.6/4.2/7.0/8.3)
        //   15 Zellen = 3 Strings (PIKO 5.5/10.1)
        const modelCfg   = this._cfg ? this._cfg.pikoModel : 'auto';
        const modelStr3  = ['piko5.5','piko10.1'].includes(modelCfg);
        const modelStr1  = modelCfg === 'piko3.0';
        const has3Strings = modelCfg === 'auto' ? cells.length >= 15 : modelStr3;

        // Messwert-Parser
        const toNum = (s) => {
            if (!s || isXxx(s) || s === '&nbsp;') return 0;
            const v = parseFloat(s.replace(',', '.'));
            return isNaN(v) ? 0 : v;
        };
        const toEnergy = (s) => {
            if (!s || isXxx(s)) return null;
            const v = parseFloat(s.replace(',', '.'));
            return isNaN(v) ? null : v;
        };

        const result = {
            status           : status || 'Aus',
            online           : isOn ? 1 : 0,
            'device.strings' : has3Strings ? 3 : 2,
            'device.model'   : modelName,
        };

        if (cells.length >= 10) {
            result['ac.power'] = isOn ? toNum(cells[0]) : 0;

            // Energie immer lesen (auch offline gültig)
            const eTot = toEnergy(cells[1]);
            const eDay = toEnergy(cells[2]);
            if (eTot !== null) result['energy.total'] = eTot;
            if (eDay !== null) result['energy.today'] = eDay;

            // INTERLEAVED: String und L-Phase in gleicher HTML-Tabellenzeile
            // cells[3]=S1U, cells[4]=L1U, cells[5]=S1I, cells[6]=L1P
            // cells[7]=S2U, cells[8]=L2U, cells[9]=S2I, cells[10]=L2P
            result['pv.string1.voltage'] = isOn ? toNum(cells[3])  : 0;
            result['ac.l1.voltage']      = isOn ? toNum(cells[4])  : 0;
            result['pv.string1.current'] = isOn ? toNum(cells[5])  : 0;
            result['ac.l1.power']        = isOn ? toNum(cells[6])  : 0;
            result['pv.string2.voltage'] = isOn ? toNum(cells[7])  : 0;
            result['ac.l2.voltage']      = isOn ? toNum(cells[8])  : 0;
            result['pv.string2.current'] = isOn ? toNum(cells[9])  : 0;
            result['ac.l2.power']        = isOn ? toNum(cells[10]) : 0;

            if (has3Strings) {
                // PIKO 5.5: cells[11]=S3U, cells[12]=L3U, cells[13]=S3I, cells[14]=L3P
                result['pv.string3.voltage'] = isOn ? toNum(cells[11]) : 0;
                result['ac.l3.voltage']      = isOn && cells.length > 12 ? toNum(cells[12]) : 0;
                result['pv.string3.current'] = isOn && cells.length > 13 ? toNum(cells[13]) : 0;
                result['ac.l3.power']        = isOn && cells.length > 14 ? toNum(cells[14]) : 0;
            } else {
                // PIKO 8.3: cells[11]=L3U, cells[12]=L3P (keine String3-Zeile)
                result['ac.l3.voltage'] = isOn && cells.length > 11 ? toNum(cells[11]) : 0;
                result['ac.l3.power']   = isOn && cells.length > 12 ? toNum(cells[12]) : 0;
            }
        }

        const busM = html.match(/name="[^"]*[Aa]dr[^"]*"[^>]*value="(\d+)"/i);
        if (busM) result['rs485.busAddress'] = parseInt(busM[1]);
        return result;
    }

    // ─── Parser: Infoseite (Inf.fhtml) ───────────────────────────────────────────

    _parseInfoPage(html) {
        const r = {};
        const re = /(\d+)\.\s+analoger\s+Eingang:\s*<b>([\d.,]+)V<\/b>/gi;
        let m;
        while ((m = re.exec(html)) !== null) r[`info.analog${m[1]}`] = parseFloat(m[2].replace(',','.'));
        const mm = html.match(/Modemstatus:\s*<b>([^<]+)<\/b>/i);
        if (mm) r['info.modemStatus'] = mm[1].trim();
        const pm = html.match(/letzte\s+Verbindung\s+zum\s+Portal:\s*<b>([^<]+)<\/b>/i);
        if (pm) r['info.lastPortalConnection'] = pm[1].trim();
        const sm = html.match(/Anzahl\s+der\s+Energiepulse[^:]*:\s*<b>(\d+)<\/b>/i);
        if (sm) r['info.s0Pulses'] = parseInt(sm[1]);
        return r;
    }

    _getModuleParams() {
        let wp   = this._cfg.moduleWp;
        let voc  = this._cfg.moduleVoc;
        let vmpp = this._cfg.moduleVmpp;
        const preset = MODULE_PRESETS[this._cfg.modulePreset];
        if (preset) {
            if (!wp)   wp   = preset.wp;
            if (!voc)  voc  = preset.voc;
            if (!vmpp) vmpp = preset.vmpp;
        }
        if (!vmpp && voc) vmpp = Math.round(voc * VMPP_VOC_RATIO * 100) / 100;
        const vmppNoct = preset?.vmppNoct || (vmpp ? Math.round(vmpp * 0.898 * 100) / 100 : 0);
        return { wp, voc, vmpp, vmppNoct, presetName: preset?.name || null };
    }

    _getStringAnalysisConfig() {
        const { wp, voc, vmpp, vmppNoct } = this._getModuleParams();
        if (!voc || !wp || !vmpp) return { enabled: false, strings: [] };
        const inv = this._getInverterSpecs();
        const strings = [];
        for (const s of [
            { id: 1, count: this._cfg.string1Modules },
            { id: 2, count: this._cfg.string2Modules },
            { id: 3, count: this._cfg.string3Modules },
        ]) {
            if (!s.count) continue;
            const vocString  = voc * s.count;
            const mppStc     = vmpp * s.count;
            const mppTypical = vmppNoct * s.count; // typische Betriebsspannung warm
            strings.push({
                id              : s.id,
                modules         : s.count,
                expectedVoltage : Math.round(vocString * 10) / 10,
                expectedMpp     : Math.round(mppStc * 10) / 10,
                expectedPower   : wp * s.count,
                vmppPerModule   : vmpp,
                mppMin          : Math.round(mppTypical * 0.88 * 10) / 10,
                mppMax          : Math.round(mppStc * 1.06 * 10) / 10,
                invDcMaxV       : inv.enabled ? inv.dcMaxV : null,
                invDcMinV       : inv.enabled ? inv.dcMinV : null,
                invMppMin       : inv.enabled ? inv.mppMinActive : null,
                invMppMax       : inv.enabled ? inv.mppMax : null,
                invDcMaxA       : inv.enabled ? inv.dcMaxA : null,
            });
        }
        return { enabled: strings.length > 0, strings, vmpp, voc, preset: this._cfg.modulePreset, inverter: inv };
    }

    // ─── Modul-Analyse: Soll-Werte berechnen ────────────────────────────────────────

    async _writeModuleStates() {
        const { wp, voc, vmpp } = this._getModuleParams();
        if (!voc || !wp || !vmpp) return;

        const strings = [
            { id: '1', count: this._cfg.string1Modules },
            { id: '2', count: this._cfg.string2Modules },
            { id: '3', count: this._cfg.string3Modules },
        ];

        for (const s of strings) {
            if (!s.count) continue;
            const expectedVoc = Math.round(voc * s.count * 10) / 10;
            const expectedMpp = Math.round(vmpp * s.count * 10) / 10;
            const expectedPower = wp * s.count;
            await this.setStateAsync(`string${s.id}.expectedVoltage`,
                { val: expectedMpp, ack: true });
            await this.setStateAsync(`string${s.id}.expectedVoc`,
                { val: expectedVoc, ack: true });
            await this.setStateAsync(`string${s.id}.expectedPower`,
                { val: expectedPower, ack: true });
        }
    }

    // ─── Benachrichtigungen ─────────────────────────────────────────────────────

    _startNotifyTimer() {
        if (this._notifyTimer) clearInterval(this._notifyTimer);
        // Jede Minute prüfen ob ein Bericht fällig ist
        this._notifyTimer = setInterval(() => this._checkNotify(), 60 * 1000);
        this._log('SYSTEM', 'Benachrichtigungs-Timer gestartet');
    }

    _checkNotify() {
        if (!this._cfg.notifyEnabled) return;
        const now  = new Date();
        const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const dow  = now.getDay();  // 0=So, 1=Mo
        const dom  = now.getDate(); // 1–31

        // Tagesbericht
        if (this._cfg.notifyDaily && hhmm === this._cfg.notifyDailyTime) {
            if (this._lastNotifySent !== `daily-${now.toDateString()}`) {
                this._lastNotifySent = `daily-${now.toDateString()}`;
                this._sendDailyReport().catch(e => this._log('WARN', `Tagesbericht: ${e.message}`));
            }
        }
        // Wochenbericht (Montag)
        if (this._cfg.notifyWeekly && dow === 1 && hhmm === this._cfg.notifyWeeklyTime) {
            if (this._lastNotifySent !== `weekly-${now.toDateString()}`) {
                this._lastNotifySent = `weekly-${now.toDateString()}`;
                this._sendWeeklyReport().catch(e => this._log('WARN', `Wochenbericht: ${e.message}`));
            }
        }
        // Monatsbericht (1. des Monats)
        if (this._cfg.notifyMonthly && dom === 1 && hhmm === this._cfg.notifyMonthlyTime) {
            if (this._lastNotifySent !== `monthly-${now.toDateString()}`) {
                this._lastNotifySent = `monthly-${now.toDateString()}`;
                this._sendMonthlyReport().catch(e => this._log('WARN', `Monatsbericht: ${e.message}`));
            }
        }
        // Alarm
        if (this._cfg.notifyAlert && hhmm === this._cfg.notifyAlertTime) {
            if (this._lastNotifySent !== `alert-${now.toDateString()}`) {
                this._lastNotifySent = `alert-${now.toDateString()}`;
                this._checkDayAlert().catch(e => this._log('WARN', `Alarm-Check: ${e.message}`));
            }
        }
    }

    _getRowsForDate(date) {
        // Alle History-Rows für ein bestimmtes Datum
        const start = new Date(date); start.setHours(0,0,0,0);
        const end   = new Date(date); end.setHours(23,59,59,999);
        return this._lastHistoryRows.filter(r => {
            const ts = new Date(r.date).getTime();
            return ts >= start.getTime() && ts <= end.getTime();
        });
    }

    _getPreviousCalendarWeek() {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const thisMonday = new Date(today);
        thisMonday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
        const prevMonday = new Date(thisMonday);
        prevMonday.setDate(thisMonday.getDate() - 7);
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(prevMonday);
            d.setDate(prevMonday.getDate() + i);
            days.push(d);
        }
        return { days, weekNum: this._isoWeek(prevMonday), start: prevMonday };
    }

    _getInstalledKwp() {
        const { moduleWp, string1Modules, string2Modules, string3Modules } = this._cfg;
        if (!moduleWp) return 0;
        const modules = (string1Modules || 0) + (string2Modules || 0) + (string3Modules || 0);
        return modules > 0 ? (moduleWp * modules) / 1000 : 0;
    }

    _formatDuration(minutes) {
        if (!minutes) return '0 min';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h} h ${m} min` : `${m} min`;
    }

    _formatKwpLine(kwh, kwp) {
        if (!kwp) return '';
        return `📐 Spez. Ertrag: ${(kwh / kwp).toFixed(2)} kWh/kWp (Anlage: ${kwp.toFixed(2)} kWp)\n`;
    }

    _sparkline(values) {
        // Unicode-Sparkline aus Werten: ▁▂▃▄▅▆▇█
        const blocks = ['▁','▂','▃','▄','▅','▆','▇','█'];
        const max = Math.max(...values) || 1;
        return values.map(v => blocks[Math.min(7, Math.floor(v / max * 8))]).join('');
    }

    _calcDailyKwhFromPower(rows) {
        if (!rows.length) return 0;
        const totalWh = rows.reduce((sum, r) => sum + (r.acTotalPower || 0) * 0.25, 0);
        return Math.round(totalWh) / 1000;
    }

    _calcDailyKwh(rows) {
        if (!rows.length) return 0;
        const sorted = this._dedupeHistoryRows(rows);
        const powerKwh = this._calcDailyKwhFromPower(sorted);
        const withEnergy = sorted.filter(r => r.totalEnergy > 0);
        if (withEnergy.length >= 2) {
            const delta = withEnergy[withEnergy.length - 1].totalEnergy - withEnergy[0].totalEnergy;
            const maxKwh = Math.min(150, Math.max(powerKwh * 1.25, 8));
            if (delta > 0 && delta <= maxKwh) {
                return Math.round(delta * 100) / 100;
            }
        }
        return powerKwh;
    }

    _calcDayStats(rows) {
        if (!rows.length) return null;
        const sorted = [...rows].sort((a, b) => a.ts - b.ts);
        const kwh = this._calcDailyKwh(sorted);
        const peakRow = sorted.reduce((best, r) => (r.acTotalPower > best.acTotalPower ? r : best), sorted[0]);
        const producing = sorted.filter(r => r.acTotalPower >= 50);
        const maxDc = Math.max(...sorted.map(r =>
            (r.dc1?.power || 0) + (r.dc2?.power || 0) + (r.dc3?.power || 0)
        ));
        const errors = sorted.filter(r => r.errorCode && r.errorCode !== 0);
        const errorCodes = [...new Set(errors.map(r => r.errorCode))];
        const avgW = producing.length
            ? Math.round(producing.reduce((s, r) => s + r.acTotalPower, 0) / producing.length)
            : 0;
        const firstProd = producing.length ? new Date(producing[0].ts) : null;
        const lastProd  = producing.length ? new Date(producing[producing.length - 1].ts) : null;

        return {
            kwh,
            maxW: peakRow.acTotalPower,
            peakTime: new Date(peakRow.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
            prodMinutes: producing.length * 15,
            firstProd,
            lastProd,
            maxDc,
            avgW,
            errorCodes,
            dataPoints: sorted.length,
        };
    }

    _barForKwh(kwh, scale = 5) {
        if (!kwh) return '–';
        return '▓'.repeat(Math.min(20, Math.round(kwh / scale))) || '▁';
    }

    async _sendNotify(text, subject) {
        return new Promise((resolve) => {
            const inst = this._cfg.notifyInstance;
            const adp  = this._cfg.notifyAdapter;
            const recipient = this._cfg.notifyRecipient;
            const mailSubject = subject || 'Kostal PIKO Bericht';
            let payload;
            if (adp === 'telegram') {
                payload = recipient
                    ? { text, user: recipient }
                    : { text };
            } else if (adp === 'email') {
                payload = {
                    to: recipient || undefined,
                    subject: mailSubject,
                    text,
                };
            } else if (adp === 'pushover') {
                payload = { message: text, title: mailSubject };
            } else {
                payload = { text };
            }
            this.sendTo(inst, 'send', payload, (result) => {
                if (result && result.error) {
                    this._log('WARN', `Benachrichtigung fehlgeschlagen (${inst}): ${result.error}`);
                } else {
                    this._log('INFO', `Benachrichtigung gesendet via ${inst}`);
                }
                resolve();
            });
        });
    }

    async _sendDailyReport() {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        const rows = this._getRowsForDate(yesterday);
        const dateStr = yesterday.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
        const model   = this._lastData['device.model'] || 'PIKO';
        const kwp     = this._getInstalledKwp();
        const subject = `Kostal PIKO – Tagesbericht ${dateStr}`;

        if (!rows.length) {
            await this._sendNotify(
                `☀️ Kostal PIKO (${model}) – Tagesbericht\n📅 ${dateStr}\n\n⚠️ Keine Historiendaten vorhanden.\n` +
                `Bitte „Historiendaten laden“ aktivieren und Sync-Intervall prüfen.`,
                subject
            );
            return;
        }

        const stats = this._calcDayStats(rows);
        const hourly = [];
        for (let h = 0; h < 24; h++) {
            const hr = rows.filter(r => new Date(r.date).getHours() === h);
            hourly.push(hr.length ? Math.max(...hr.map(r => r.acTotalPower)) : 0);
        }
        const spark  = this._sparkline(hourly.filter((_, i) => i >= 5 && i <= 21));
        const webUrl = `http://${this._cfg.ip}:${this._cfg.webPort}/`;
        const prodWindow = stats.firstProd && stats.lastProd
            ? `${stats.firstProd.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}–` +
              `${stats.lastProd.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
            : '–';

        const lines = [
            `☀️ Kostal PIKO (${model}) – Tagesbericht`,
            `📅 ${dateStr}`,
            ``,
            `⚡ Tagesertrag:       ${stats.kwh.toFixed(2)} kWh`,
            this._formatKwpLine(stats.kwh, kwp).trimEnd(),
            `📈 Spitzenleistung:   ${stats.maxW} W (um ${stats.peakTime})`,
            `🔆 DC-Spitze:         ${stats.maxDc} W`,
            `⏱️ Erzeugungszeit:    ${this._formatDuration(stats.prodMinutes)} (${prodWindow})`,
            `📊 Ø-Leistung (Tag):  ${stats.avgW} W`,
            `📡 Messpunkte:        ${stats.dataPoints} (15-min)`,
        ].filter(Boolean);

        if (stats.errorCodes.length) {
            lines.push(`⚠️ Fehlercodes:       ${stats.errorCodes.join(', ')}`);
        }

        lines.push(
            ``,
            `Leistungskurve AC (5–21 Uhr):`,
            spark,
            ``,
            `🔗 Dashboard: ${webUrl}`
        );

        await this._sendNotify(lines.join('\n'), subject);
        this._log('INFO', `Tagesbericht gesendet: ${stats.kwh.toFixed(2)} kWh`);
    }

    async _sendWeeklyReport() {
        const { days, weekNum, start } = this._getPreviousCalendarWeek();
        const model = this._lastData['device.model'] || 'PIKO';
        const kwp   = this._getInstalledKwp();
        const rangeStr = `${start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ` +
            `${days[6].toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
        const subject = `Kostal PIKO – Wochenbericht KW ${weekNum}`;

        const dayStats = days.map(date => ({
            date,
            rows: this._getRowsForDate(date),
            stats: null,
        }));
        dayStats.forEach(d => { d.stats = d.rows.length ? this._calcDayStats(d.rows) : null; });

        let totalKwh = 0;
        let bestDay = null;
        let worstDay = null;
        let peakW = 0;
        let daysWithData = 0;

        const lines = [
            `📅 Kostal PIKO (${model}) – Wochenbericht`,
            `KW ${weekNum} (${rangeStr})`,
            ``,
        ];

        for (const d of dayStats) {
            const kwh = d.stats ? d.stats.kwh : 0;
            totalKwh += kwh;
            if (d.rows.length) daysWithData++;
            if (d.stats && d.stats.maxW > peakW) peakW = d.stats.maxW;
            if (d.stats && kwh > 0) {
                if (!bestDay || kwh > bestDay.kwh) bestDay = { date: d.date, kwh };
                if (!worstDay || kwh < worstDay.kwh) worstDay = { date: d.date, kwh };
            }
            const label = d.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            const bar   = d.rows.length ? this._barForKwh(kwh) : '–';
            lines.push(`${label}  ${bar}  ${kwh.toFixed(1)} kWh`);
        }

        const avgKwh = daysWithData ? totalKwh / daysWithData : 0;
        lines.push(
            ``,
            `📊 Wochensumme:     ${totalKwh.toFixed(1)} kWh`,
            `📊 Ø pro Tag:       ${avgKwh.toFixed(1)} kWh (${daysWithData} Tage mit Daten)`,
        );
        if (kwp) lines.push(`📐 Spez. Ertrag:    ${(totalKwh / kwp).toFixed(1)} kWh/kWp`);
        if (bestDay) {
            lines.push(`🏆 Bester Tag:      ${bestDay.kwh.toFixed(1)} kWh (${bestDay.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })})`);
        }
        if (worstDay && worstDay.kwh < (bestDay?.kwh || Infinity)) {
            lines.push(`📉 Schwächster Tag: ${worstDay.kwh.toFixed(1)} kWh (${worstDay.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })})`);
        }
        if (peakW) lines.push(`📈 Wochenspitze:    ${peakW} W`);

        await this._sendNotify(lines.join('\n'), subject);
        this._log('INFO', `Wochenbericht gesendet: ${totalKwh.toFixed(1)} kWh (KW ${weekNum})`);
    }

    async _sendMonthlyReport() {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const daysInMonth = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
        const monthName = lastMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
        const model = this._lastData['device.model'] || 'PIKO';
        const kwp   = this._getInstalledKwp();
        const subject = `Kostal PIKO – Monatsbericht ${monthName}`;

        const lines = [`📅 Kostal PIKO (${model}) – Monatsbericht ${monthName}`, ``];
        let totalKwh = 0;
        let daysWithYield = 0;
        let daysWithData = 0;
        let bestDay = null;
        let worstDay = null;
        let peakW = 0;

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), d);
            const rows = this._getRowsForDate(date);
            const stats = rows.length ? this._calcDayStats(rows) : null;
            const kwh = stats ? stats.kwh : 0;
            totalKwh += kwh;
            if (rows.length) daysWithData++;
            if (kwh > 0.1) daysWithYield++;
            if (stats && stats.maxW > peakW) peakW = stats.maxW;
            if (stats && kwh > 0) {
                if (!bestDay || kwh > bestDay.kwh) bestDay = { date, kwh };
                if (!worstDay || kwh < worstDay.kwh) worstDay = { date, kwh };
            }
            if (kwh > 0 || rows.length > 0) {
                const label = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit' });
                const bar   = this._barForKwh(kwh);
                lines.push(`${label}  ${bar}  ${kwh.toFixed(1)} kWh`);
            }
        }

        const avgKwh = daysWithYield ? totalKwh / daysWithYield : 0;
        lines.push(
            ``,
            `📊 Monatssumme:     ${totalKwh.toFixed(1)} kWh`,
            `📊 Ø pro Ertragstag: ${avgKwh.toFixed(1)} kWh (${daysWithYield} von ${daysInMonth} Tagen)`,
        );
        if (kwp) lines.push(`📐 Spez. Ertrag:    ${(totalKwh / kwp).toFixed(1)} kWh/kWp`);
        if (bestDay) {
            lines.push(`🏆 Bester Tag:      ${bestDay.kwh.toFixed(1)} kWh (${bestDay.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })})`);
        }
        if (worstDay && daysWithYield > 1) {
            lines.push(`📉 Schwächster Tag: ${worstDay.kwh.toFixed(1)} kWh (${worstDay.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })})`);
        }
        if (peakW) lines.push(`📈 Monatsspitze:    ${peakW} W`);
        if (daysWithData < daysInMonth) {
            lines.push(`⚠️ Datenlücken:     ${daysInMonth - daysWithData} Tage ohne Messdaten`);
        }

        await this._sendNotify(lines.join('\n'), subject);
        this._log('INFO', `Monatsbericht gesendet: ${totalKwh.toFixed(1)} kWh (${monthName})`);
    }

    async _checkDayAlert() {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        const rows   = this._getRowsForDate(yesterday);
        const stats  = rows.length ? this._calcDayStats(rows) : null;
        const kwh    = stats ? stats.kwh : 0;
        const thr    = this._cfg.notifyThresholdKwh;
        const dateStr = yesterday.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
        const model  = this._lastData['device.model'] || 'PIKO';
        const subject = `Kostal PIKO – Alarm ${dateStr}`;

        const alerts = [];
        if (!rows.length) alerts.push('⚠️ Keine Historiendaten empfangen');
        else if (thr > 0 && kwh < thr) alerts.push(`⚠️ Ertrag ${kwh.toFixed(2)} kWh unter Schwellwert ${thr} kWh`);
        if (stats?.errorCodes?.length) alerts.push(`⚠️ Fehlercodes im Tagesverlauf: ${stats.errorCodes.join(', ')}`);

        if (alerts.length) {
            const lines = [
                `🔔 Kostal PIKO (${model}) – Alarm`,
                `📅 ${dateStr}`,
                ``,
                ...alerts,
            ];
            if (stats) {
                lines.push(
                    ``,
                    `Tagesertrag: ${kwh.toFixed(2)} kWh`,
                    `Spitzenleistung: ${stats.maxW} W`,
                    `Messpunkte: ${stats.dataPoints}`,
                );
            }
            await this._sendNotify(lines.join('\n'), subject);
            this._log('WARN', `Alarm gesendet: ${alerts.join(', ')}`);
        }
    }

    _isoWeek(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    // ─── States anlegen ──────────────────────────────────────────────────────────

    async _ensureBaseStates() {
        const defs = [
            { id:'info.connection',           type:'boolean', role:'indicator.connected', name:'Verbunden',                   def:false },
            { id:'info.networkMode',          type:'string',  role:'text',               name:'Netzwerk-Modus (local/fritzwireguard)', def:'local' },
            { id:'info.lastPoll',             type:'string',  role:'date',                name:'Letzter Poll',                def:'' },
            { id:'status',                    type:'string',  role:'text',                name:'Betriebsstatus',              def:'Unbekannt' },
            { id:'online',                    type:'number',  role:'value',               name:'Online (1=ja, 0=nein)',       def:0 },
            { id:'ac.power',                  type:'number',  role:'value.power.active',  name:'AC-Leistung aktuell',         def:0, unit:'W' },
            { id:'ac.l1.voltage',             type:'number',  role:'value.voltage',       name:'L1 Spannung',                 def:0, unit:'V' },
            { id:'ac.l1.power',               type:'number',  role:'value.power.active',  name:'L1 Leistung',                 def:0, unit:'W' },
            { id:'ac.l2.voltage',             type:'number',  role:'value.voltage',       name:'L2 Spannung',                 def:0, unit:'V' },
            { id:'ac.l2.power',               type:'number',  role:'value.power.active',  name:'L2 Leistung',                 def:0, unit:'W' },
            { id:'ac.l3.voltage',             type:'number',  role:'value.voltage',       name:'L3 Spannung',                 def:0, unit:'V' },
            { id:'ac.l3.power',               type:'number',  role:'value.power.active',  name:'L3 Leistung',                 def:0, unit:'W' },
            { id:'energy.total',              type:'number',  role:'value.energy',        name:'Gesamtenergie',               def:0, unit:'kWh' },
            { id:'energy.today',              type:'number',  role:'value.energy',        name:'Tagesenergie',                def:0, unit:'kWh' },
            { id:'pv.string1.voltage',        type:'number',  role:'value.voltage',       name:'String 1 Spannung',           def:0, unit:'V' },
            { id:'pv.string1.current',        type:'number',  role:'value.current',       name:'String 1 Strom',             def:0, unit:'A' },
            { id:'pv.string2.voltage',        type:'number',  role:'value.voltage',       name:'String 2 Spannung',           def:0, unit:'V' },
            { id:'pv.string2.current',        type:'number',  role:'value.current',       name:'String 2 Strom',             def:0, unit:'A' },
            { id:'pv.string3.voltage',        type:'number',  role:'value.voltage',       name:'String 3 Spannung',           def:0, unit:'V' },
            { id:'pv.string3.current',        type:'number',  role:'value.current',       name:'String 3 Strom',             def:0, unit:'A' },
            { id:'device.strings',            type:'number',  role:'value',               name:'Anzahl PV-Strings (2 oder 3)', def:2 },
            { id:'device.model',              type:'string',  role:'text',                name:'Modell (PIKO 8.3 / PIKO 5.5)',  def:'' },
            { id:'info.analog1',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 1',          def:0, unit:'V' },
            { id:'info.analog2',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 2',          def:0, unit:'V' },
            { id:'info.analog3',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 3',          def:0, unit:'V' },
            { id:'info.analog4',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 4',          def:0, unit:'V' },
            { id:'info.modemStatus',          type:'string',  role:'text',                name:'Modemstatus',                 def:'' },
            { id:'info.lastPortalConnection', type:'string',  role:'text',                name:'Letzte Portal-Verbindung',    def:'' },
            { id:'info.s0Pulses',             type:'number',  role:'value',               name:'S0-Energiepulse',             def:0 },
            { id:'rs485.busAddress',          type:'number',  role:'value',               name:'RS485 Bus-Adresse',           def:255 },
            // Berechnete Soll-Werte (aus Modul-Konfiguration)
            { id:'string1.expectedVoltage',   type:'number',  role:'value.voltage',       name:'String 1 Soll-Mpp-Spannung',  def:0, unit:'V' },
            { id:'string1.expectedVoc',       type:'number',  role:'value.voltage',       name:'String 1 Soll-Voc',           def:0, unit:'V' },
            { id:'string2.expectedVoltage',   type:'number',  role:'value.voltage',       name:'String 2 Soll-Mpp-Spannung',  def:0, unit:'V' },
            { id:'string2.expectedVoc',       type:'number',  role:'value.voltage',       name:'String 2 Soll-Voc',           def:0, unit:'V' },
            { id:'string3.expectedVoltage',   type:'number',  role:'value.voltage',       name:'String 3 Soll-Mpp-Spannung',  def:0, unit:'V' },
            { id:'string3.expectedVoc',       type:'number',  role:'value.voltage',       name:'String 3 Soll-Voc',           def:0, unit:'V' },
            { id:'string1.expectedPower',     type:'number',  role:'value.power',         name:'String 1 Soll-Leistung',      def:0, unit:'Wp' },
            { id:'string2.expectedPower',     type:'number',  role:'value.power',         name:'String 2 Soll-Leistung',      def:0, unit:'Wp' },
            { id:'string3.expectedPower',     type:'number',  role:'value.power',         name:'String 3 Soll-Leistung',      def:0, unit:'Wp' },
            { id:'dc.totalPower',             type:'number',  role:'value.power.active',  name:'DC-Gesamtleistung (berechnet)', def:0, unit:'W' },
            { id:'efficiency.ratio',          type:'number',  role:'value',               name:'Wirkungsgrad DC\u2192AC',     def:0, unit:'%' },
            { id:'efficiency.expected',       type:'number',  role:'value',               name:'Soll-Wirkungsgrad (temp.-korr.)', def:97, unit:'%' },
            { id:'weather.sunshineHours',     type:'number',  role:'value',               name:'Sonnenstunden heute (Prognose)', def:0, unit:'h' },
            { id:'weather.tempMax',           type:'number',  role:'value.temperature',   name:'Max.-Temperatur heute',       def:0, unit:'\u00b0C' },
            { id:'weather.cloudCover',        type:'number',  role:'value',               name:'Bew\u00f6lkung heute (7\u201319h)', def:0, unit:'%' },
            { id:'weather.precipitation',     type:'number',  role:'value',               name:'Niederschlag heute',          def:0, unit:'mm' },
            { id:'weather.description',       type:'string',  role:'weather.forecast.0',  name:'Wetter heute (Text)',         def:'' },
            { id:'weather.plz',               type:'string',  role:'text',                name:'Wetter-PLZ',                  def:'' },
            { id:'weather.place',             type:'string',  role:'text',                name:'Wetter-Ort',                  def:'' },
            { id:'weather.updatedAt',         type:'string',  role:'date',                name:'Wetter letzte Aktualisierung', def:'' },
        ];
        for (const d of defs) {
            const obj = { type:'state', common:{ name:d.name, type:d.type, role:d.role, read:true, write:false }, native:{} };
            if (d.unit !== undefined) obj.common.unit = d.unit;
            if (d.def  !== undefined) obj.common.def  = d.def;
            await this.setObjectNotExistsAsync(d.id, obj);
            this._nodes[d.id] = { ...obj.common };
        }
    }

    async _ensureHistoryStates() {
        // Meta-States (History-Status)
        const meta = [
            { id:'history.lastImport',     type:'string',  role:'date',  name:'Letzter History-Import',           def:'' },
            { id:'history.lastImportedTs', type:'number',  role:'value', name:'Letzter importierter Timestamp ms', def:0 },
            { id:'history.recordCount',    type:'number',  role:'value', name:'History-Datenpunkte gesamt',        def:0 },
            { id:'history.newRecords',     type:'number',  role:'value', name:'Neue Punkte (letzter Import)',      def:0 },
            { id:'history.oldestRecord',   type:'string',  role:'date',  name:'\u00c4ltester History-Eintrag',    def:'' },
            { id:'history.newestRecord',   type:'string',  role:'date',  name:'Neuester History-Eintrag',         def:'' },
            { id:'history.influxSent',     type:'number',  role:'value', name:'An InfluxDB gesendete Punkte',     def:0 },
            { id:'history.pikoEpoch',      type:'string',  role:'date',  name:'PIKO Inbetriebnahme-Datum',        def:'' },
        ];
        for (const d of meta) {
            await this.setObjectNotExistsAsync(d.id, {
                type:'state', common:{ name:d.name, type:d.type, role:d.role, read:true, write:false, def:d.def }, native:{},
            });
            this._nodes[d.id] = { name:d.name, type:d.type, role:d.role };
        }

        // Messwert-States für InfluxDB
        for (const def of HISTORY_STATES) {
            await this.setObjectNotExistsAsync(def.id, {
                type:'state',
                common:{
                    name : def.name,
                    type : 'number',
                    role : 'value',
                    read : true,
                    write: false,
                    unit : def.unit,
                    // Hinweis für InfluxDB-Adapter-Config (erscheint in ioBroker Admin)
                    desc : 'History-State: enthält historische ts-Werte f\u00fcr InfluxDB',
                },
                native:{},
            });
            this._nodes[def.id] = { name:def.name, type:'number', unit:def.unit };
        }
    }

    async _writeStates(data, opts = {}) {
        const merged = opts.skipDerived ? { ...data } : { ...data, ...this._calcDerivedStates({ ...this._lastData, ...data }) };
        const ts = Date.now();
        for (const [key, val] of Object.entries(merged)) {
            if (val === null || val === undefined) continue;
            try { await this.setStateAsync(key, { val, ack:true, ts }); } catch (_) {}
        }
        this._lastData = { ...this._lastData, ...merged, _ts: new Date().toISOString() };
        this._syncLiveToInflux(merged).catch(e => {
            if (this._cfg.verbose) this._log('WARN', `Live Influx-Sync: ${e.message}`);
        });
    }

    // ─── Web-Server ──────────────────────────────────────────────────────────────

    _startWebServer() {
        const port = this._cfg.webPort;
        this._webServer = http.createServer((req, res) => {
            const p = url.parse(req.url, true).pathname;

            if (p === '/api/data') {
                return this._json(res, {
                    data           : this._lastData,
                    nodes          : this._nodes,
                    stringAnalysis : this._getStringAnalysisConfig(),
                    inverterSpecs  : this._getInverterSpecs(),
                    weather        : this._lastWeather,
                    ts             : new Date().toISOString(),
                });
            }
            if (p === '/api/history') {
                // Alle Zeilen senden – Filterung/Limitierung passiert im Browser
                const rows = [...this._lastHistoryRows].reverse();
                const newest = this._lastHistoryRows.length
                    ? this._lastHistoryRows[this._lastHistoryRows.length - 1].date
                    : null;
                return this._json(res, {
                    rows,
                    pikoEpoch      : this._pikoEpoch ? new Date(this._pikoEpoch * 1000).toISOString() : null,
                    recordCount    : this._lastHistoryRows.length,
                    lastImported   : this._lastImportIso,
                    newestRecord   : newest,
                    loading        : this._historyLoading || false,
                    stringAnalysis : this._getStringAnalysisConfig(),
                    stringCount    : this._getStringCount(),
                    fromCache      : this._historyLoading && this._lastHistoryRows.length > 0,
                });
            }
            if (p === '/api/logs')   return this._json(res, { logs: this._logBuffer });
            if (p === '/api/status') return this._json(res, {
                adapter        : ADAPTER_NAME,
                version        : ADAPTER_VERSION,
                ip             : this._cfg.ip,
                port           : this._cfg.port,
                interval       : this._cfg.pollInterval,
                online         : this._lastData.online === 1,
                historyEnable  : this._cfg.historyFetch,
                syncInterval   : this._cfg.syncInterval,
                influxEnable   : this._cfg.influxEnable,
                influxInst     : this._cfg.influxInstance,
                pikoEpoch      : this._pikoEpoch ? new Date(this._pikoEpoch * 1000).toISOString() : null,
                lastImported   : this._lastImportIso,
            });
            if (p === '/api/trigger-history') {
                this._lastHistoryFetch = 0;
                this._fetchAndImportHistory(false).catch(e => this._log('ERROR', `Sync: ${e.message}`));
                return this._json(res, { ok:true, message:'Sync gestartet (nur neue Datenpunkte)' });
            }
            if (p === '/api/sync-all') {
                // Vollsync: Cursor zurücksetzen → alle ~6 Monate an InfluxDB
                this._fetchAndImportHistory(true).catch(e => this._log('ERROR', `Vollsync: ${e.message}`));
                return this._json(res, { ok:true, message:'Vollsync gestartet – alle Datenpunkte werden übertragen' });
            }
            if (p === '/api/yields' && req.method === 'GET') {
                return this._json(res, this._buildYieldsApiResponse());
            }
            if (p === '/api/yields/export' && req.method === 'GET') {
                const fmt = (url.parse(req.url, true).query || {}).format || 'json';
                if (fmt === 'csv') {
                    const csv = this._exportYieldsCsv();
                    res.writeHead(200, {
                        'Content-Type'       : 'text/csv; charset=utf-8',
                        'Content-Disposition': `attachment; filename="kostalpiko-${this.namespace}-ertrag.csv"`,
                    });
                    return res.end('\uFEFF' + csv);
                }
                const payload = {
                    ...this._monthlyYields,
                    exportedAt: new Date().toISOString(),
                    namespace : this.namespace,
                };
                res.writeHead(200, {
                    'Content-Type'       : 'application/json; charset=utf-8',
                    'Content-Disposition': `attachment; filename="kostalpiko-${this.namespace}-ertrag.json"`,
                });
                return res.end(JSON.stringify(payload, null, 2));
            }
            if (p === '/api/yields' && req.method === 'POST') {
                return this._readPostBody(req).then(async body => {
                    try {
                        const result = await this._handleYieldsPost(body);
                        return this._json(res, { ...result, data: this._buildYieldsApiResponse() });
                    } catch (e) {
                        res.writeHead(400, { 'Content-Type':'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ ok: false, error: e.message }));
                    }
                }).catch(e => {
                    res.writeHead(400, { 'Content-Type':'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            }
            if (p === '/api/ping') return this._json(res, { ok:true, adapter:ADAPTER_NAME, version:ADAPTER_VERSION });
            if (p === '/app.js') {
                res.writeHead(200, { 'Content-Type':'application/javascript; charset=utf-8' });
                return res.end(APP_JS_CODE);
            }

            res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
            res.end(WEB_UI_HTML.replace(/__VERSION__/g, ADAPTER_VERSION));
        });

        this._webServer.listen(port, () => this._log('SYSTEM', `Web-UI: http://0.0.0.0:${port}/`));
        this._webServer.on('error', e => this._log('ERROR', `Web-Server: ${e.message}`));
    }

    _json(res, obj) {
        res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' });
        res.end(JSON.stringify(obj, null, 2));
    }

    // ─── Logger ──────────────────────────────────────────────────────────────────

    _log(level, message) {
        const entry = { ts:new Date().toISOString(), level, message };
        this._logBuffer.unshift(entry);
        if (this._logBuffer.length > this._maxLogs) this._logBuffer.pop();
        switch (level) {
            case 'ERROR': this.log.error(message); break;
            case 'WARN':  this.log.warn(message);  break;
            case 'DEBUG': this.log.debug(message); break;
            default:      this.log.info(message);  break;
        }
    }
}

// ─── Web-UI ───────────────────────────────────────────────────────────────────
const WEB_UI_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kostal PIKO &ndash; ioBroker</title>
<style>
:root{--bg:#0d1117;--bg2:#161b22;--bg3:#1c2128;--bd:#30363d;--acc:#f6c90e;--grn:#3fb950;--red:#f85149;--blu:#58a6ff;--orn:#e3b341;--txt:#e6edf3;--mut:#8b949e;--r:8px;--f:'Segoe UI',system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font-family:var(--f);min-height:100vh}
header{background:var(--bg2);border-bottom:1px solid var(--bd);padding:12px 22px;display:flex;align-items:center;gap:14px}
.logo{width:34px;height:34px;background:var(--acc);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.lt{font-size:16px;font-weight:700}.ls{font-size:11px;color:var(--mut)}
.vb{margin-left:auto;background:var(--bg3);border:1px solid var(--bd);border-radius:20px;padding:3px 11px;font-size:12px;color:var(--mut)}
.sd{width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;margin-right:5px;transition:background .4s}
.sd.on{background:var(--grn)}
nav{background:var(--bg2);border-bottom:1px solid var(--bd);display:flex;padding:0 18px;gap:2px}
nav button{background:none;border:none;cursor:pointer;color:var(--mut);padding:10px 15px;font-size:13px;font-family:var(--f);border-bottom:2px solid transparent;transition:color .2s,border-color .2s}
nav button:hover{color:var(--txt)}nav button.act{color:var(--acc);border-bottom-color:var(--acc)}
main{padding:18px;max-width:1300px;margin:0 auto}
.tc{display:none}.tc.act{display:block}
.card{background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);padding:16px;margin-bottom:12px}
.ct{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);margin-bottom:12px;display:flex;align-items:center;gap:6px}
.dot{width:5px;height:5px;border-radius:50%;background:var(--acc);flex-shrink:0}
.grid{display:grid;gap:9px}
.g2{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.g3{grid-template-columns:repeat(auto-fill,minmax(175px,1fr))}
.g4{grid-template-columns:repeat(auto-fill,minmax(145px,1fr))}
.vc{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:13px;display:flex;flex-direction:column;gap:3px}
.vl{font-size:11px;color:var(--mut)}.vv{font-size:21px;font-weight:700}.vu{font-size:11px;color:var(--mut)}
.vc.a .vv{color:var(--acc)}.vc.g .vv{color:var(--grn)}.vc.b .vv{color:var(--blu)}.vc.o .vv{color:var(--orn)}
.sb{display:inline-flex;align-items:center;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;background:rgba(248,81,73,.12);color:var(--red);border:1px solid rgba(248,81,73,.3)}
.sb.on{background:rgba(63,185,80,.12);color:var(--grn);border-color:rgba(63,185,80,.3)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:6px 8px;color:var(--mut);border-bottom:1px solid var(--bd);font-weight:600;white-space:nowrap}
td{padding:6px 8px;border-bottom:1px solid rgba(48,54,61,.5)}
tr:hover td{background:rgba(255,255,255,.02)}
.badge{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600}
.bn{background:rgba(88,166,255,.12);color:var(--blu)}.bs{background:rgba(246,201,14,.12);color:var(--acc)}.bb{background:rgba(63,185,80,.12);color:var(--grn)}
.lw{background:#0d1117;border:1px solid var(--bd);border-radius:var(--r);padding:10px;max-height:460px;overflow-y:auto;font-family:Consolas,monospace;font-size:12px}
.le{padding:2px 0;display:flex;gap:7px}.lts{color:var(--mut);flex-shrink:0}.llv{font-weight:700;flex-shrink:0;min-width:54px}.lm{color:var(--txt)}
.lERROR{color:var(--red)}.lWARN{color:var(--orn)}.lINFO{color:var(--blu)}.lSYSTEM{color:var(--grn)}.lDEBUG{color:var(--mut)}
.tb{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px;align-items:center}
.tb select,.tb button{background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:5px 10px;border-radius:var(--r);font-size:12px;cursor:pointer}
.tb button:hover{background:var(--bd)}.tb label{font-size:12px;color:var(--mut);display:flex;align-items:center;gap:5px}
.sr{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)}
.sr:last-child{border:none}.sk{font-size:13px;color:var(--mut)}.sv{font-size:13px;font-weight:600}
.btn{padding:6px 14px;border-radius:var(--r);border:1px solid var(--bd);background:var(--bg3);color:var(--txt);font-size:13px;cursor:pointer;transition:background .2s}
.btn:hover{background:var(--bd)}.btn.a{background:var(--acc);color:#000;border-color:var(--acc);font-weight:700}.btn.a:hover{filter:brightness(1.1)}
.chip{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.ck{background:rgba(63,185,80,.14);color:var(--grn)}.ce{background:rgba(248,81,73,.14);color:var(--red)}
.muted{font-size:11px;color:var(--mut)}
.hc{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:10px;margin-bottom:12px}
.hct{font-size:11px;color:var(--mut);margin-bottom:6px}
.sp{width:100%;height:56px;display:block}
.sp-big{width:100%;height:110px;display:block}
.nav-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px}
.nav-btn{background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:5px 12px;border-radius:var(--r);font-size:14px;cursor:pointer;font-family:var(--f)}
.nav-btn:hover{background:var(--bd)}
.nav-btn.active{background:var(--acc);color:#000;border-color:var(--acc);font-weight:700}
.nav-seg{display:flex;gap:3px}
.nav-date{font-size:13px;font-weight:600;color:var(--txt);min-width:150px;text-align:center}
.ir{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px}
.ii .il{font-size:10px;color:var(--mut)}.ii .iv{font-weight:600;font-size:13px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:12px}
.kpi{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:10px 12px}
.kpi .kl{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.4px}
.kpi .kv{font-size:18px;font-weight:700;margin-top:2px}
.kpi .ks{font-size:10px;color:var(--mut);margin-top:2px}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;margin-bottom:12px}
.chart-box{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:12px;position:relative;min-height:220px}
.chart-box.wide{grid-column:1/-1;min-height:280px}
.chart-title{font-size:11px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.chart-wrap{position:relative;height:200px}
.chart-box.wide .chart-wrap{height:250px}
.chart-legend{display:flex;flex-wrap:wrap;gap:8px;font-size:10px;color:var(--mut)}
.legend-item{display:flex;align-items:center;gap:4px}
.legend-dot{width:8px;height:8px;border-radius:2px;display:inline-block}
.tbl-wrap{max-height:420px;overflow:auto;border:1px solid var(--bd);border-radius:var(--r)}
.tbl-wrap thead th{position:sticky;top:0;background:var(--bg2);z-index:1}
.cache-hint{font-size:11px;color:var(--orn);margin-top:6px}
.yield-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}
.yield-toolbar label{font-size:11px;color:var(--mut);display:flex;flex-direction:column;gap:3px}
.yield-toolbar input,.yield-toolbar select{background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:5px 8px;border-radius:var(--r);font-size:12px;min-width:90px}
.yield-grid-wrap{overflow:auto;max-height:70vh;border:1px solid var(--bd);border-radius:var(--r)}
.yield-grid{border-collapse:collapse;font-size:11px;min-width:100%}
.yield-grid th,.yield-grid td{padding:5px 7px;border:1px solid rgba(48,54,61,.6);text-align:right;white-space:nowrap}
.yield-grid th{background:var(--bg2);color:var(--mut);position:sticky;top:0;z-index:2}
.yield-grid th.ymonth,.yield-grid td.ymonth{position:sticky;left:0;background:var(--bg2);text-align:left;z-index:1;font-weight:600}
.yield-grid th.ymonth{z-index:3}
.yield-grid td.ymonth{color:var(--mut)}
.yield-grid td.editable{cursor:pointer}
.yield-grid td.editable:hover{outline:1px solid var(--acc)}
.yield-grid td.manual{color:var(--blu)}
.yield-grid td.auto{color:var(--txt)}
.yield-grid td.above{background:rgba(63,185,80,.12)}
.yield-grid td.below{background:rgba(248,81,73,.10)}
.yield-grid td.is-min{font-weight:700;color:var(--red)}
.yield-grid td.is-max{font-weight:700;color:var(--grn)}
.yield-grid tr.sum-row td{background:var(--bg3);font-weight:600}
.yield-grid tr.sum-row td.ymonth{color:var(--acc)}
.yield-edit{background:var(--bg);border:1px solid var(--acc);color:var(--txt);width:80px;padding:2px 4px;font-size:11px;border-radius:4px}
.yield-years{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.yield-years label{font-size:11px;color:var(--mut);display:flex;align-items:center;gap:4px;cursor:pointer;padding:3px 8px;background:var(--bg3);border:1px solid var(--bd);border-radius:12px}
.yield-years label.on{border-color:var(--acc);color:var(--acc)}
.yield-years input{margin:0}
.yield-path{font-family:Consolas,monospace;font-size:10px;color:var(--blu);word-break:break-all}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
</head>
<body>
<header>
  <div class="logo">&#9728;</div>
  <div><div class="lt">Kostal PIKO</div><div class="ls">ioBroker Adapter v__VERSION__</div></div>
  <div class="vb" id="hVer">v__VERSION__</div>
  <div style="margin-left:10px;display:flex;align-items:center;font-size:13px">
    <span class="sd" id="sdot"></span><span id="stxt">Lade...</span>
  </div>
</header>

<nav id="tabs">
  <button class="act" onclick="showTab('daten')">&#9889; Daten</button>
  <button onclick="showTab('history')">&#128200; Historie</button>
  <button onclick="showTab('yields')">&#128202; Ertrag</button>
  <button onclick="showTab('nodes')">&#127760; Nodes</button>
  <button onclick="showTab('logs')">&#128196; Logs</button>
  <button onclick="showTab('system')">&#9881; System</button>
</nav>

<main>

<!-- DATEN -->
<div class="tc act" id="tab-daten">
  <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:9px">
    <span class="muted" id="lUpd">--</span>
    <button class="btn" onclick="loadData()" style="padding:3px 9px;font-size:12px">&#8635;</button>
  </div>
  <div class="card" style="display:flex;align-items:center;gap:16px;padding:13px 16px">
    <div><div class="muted" style="margin-bottom:4px">Betriebsstatus</div><span class="sb" id="sBadge">--</span></div>
    <div style="margin-left:auto;text-align:right"><div class="muted">Modell</div><div style="font-weight:600" id="d-model">--</div></div>
  </div>
  <div class="card" id="weather-card" style="display:none">
    <div class="ct"><span class="dot"></span>Wetter &amp; Sonne heute <span class="muted" id="w-loc" style="font-weight:400;text-transform:none"></span></div>
    <div class="grid g4" id="w-grid">
      <div class="vc g"><div class="vl">Erwartete Sonnenstunden</div><div class="vv" id="w-sun">--</div><div class="vu">h (heute)</div></div>
      <div class="vc"><div class="vl">Wetter</div><div class="vv" id="w-desc" style="font-size:15px">--</div><div class="vu" id="w-temp">--</div></div>
      <div class="vc"><div class="vl">Bew&ouml;lkung (7&ndash;19 Uhr)</div><div class="vv" id="w-cloud">--</div><div class="vu">% im Mittel</div></div>
      <div class="vc"><div class="vl">Niederschlag</div><div class="vv" id="w-rain">--</div><div class="vu">mm (heute)</div></div>
    </div>
    <div class="muted" style="font-size:10px;margin-top:8px" id="w-src">Quelle: Open-Meteo · PLZ in Admin-Einstellungen</div>
  </div>
  <div class="card">
    <div class="ct"><span class="dot"></span>AC-Leistung &amp; Energie</div>
    <div class="grid g3">
      <div class="vc a"><div class="vl">AC-Leistung</div><div class="vv" id="d-acp">--</div><div class="vu">W</div></div>
      <div class="vc g"><div class="vl">Gesamtenergie</div><div class="vv" id="d-etot">--</div><div class="vu">kWh</div></div>
      <div class="vc b"><div class="vl">Tagesenergie</div><div class="vv" id="d-eday">--</div><div class="vu">kWh</div></div>
      <div class="vc"><div class="vl">DC-Leistung</div><div class="vv" id="d-dcp">--</div><div class="vu">W</div></div>
      <div class="vc"><div class="vl">Wirkungsgrad</div><div class="vv" id="d-eff">--</div><div class="vu" id="d-eff-hint">DC &rarr; AC</div></div>
    </div>
  </div>
  <div class="card">
    <div class="ct"><span class="dot"></span>PV-Generator</div>
    <div class="grid g4">
      <div class="vc"><div class="vl">String 1 &ndash; Spannung</div><div class="vv" id="d-s1v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">String 1 &ndash; Strom</div><div class="vv" id="d-s1a">--</div><div class="vu">A</div></div>
      <div class="vc"><div class="vl">String 2 &ndash; Spannung</div><div class="vv" id="d-s2v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">String 2 &ndash; Strom</div><div class="vv" id="d-s2a">--</div><div class="vu">A</div></div>
      <div class="vc" id="card-s3v" style="display:none"><div class="vl">String 3 &ndash; Spannung</div><div class="vv" id="d-s3v">--</div><div class="vu">V</div></div>
      <div class="vc" id="card-s3a" style="display:none"><div class="vl">String 3 &ndash; Strom</div><div class="vv" id="d-s3a">--</div><div class="vu">A</div></div>
    </div>
  </div>
  <!-- String-Analyse (nur sichtbar wenn Modul-Konfig gesetzt) -->
  <div class="card" id="inv-specs-card" style="display:none">
    <div class="ct"><span class="dot"></span>Wechselrichter-Grenzwerte (Kostal-Datenblatt)</div>
    <div id="inv-specs-body"></div>
  </div>
  <div class="card" id="sa-card" style="display:none">
    <div class="ct"><span class="dot"></span>String-Analyse (Soll vs. Ist)</div>
    <div class="grid g3">
      <div class="vc" id="sa-1" style="display:none"></div>
      <div class="vc" id="sa-2" style="display:none"></div>
      <div class="vc" id="sa-3" style="display:none"></div>
    </div>
    <div style="font-size:10px;color:var(--mut);margin-top:8px">
      Soll-MPP = Vmpp &times; Modulanzahl. Voc (Leerlauf) ist deutlich h&ouml;her und nur als Referenz.
    </div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Ausgangsleistung L1 / L2 / L3</div>
    <div class="grid g3">
      <div class="vc"><div class="vl">L1 Spannung</div><div class="vv" id="d-l1v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">L1 Leistung</div><div class="vv" id="d-l1p">--</div><div class="vu">W</div></div>
      <div class="vc"><div class="vl">L2 Spannung</div><div class="vv" id="d-l2v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">L2 Leistung</div><div class="vv" id="d-l2p">--</div><div class="vu">W</div></div>
      <div class="vc"><div class="vl">L3 Spannung</div><div class="vv" id="d-l3v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">L3 Leistung</div><div class="vv" id="d-l3p">--</div><div class="vu">W</div></div>
    </div>
  </div>
  <div class="card">
    <div class="ct"><span class="dot"></span>Info &amp; Analoge Eing&auml;nge</div>
    <div class="grid g4">
      <div class="vc"><div class="vl">Analoger Eingang 1</div><div class="vv" id="d-a1">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">Analoger Eingang 2</div><div class="vv" id="d-a2">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">Analoger Eingang 3</div><div class="vv" id="d-a3">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">Analoger Eingang 4</div><div class="vv" id="d-a4">--</div><div class="vu">V</div></div>
    </div>
    <div class="ir">
      <div class="ii"><div class="il">Modemstatus</div><div class="iv" id="d-modem">--</div></div>
      <div class="ii"><div class="il">Portal</div><div class="iv" id="d-portal">--</div></div>
      <div class="ii"><div class="il">S0-Pulse</div><div class="iv" id="d-s0">--</div></div>
    </div>
  </div>
</div>

<!-- HISTORY -->
<div class="tc" id="tab-history">
  <div class="card" style="padding:13px 16px">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:14px">
      <div><div class="muted" style="font-size:10px">Datenpunkte</div><div style="font-weight:700;font-size:20px" id="h-cnt">--</div></div>
      <div><div class="muted" style="font-size:10px">Zeitraum</div><div style="font-size:13px;font-weight:600" id="h-rng">--</div></div>
      <div><div class="muted" style="font-size:10px">PIKO in Betrieb seit</div><div style="font-size:13px;font-weight:600" id="h-ep">--</div></div>
      <div><div class="muted" style="font-size:10px">Letzter Import</div><div style="font-size:13px;font-weight:600" id="h-li">--</div></div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn" onclick="loadHistory(true)" title="Anzeige aus Server-Speicher neu laden (kein PIKO-Abruf)">&#8635; Anzeige aktualisieren</button>
        <button class="btn" onclick="triggerSync()" title="LogDaten.dat vom Wechselrichter holen und neue Punkte importieren">&#8595; Vom PIKO laden</button>
        <button class="btn a" onclick="confirmSyncAll()" title="Gesamte Historie an InfluxDB senden (Cursor zur&uuml;cksetzen)">&#9733; Sync-All</button>
      </div>
    </div>
    <div id="histSyncMsg" style="margin-top:8px;font-size:11px;color:var(--mut)"></div>
    <div style="margin-top:6px;font-size:10px;color:var(--mut);line-height:1.5">
      <strong>Anzeige aktualisieren</strong> = nur Darstellung neu laden &middot;
      <strong>Vom PIKO laden</strong> = LogDaten.dat vom Wechselrichter abrufen &middot;
      <strong>Sync-All</strong> = alle Punkte an InfluxDB (nur wenn aktiviert)
    </div>
  </div>

  <!-- String-Analyse für gewählten Zeitraum -->
  <div class="card" id="hsa-card" style="display:none">
    <div class="ct"><span class="dot"></span>String-Analyse (gew&auml;hlter Zeitraum)</div>
    <div class="grid g3" id="hsa-grid"></div>
    <div style="font-size:10px;color:var(--mut);margin-top:8px">
      MPP-Korridor basiert auf Vmpp (Betriebsspannung unter Last), nicht Voc. Gr&uuml;n = im Korridor, Orange = grenzwertig, Rot = au&szlig;erhalb. MPP-Min/Max im Datenblatt = Nennleistungsbereich, kein Sicherheitsalarm.
    </div>
  </div>

  <!-- KPI-Leiste -->
  <div class="kpi-grid" id="hist-kpi">
    <div class="kpi"><div class="kl">Spitzenleistung</div><div class="kv" id="kpi-peak">--</div><div class="ks" id="kpi-peak-t">--</div></div>
    <div class="kpi"><div class="kl">Ertrag (Zeitraum)</div><div class="kv" id="kpi-yield" style="color:var(--grn)">--</div><div class="ks">kWh</div></div>
    <div class="kpi"><div class="kl">&Oslash; Leistung (Tag)</div><div class="kv" id="kpi-avg">--</div><div class="ks">W bei Erzeugung</div></div>
    <div class="kpi"><div class="kl">DC-Spitze</div><div class="kv" id="kpi-dc">--</div><div class="ks">W Summe Strings</div></div>
    <div class="kpi"><div class="kl">Messpunkte</div><div class="kv" id="kpi-pts">--</div><div class="ks">15-min Intervalle</div></div>
    <div class="kpi"><div class="kl">Z&auml;hlerstand</div><div class="kv" id="kpi-energy" style="color:var(--blu)">--</div><div class="ks">kWh Gesamt</div></div>
  </div>
  <div id="cache-hint" class="cache-hint" style="display:none"></div>

  <!-- Navigationsleiste -->
  <div class="card" style="padding:10px 14px;margin-bottom:10px">
    <div class="nav-bar">
      <button class="nav-btn" onclick="navShift(-1)" title="Vorheriger Zeitraum">&#8592;</button>
      <span class="nav-date" id="nav-label">--</span>
      <button class="nav-btn" onclick="navShift(1)" title="N\u00e4chster Zeitraum" id="nav-next">&#8594;</button>
      <div class="nav-seg">
        <button class="nav-btn" id="nb-day"   onclick="navMode('day')">Tag</button>
        <button class="nav-btn" id="nb-week"  onclick="navMode('week')">Woche</button>
        <button class="nav-btn" id="nb-month" onclick="navMode('month')">Monat</button>
      </div>
    </div>
  </div>

  <!-- Charts (Chart.js) -->
  <div class="chart-grid">
    <div class="chart-box wide">
      <div class="chart-title"><span id="chart-main-title">Leistung &amp; Erzeugung</span><span class="chart-legend" id="leg-main"></span></div>
      <div class="chart-wrap"><canvas id="chart-main"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>Phasenleistung L1/L2/L3</span></div>
      <div class="chart-wrap"><canvas id="chart-phases"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>PV-String Leistung</span></div>
      <div class="chart-wrap"><canvas id="chart-dc-power"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>String-Spannungen</span></div>
      <div class="chart-wrap"><canvas id="chart-dc-voltage"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>Netz &amp; Frequenz</span></div>
      <div class="chart-wrap"><canvas id="chart-grid"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>Energie-Z&auml;hler (kWh)</span></div>
      <div class="chart-wrap"><canvas id="chart-energy"></canvas></div>
    </div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Messwerte des gew&auml;hlten Zeitraums (neueste zuerst)</div>
    <div class="tbl-wrap">
    <table>
      <thead><tr>
        <th>Zeitpunkt</th><th>AC [W]</th>
        <th>DC1 U</th><th>DC1 I</th><th>DC1 P</th>
        <th>DC2 U</th><th>DC2 I</th><th>DC2 P</th>
        <th id="th-dc3-1">DC3 U</th><th id="th-dc3-2">DC3 I</th><th id="th-dc3-3">DC3 P</th>
        <th>L1 U</th><th>L1 P</th><th>L2 U</th><th>L2 P</th><th>L3 U</th><th>L3 P</th>
        <th>Hz</th><th>kWh</th><th>St</th><th>Err</th>
      </tr></thead>
      <tbody id="hTb"><tr><td colspan="22" style="color:var(--mut);text-align:center;padding:18px">Kein History-Import &ndash; History in den Einstellungen aktivieren</td></tr></tbody>
    </table>
    </div>
  </div>
</div>

<!-- ERTRAG -->
<div class="tc" id="tab-yields">
  <div class="card" style="padding:13px 16px">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:14px">
      <div><div class="muted" style="font-size:10px">Gesamtertrag</div><div style="font-weight:700;font-size:20px" id="y-total-kwh">--</div></div>
      <div><div class="muted" style="font-size:10px">Gesamt &euro;</div><div style="font-weight:700;font-size:20px;color:var(--grn)" id="y-total-eur">--</div></div>
      <div><div class="muted" style="font-size:10px">Erfasste Monate</div><div style="font-size:13px;font-weight:600" id="y-month-cnt">--</div></div>
      <div><div class="muted" style="font-size:10px">Inbetriebnahme</div><div style="font-size:13px;font-weight:600" id="y-epoch">--</div></div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="loadYields()" title="Tabelle neu laden">&#8635; Aktualisieren</button>
        <button class="btn" onclick="refreshYieldsAuto()" title="Monate aus dem lokalen History-Cache berechnen (nicht vom PIKO)">&#9889; Aus Cache</button>
        <button class="btn" onclick="rebuildYieldsFromHistory()" title="Jahre ab 05/2018 auff&uuml;llen und alle Monate aus History-Cache neu berechnen">&#128202; Neu ab 05/2018</button>
        <button class="btn" onclick="restoreYieldsBackup()" title="monthly-yields.json.bak wiederherstellen">&#9851; Backup</button>
        <button class="btn" onclick="clearYieldsAuto()" title="Automatisch berechnete Monatswerte entfernen">&#128465; Auto l&ouml;schen</button>
        <button class="btn" onclick="addYieldYear()" title="Leere Jahres-Spalte hinzuf&uuml;gen">&#43; Jahr</button>
        <button class="btn" onclick="fillYieldYears()" title="Alle Jahre von Inbetriebnahme bis heute">&#128197; Jahre auff&uuml;llen</button>
        <button class="btn" onclick="exportYields('json')" title="JSON-Backup herunterladen">&#8595; JSON</button>
        <button class="btn" onclick="exportYields('csv')" title="CSV f&uuml;r Excel">&#8595; CSV</button>
        <button class="btn" onclick="document.getElementById('y-import-file').click()" title="JSON oder CSV importieren">&#8593; Import</button>
        <button class="btn a" onclick="saveYieldSettings()" title="Verg&uuml;tung und kWp speichern">&#10003; Einstellungen</button>
      </div>
    </div>
    <input type="file" id="y-import-file" accept=".json,.csv,.txt" style="display:none" onchange="importYieldsFile(this)">
    <div id="yieldMsg" style="margin-top:8px;font-size:11px;color:var(--mut)"></div>
    <div style="margin-top:6px;font-size:10px;color:var(--mut)">
      <strong>Speicherort:</strong> <span class="yield-path" id="y-storage">–</span>
      <span id="y-history-range" style="display:block;margin-top:4px"></span>
    </div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Einstellungen &amp; Vergleich</div>
    <div class="yield-toolbar">
      <label>Verg&uuml;tung [&euro;/kWh]
        <input type="text" id="y-tariff" value="0,3925" title="Einspeiseverg&uuml;tung in Euro pro kWh">
      </label>
      <label>Installierte Leistung [kWp]
        <input type="text" id="y-kwp" placeholder="auto" title="Leer = aus Modul-Konfiguration">
      </label>
      <label>Postleitzahl
        <input type="text" id="y-plz" maxlength="5" placeholder="87781" title="5-stellige PLZ (Wetter + regionaler Vergleich)">
      </label>
    </div>
    <div style="font-size:10px;color:var(--mut);line-height:1.6;margin-bottom:8px">
      <strong>Regel:</strong> Leere Zellen werden aus dem History-Cache berechnet (wei&szlig;). Deine Eingabe (blau) hat immer Vorrang &ndash; auch bei „Aus Cache“ oder automatischem Sync.
      Zelle leeren (Inhalt l&ouml;schen + Enter) = wieder automatisch aus Historie f&uuml;llbar.
      <strong>Aus Cache</strong> = Server-Speicher (history-cache.json), <em>nicht</em> direkt vom Wechselrichter &middot; neue Rohdaten: Historie-Tab &rarr; „Vom PIKO laden“.
      Gr&uuml;n/Rot = &uuml;ber/unter dem Durchschnitt aller Jahre f&uuml;r diesen Monat.
      <strong>+ Jahr</strong> = leere Spalte f&uuml;r Vorjahre &middot; <strong>Import/Export</strong> = Backup oder Excel-Migration.
      Regionale Referenz: <a href="https://ertragsdatenbank.de/auswertung/region.html" target="_blank" rel="noopener" style="color:var(--blu)">ertragsdatenbank.de</a>
    </div>
    <div class="kpi-grid" id="y-kpi"></div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Monatsertr&auml;ge [Wh] &ndash; Jahre als Spalten</div>
    <div class="yield-grid-wrap">
      <table class="yield-grid" id="y-grid">
        <thead><tr><th class="ymonth">Monat</th></tr></thead>
        <tbody><tr><td class="ymonth" style="color:var(--mut)">Lade...</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Jahresvergleich (Balkendiagramm)</div>
    <div class="nav-bar" style="margin-bottom:10px">
      <div class="nav-seg">
        <button class="nav-btn active" id="ych-mwh" onclick="setYieldChartUnit('mwh')">MWh</button>
        <button class="nav-btn" id="ych-kwh" onclick="setYieldChartUnit('kwhkwp')">kWh/kWp</button>
      </div>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="nav-btn" onclick="selectAllChartYears(true)">Alle</button>
        <button class="nav-btn" onclick="selectAllChartYears(false)">Keine</button>
        <button class="nav-btn" onclick="selectRecentChartYears(3)">Letzte 3</button>
      </div>
    </div>
    <div class="yield-years" id="y-chart-years"></div>
    <div class="chart-box wide" style="min-height:320px">
      <div class="chart-title"><span>Monatsvergleich nach Jahren</span></div>
      <div class="chart-wrap" style="height:280px"><canvas id="chart-yields"></canvas></div>
    </div>
  </div>
</div>

<!-- NODES -->
<div class="tc" id="tab-nodes">
  <div class="card">
    <div class="ct"><span class="dot"></span>ioBroker Datenpunkte</div>
    <table><thead><tr><th>State-ID</th><th>Name</th><th>Typ</th><th>Wert</th><th>Einheit</th></tr></thead>
    <tbody id="nTb"><tr><td colspan="5" style="color:var(--mut);text-align:center;padding:16px">Lade...</td></tr></tbody></table>
  </div>
</div>

<!-- LOGS -->
<div class="tc" id="tab-logs">
  <div class="tb">
    <label>Level:<select id="lvlF" onchange="renderLogs()">
      <option value="">Alle</option><option>SYSTEM</option><option>INFO</option><option>WARN</option><option>ERROR</option><option>DEBUG</option>
    </select></label>
    <label><input type="checkbox" id="aScrl" checked> Auto-Scroll</label>
    <button class="btn" onclick="loadLogs()">&#8635; Aktualisieren</button>
    <button class="btn" onclick="allLogs=[];document.getElementById('lWrap').innerHTML=''">&#128465; L&ouml;schen</button>
  </div>
  <div class="lw" id="lWrap"></div>
</div>

<!-- SYSTEM -->
<div class="tc" id="tab-system">
  <div class="card"><div class="ct"><span class="dot"></span>Adapter-Info</div><div id="sysInfo">Lade...</div></div>
  <div class="card"><div class="ct"><span class="dot"></span>History &amp; InfluxDB-Sync</div><div id="sysHist">Lade...</div></div>

  <div class="card" style="border-color:var(--acc)">
    <div class="ct"><span class="dot"></span>Sync-Aktionen</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <button class="btn" onclick="triggerSync()" id="btnSync">&#8635; Neue Punkte synchronisieren</button>
      <button class="btn" style="border-color:var(--acc);color:var(--acc)" onclick="confirmSyncAll()" id="btnSyncAll">&#9733; Sync-All (gesamte Historie)</button>
      <button class="btn" onclick="loadData()">&#8635; Live-Daten neu laden</button>
    </div>
    <div id="syncMsg" style="margin-top:10px;font-size:12px;color:var(--mut)"></div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Wo werden InfluxDB-Verbindungsdaten konfiguriert?</div>
    <div style="font-size:13px;line-height:1.75;color:var(--mut)">
      <p>Die Verbindung zum InfluxDB-Server <strong style="color:var(--txt)">(Host, Port, Datenbank, Token)</strong> wird <strong style="color:var(--txt)">nicht hier</strong> eingetragen, sondern im:</p>
      <p style="margin-top:6px;padding:8px 12px;background:var(--bg3);border-radius:var(--r);border:1px solid var(--bd);font-family:monospace;color:var(--blu)">ioBroker Admin &rarr; Adapter &rarr; InfluxDB &rarr; Instanz konfigurieren</p>
      <p style="margin-top:8px">Dieser Adapter kennt nur den <strong style="color:var(--txt)">Namen der Instanz</strong> (z.&nbsp;B. <code>influxdb.0</code>) und schickt die Daten per internem <code>sendTo()</code>-Aufruf dorthin. Die Instanz leitet sie dann mit dem korrekten historischen Zeitstempel an InfluxDB weiter.</p>
    </div>
  </div>
</div>

</main>
<script src="/app.js"></script>
</body>
</html>`;

if (require.main !== module) {
    module.exports = (options) => new KostalPikoAdapter(options);
} else {
    new KostalPikoAdapter();
}
// app.js wird aus admin/app.js geladen
const APP_JS_CODE = fs.readFileSync(path.join(__dirname, 'admin', 'app.js'), 'utf-8');


