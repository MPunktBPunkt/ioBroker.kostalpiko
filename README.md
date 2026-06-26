# ioBroker Kostal PIKO Adapter

[![Version](https://img.shields.io/badge/version-0.6.0-blue.svg)](https://github.com/MPunktBPunkt/iobroker.kostalpiko/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](./LICENSE)
[![Donate](https://img.shields.io/badge/Donate-PayPal-00457C.svg?logo=paypal)](https://www.paypal.com/donate/?business=martin%40bchmnn.de&currency_code=EUR)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](https://nodejs.org)

Liest Echtzeit- und Historiendaten vom **Kostal PIKO Solarwechselrichter** direkt über den eingebauten HTTP-Webserver. Messwerte werden als ioBroker-Datenpunkte bereitgestellt; optional synchronisiert der Adapter 15-Minuten-Historie und Live-Werte mit **InfluxDB** (für Grafana).

---

## Features

| Bereich | Funktion |
|---|---|
| **Live-Daten** | AC/DC-Leistung, String-Spannungen & Ströme, Phasen, Energie, Status |
| **Historie** | LogDaten.dat (~6 Monate, 15-min), Chart.js-Dashboard, lokaler Cache |
| **Ertrag** | Monatstabelle (Jahre × Monate), manuelle Historie, €/kWh, Export/Import |
| **Wetter** | Sonnenstunden, Temperatur, Bewölkung, Niederschlag (Open-Meteo, PLZ-basiert) |
| **Analyse** | Wirkungsgrad DC→AC, String-Analyse, Kostal-Datenblatt-Grenzwerte |
| **InfluxDB** | Live **und** History mit korrektem Zeitstempel via `sendTo()` |
| **Web-UI** | 6 Tabs: Daten, Historie, Ertrag, Nodes, Logs, System |
| **Multi-Instanz** | Mehrere PIKOs parallel (z. B. `kostalpiko.0` + `kostalpiko.1`) |
| **Benachrichtigungen** | Tages-/Wochen-/Monatsberichte per E-Mail, Telegram, Pushover |

---

## Getestete Hardware

| Modell | Strings | Status |
|---|---|---|
| PIKO 3.0 – 4.2 | 1–2 | Unterstützt |
| PIKO 5.5 | 3 | ✅ Getestet |
| PIKO 7.0 – 8.3 | 2 | ✅ Getestet (8.3) |
| PIKO 10.1 | 3 | Unterstützt |

Firmware: ver 3.62 · PIKO-Modell in den Einstellungen wählbar oder Auto-Erkennung.

---

## Installation & Update

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kostalpiko
iobroker add kostalpiko          # nur bei Erstinstallation
iobroker update kostalpiko       # Update
iobroker restart kostalpiko
```

**GitHub-Release:** [Releases](https://github.com/MPunktBPunkt/iobroker.kostalpiko/releases)

---

## Web-UI

```
http://IOBROKER-IP:8092/
```

| Tab | Inhalt |
|---|---|
| ⚡ **Daten** | Live-Werte, Wetter & Sonne, String-Analyse, Wirkungsgrad |
| 📈 **Historie** | KPIs, interaktive Charts, 15-min-Tabelle |
| 📊 **Ertrag** | Langzeit-Monatstabelle, Jahresvergleich, Import/Export |
| 🌐 **Nodes** | Alle ioBroker-Datenpunkte |
| 📄 **Logs** | Adapter-Log mit Filter |
| ⚙️ **System** | Sync-Status, InfluxDB-Aktionen |

### Ertrag-Tab (Langzeitauswertung)

Ersatz für die Excel-Tabelle – persistent gespeichert in:

```
/opt/iobroker/iobroker-data/kostalpiko.0/monthly-yields.json
```

![Ertrag-Tab – Monatstabelle und Jahresvergleich](docs/screenshots/screenshot-ertrag.png)

- **Spalten** = Jahre, **Zeilen** = Monate (Wh) + Σ Jahr, €/Jahr, kWh/kWp
- **Manuelle Eingabe** – historische Monate per Klick (seit Inbetriebnahme)
- **Automatisch** – letzte ~6 Monate aus LogDaten.dat
- **+ Jahr / Jahre auffüllen** – leere Vorjahres-Spalten
- **Export** JSON (Backup) oder CSV (Excel) · **Import** mit Zusammenführen
- **Balkendiagramm** – Monatsvergleich nach Jahren (MWh / kWh/kWp)

### Weitere Screenshots

<details>
<summary>Daten, Historie, Nodes, Logs, System</summary>

![Daten-Tab](docs/screenshots/screenshot-daten.png)
![Historie-Tab](docs/screenshots/screenshot-historie.png)
![Nodes-Tab](docs/screenshots/screenshot-nodes.png)
![Logs-Tab](docs/screenshots/screenshot-logs.png)
![System-Tab](docs/screenshots/screenshot-system.png)

</details>

---

## Konfiguration (Auszug)

| Einstellung | Standard | Beschreibung |
|---|---|---|
| IP / Port / Auth | – | PIKO-Webserver-Zugang |
| Poll-Intervall | 30 s | Live-Abfrage |
| Historiendaten laden | aus | LogDaten.dat abrufen |
| InfluxDB-Sync | aus | Live + History an `influxdb.0` |
| Web-UI Port | 8092 | Dashboard pro Instanz |
| PIKO Modell | Auto | 3.0 – 10.1 |
| **Postleitzahl** | 87781 | Wetter + regionaler Vergleich |
| **Einspeisevergütung** | 0,3925 €/kWh | €-Berechnung im Ertrag-Tab |
| Modul-Konfiguration | optional | String-Analyse, kWh/kWp |

InfluxDB-Verbindung (Host, Token, DB) wird im **InfluxDB-Adapter** konfiguriert – dieser Adapter kennt nur den Instanznamen (`influxdb.0`).

Details: [INSTALLATION.md](./INSTALLATION.md) · [Schnittstellen.md](./Schnittstellen.md)

---

## Datenpunkte

Namespace `kostalpiko.0.*` (pro Instanz):

### Live (Poll)

```
ac.power, energy.total, energy.today
ac.l1/l2/l3.voltage, ac.l1/l2/l3.power
pv.string1/2/3.voltage, pv.string1/2/3.current   (String 3 nur bei PIKO 5.5/10.1)
dc.totalPower                                     (berechnet: Σ U×I)
efficiency.ratio, efficiency.expected             (Wirkungsgrad %, temp.-korrigiert)
weather.sunshineHours, weather.tempMax, weather.cloudCover, weather.precipitation
weather.description, weather.plz, weather.place
status, online, device.model, device.strings
```

### History (15-min, historischer Zeitstempel → InfluxDB)

```
history.dc1/2/3.voltage, current, power
history.dc.totalPower, history.efficiency.ratio
history.ac1/2/3.voltage, current, power, history.ac.totalPower
history.ac.frequency, history.energy.total
history.acStatus, history.errorCode
```

**InfluxDB Live-Sync** (bei aktiviertem Sync): alle Live-Messwerte oben inkl. DC-Strings, Wirkungsgrad und Wetter.

---

## Mehrere Wechselrichter

| Instanz | Web-UI | Daten |
|---|---|---|
| `kostalpiko.0` | Port 8092 | eigene `monthly-yields.json` |
| `kostalpiko.1` | Port 8093 | eigene Datei |

---

## InfluxDB & Grafana

| Quelle | Zeitraum |
|---|---|
| LogDaten.dat / Cache | ~6 Monate |
| InfluxDB (nach Sync) | unbegrenzt* |

\*Sofern keine kürzere Retention gesetzt wird.

Empfehlung: einmal **Sync-All** pro WR, danach automatischer 15-min-Sync. Wetter- und Wirkungsgrad-Datenpunkte erlauben in Grafana den Abgleich mit dem Tagesertrag.

---

## Versionen & Changelog

Aktuelle Version und Änderungshistorie: **[GitHub Releases](https://github.com/MPunktBPunkt/iobroker.kostalpiko/releases)**

---

## Spende

[![Donate](https://img.shields.io/badge/Donate-PayPal-00457C.svg?logo=paypal)](https://www.paypal.com/donate/?business=martin%40bchmnn.de&currency_code=EUR)

---

## Lizenz

**GNU General Public License v3.0** – siehe [LICENSE](./LICENSE).  
© 2026 MPunktBPunkt
