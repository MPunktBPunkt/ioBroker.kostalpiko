# Older changes

Archived from io-package.json `common.news` (only de shown).

## 0.5.1
NEU: Jahres-Spalten hinzufügen/auffüllen, JSON/CSV Export & Import, Speicherort-Anzeige, Jahresvergleich als Balkendiagramm (MWh / kWh/kWp, Jahre umschaltbar)

## 0.5.2
Gesamtertrag in kWh; volle PLZ (87781) für Wetter/Sonnenstunden auf Daten-Tab; doppelte WR-Grenzwerte auf Historie-Tab entfernt

## 0.6.0
GPL-3.0; alle Live-Messwerte (DC-Strings, Wirkungsgrad, Wetter) als Datenpunkte + InfluxDB-Sync; History-Wirkungsgrad; README überarbeitet

## 0.6.1
Bugfix: Historie wird nicht mehr durch abgeschnittene LogDaten.dat ersetzt – Merge nach Zeitstempel; Warnung im Historie-Tab wenn Tagesdaten veraltet wirken

## 0.6.2
Ertrag: Backup-Wiederherstellung, Neu berechnen ab 05/2018, History-Zeitraum in UI; Script combine-yields.js für beide WR

## 0.6.3
Wetter-Text aus Bewölkung/Sonne statt WMO-Code; Ertragsberechnung: Duplikate entfernen, Zähler-Delta plausibilisieren, Auto-Werte löschen

## 0.6.4
Nachhol-Abruf wenn Tages-Historie hängen bleibt; Wetter auf Daten-Tab nach unten; Button „Neu ab 05/2018“ entfernt

## 0.6.5
E-Mail-Berichte als HTML (DIN A4): Kurven Tagesbericht, Balken Wochenbericht, Tabelle Monatsbericht mit Vorjahresvergleich; Test-Buttons; mehrere Empfänger

## 0.6.6
Bugfix: sendTo-Buttons in Admin (Testberichte funktionieren); Niederschlag aus Stunden-/Aktualwerten statt nur Tagesprognose

## 0.6.7
Bugfix: Passwortfeld type=password (jsonConfig gültig, Test-Buttons funktionieren); Niederschlag bisher/aktuell/Prognose getrennt

## 0.6.8
Bugfix: Header size≤5 in jsonConfig (Test-Buttons); nur noch E-Mail-Benachrichtigungen (Telegram/Pushover entfernt)

## 0.6.10
Bugfix: Message-Handler für Testberichte und E-Mail-Versand registriert; package.json Version synchronisiert; Bericht-Timer pro Typ; E-Mail-Timeout

## 0.6.11
Bugfix: ioBroker-CLI sendet Testberichte als command send – wird korrekt erkannt

## 0.6.12
Berichte: Wetter-Archiv für Berichtstag; Fehlercode-Erklärungen (z. B. 240 Netzstörung); E-Mail-Tabellen mit Inline-Styles; Berichts-Kennung im Betreff (reportLabel)

## 0.6.13
NEU: Vmpp-basierte Modultemperatur pro String (States, Kacheln, Historie-Chart); Temperaturverlust und MPP-Ausnutzung; Konzept in docs/KonzeptPikoTemperatur.md

## 0.6.14
Temperatur-Kacheln: °C immer anzeigen (absolut/eingeschränkt/ungültig); ΔT String 1↔2 ab 50 W Stringleistung; Historie-Chart filtert Low-G-Punkte
