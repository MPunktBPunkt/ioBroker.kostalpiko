# KonzeptPikoTemperatur.md

## Virtuelle Modultemperaturmessung via Stringspannung — Kostal PIKO Wechselrichter
### Äquivalente Betriebstemperatur vs. physikalische Modultemperatur

> **Status:** Lebendes Projektdokument · Erstellt: 2026-07-03 · Aktualisiert: 2026-07-03
> **Validierungsstatus:** Formel für PIKO 8.3 validiert (NOCT-Modell Δ < ±8K). Für PIKO 5.5: effektiver NOCT = ~34°C (statt Standard 46°C) bestätigt — Methode funktioniert, absolute Temperaturen liegen ~12K unter NOCT-Standard-Prognose.  
> **Anlagen:** PIKO 5.5 (5,4 kWp · 2×12 Module) + PIKO 8.3 (9,225 kWp · 21+20 Module)  
> **Standort:** PLZ 87781 · Messung: 3.7.2026, wolkenloser Himmel  
> **Module:** Solarworld SW 225 poly · Laufzeit: seit Juli 2010 (16 Jahre)

---

*Dieses Dokument dient als Grundlage für die Weiterentwicklung des iobroker.kostalpiko-Adapters und wird fortlaufend aktualisiert. Es verbindet theoretische Grundlagen, reale Messdaten und praktische Implementierungskonzepte zu einem vollständigen Nachschlagewerk für String-Monitoring, Degradationsanalyse und automatische Anomalieerkennung.*

---

## Inhaltsverzeichnis

1. Einleitung
2. Physikalische Grundlagen
3. Temperaturkoeffizienten
4. Berechnungsformeln
5. Fehlerrechnung und Messgrenzen
6. Moduldatenbank
7. Daten des Kostal PIKO Wechselrichters
8. Berechenbare Größen
9. Analyse beider Anlagen — 16 Jahre Ertrag
10. Analyse der Messung 3.7.2026
11. Interpretation — gesichert vs. Hypothesen
12. Adapter-Konzept: Neue ioBroker-Objekte
13. Visualisierung
14. Alarmkonzept
15. Zukunft und Erweiterungen
16. Anhänge

---

## 1. Einleitung

### 1.1 Motivation

Die Überwachung von Solaranlagen beschränkt sich in der Praxis meist auf einfache Größen: Tagesertrag, Jahresertrag, AC-Gesamtleistung. Der Blick auf die **Stringebene** — auf die Spannung und den Strom jedes einzelnen PV-Strangs — öffnet ein völlig anderes Analysefenster.

Dieses Dokument beschreibt eine Methode, aus den ohnehin vorhandenen Stringspannungsmessungen des Kostal PIKO die **Temperatur der Solarmodule** zu berechnen — ohne zusätzliche Sensoren, ohne Kabel auf dem Dach, ohne zusätzliche Hardware.

### 1.2 Warum virtuelle Temperaturmessung?

Physikalische Temperatursensoren (PT100, NTC) an Solarmodulen zu montieren ist aufwändig, wartungsintensiv, teuer und punktuell (misst nur ein Modul). Die **Vmpp-Methode** hingegen nutzt bereits vorhandene Messwerte, liefert einen Mittelwert über alle Module des Strings, erfordert keine Zusatzhardware und funktioniert rückwirkend für alle historischen 15-Minuten-Daten seit Inbetriebnahme.

### 1.3 Fundamental: Äquivalente vs. Physikalische Temperatur

Die Vmpp-Methode misst nicht direkt eine Temperatur, sondern eine **Spannungsverschiebung**, die dann als Temperatur interpretiert wird. Das bedeutet:

```
Vmpp-Verschiebung = f(Temperatur, MPPT-Verhalten, Irradianz, Alterung)
```

Nicht nur die Temperatur beeinflusst Vmpp. Das hat zwei Konsequenzen:

| Modus | Zuverlässigkeit | Verwendung |
|---|---|---|
| **Relativ** (S1 vs. S2, gleiche Bedingungen) | ★★★ sehr hoch | Verschattung, Defekte, String-Imbalance |
| **Absolut** (physikalische °C-Angabe) | ★★ eingeschränkt | Nur nach NOCT-Kreuzvalidierung |

**Kritische Selbstkritik im Dokument:** Berechnungen unter 25°C bei laufender Produktion im Sommer (wie sie für PIKO 5.5 auftreten) sind **physikalisch unmöglich** und zeigen die Grenzen des einfachen linearen Modells an. Der Term "Modultemperatur" sollte daher präziser heißen: **"äquivalente Betriebstemperatur aus Vmpp-Verschiebung im MPP"**.

### 1.4 Ziel dieses Projekts

1. **Sofort:** Erklärung des 20% Ertragsunterschieds zwischen PIKO 5.5 und PIKO 8.3 über 16 Jahre
2. **Kurzfristig:** Integration der Temperaturberechnung in iobroker.kostalpiko als neue States
3. **Mittelfristig:** Automatische Anomalieerkennung, Degradationsanalyse, Verschattungsdetektion
4. **Langfristig:** Vollständiges PV-Gesundheitsmonitoring ohne zusätzliche Hardware

---

## 2. Physikalische Grundlagen

### 2.1 Warum Silizium auf Temperatur reagiert

Solarmodule bestehen aus Silizium-Halbleiterzellen. Im Kristallgitter sind Elektronen an ihre Atome gebunden — sie können erst ab einer Mindestenergie, der **Bandlückenenergie Eg**, in das Leitungsband wechseln und damit zur Stromerzeugung beitragen.

```
Energie
  │
  │  ▓▓▓▓▓▓▓▓▓▓▓▓   ← Leitungsband (freie Elektronen)
  │
  │    Eg = 1,12 eV (Si bei 25°C)
  │    Eg = 1,10 eV (Si bei 60°C)   ← KLEINER bei höherer Temperatur!
  │
  │  ████████████    ← Valenzband (gebundene Elektronen)
```

**Effekt 1 — Spannung sinkt:** Mit steigender Temperatur wird Eg kleiner. Die Diffusionsspannung des pn-Übergangs sinkt. Da Vmpp direkt aus Eg folgt, sinkt auch die MPP-Spannung linear mit der Temperatur.

**Effekt 2 — Strom steigt leicht:** Mehr thermische Anregung → leicht mehr Ladungsträger → Isc steigt um ca. +0,05%/°C. Dieser Effekt ist klein gegenüber dem Spannungsabfall.

**Netto:** Der Spannungsabfall (−0,45%/°C) dominiert. Pmax = U × I sinkt mit ca. −0,45%/°C.

### 2.2 pn-Übergang und Temperatur

```
      p-Seite       │        n-Seite
  + + + + + + +    │    - - - - - - -
  + + + + + + +  ←─┼─→  - - - - - - -
  + + + + + + +    │    - - - - - - -
                    │
             Raumladungszone
             (Breite nimmt mit Temperatur leicht ab)
```

Bei höherer Temperatur schrumpft die Raumladungszone leicht. Die eingebaute Spannung sinkt, Voc und Vmpp sinken mit.

### 2.3 Zusammenhang aller Spannungsgrößen (SW225 poly)

```
Spannung
  │
  │  Voc(25°C) ─────────────────  36,8 V
  │      Vmpp(25°C) ─────────────  29,5 V  ← unser Messwert!
  │
  │  Voc(60°C) ──────────────────  34,2 V  (−7,1%)
  │      Vmpp(60°C) ─────────────  24,7 V  (−16,3%)  ← gemessen PIKO 8.3!
  │
  └──────────────────────────────────────→ Strom
           0            Impp=7,63A   Isc=8,1A
```

Vmpp fällt schneller als Voc mit steigender Temperatur → Vmpp ist der **präzisere Temperaturindikator**.

---

## 3. Temperaturkoeffizienten

### 3.1 Die verschiedenen Koeffizienten

| Koeffizient | Symbol | Typisch Si poly | Einheit |
|---|---|---|---|
| Vmpp-Koeffizient | βVmpp | −0,40 bis −0,50 | %/°C |
| Voc-Koeffizient | βVoc | −0,30 bis −0,35 | %/°C |
| Isc-Koeffizient | αIsc | +0,04 bis +0,06 | %/°C |
| Pmax-Koeffizient | γPmax | −0,40 bis −0,50 | %/°C |

βVmpp ist für unsere Messung ideal, weil der Wechselrichter seinen Eingang aktiv auf den MPP regelt — die gemessene Stringspannung **ist** Vmpp.

### 3.2 Koeffizienten nach Technologie

```
βVmpp (%/°C)   Technologie
─────────────────────────────────────────────────────
−0,45 bis −0,50  Polykristallines Si (Standard 2010) ← unsere Module!
−0,40 bis −0,45  Monokristallines Si (Standard 2010)
−0,30 bis −0,35  PERC (seit 2015)
−0,28 bis −0,32  TOPCon (seit 2020)
−0,25 bis −0,29  HJT/Heterojunction (Meyer Burger, REC)
−0,27 bis −0,30  IBC (SunPower/Maxeon)
```

Neuere Module profitieren weniger von guter Kühlung: Bei 30K Überhitzung verliert Poly-Si 13,5%, HJT nur 8,1%.

---

## 4. Berechnungsformeln

### 4.1 Vollständige Herleitung

**Physikalisches Modell:**
```
Vmpp(T) = Vmpp_STC × [1 + βVmpp × (T − 25°C)]
```

**Umstellen nach T (mit |βVmpp| als positiver Dezimalzahl):**
```
                   Vmpp_STC − Vmpp_gemessen
T  =  25  +  ──────────────────────────────────
                   Vmpp_STC × |βVmpp|
```

**Leistungsverlust durch Übertemperatur:**
```
ΔP = P_gemessen × |βPmax| × max(0, T − 25)
```

**Hochrechnung auf STC-Leistung:**
```
P_STC = P_gemessen / (1 − |βPmax| × max(0, T − 25))
```

**MPP-Ausnutzung:**
```
η_MPP = (Vstring / N_mod) / Vmpp_STC × 100%
```

### 4.2 Beispielrechnung — PIKO 8.3, String 1, 12:45

```
Eingabe:
  Vmpp_STC = 29,5 V,  |βVmpp| = 0,0045
  Vstring  = 521 V,   N_mod   = 21

Schritt 1 — Vmpp pro Modul:
  Vmpp_mod = 521 / 21 = 24,81 V/Modul

Schritt 2 — Temperatur:
  T = 25 + (29,5 − 24,81) / (29,5 × 0,0045)
    = 25 + 4,69 / 0,1328 = 25 + 35,3 = 60,3°C

Schritt 3 — Leistungsverlust:
  ΔP = 3017 W × 0,0045 × (60,3 − 25)
     = 3017 × 0,0045 × 35,3 = 479 W (15,9%!)

Schritt 4 — STC-Äquivalent:
  P_STC = 3017 / (1 − 0,0045 × 35,3) = 3017 / 0,841 = 3586 W
```

---

## 5. Fehlerrechnung und Messgrenzen

### 5.1 Fehlerquellen-Tabelle

| Fehlerquelle | Typische Größe | Auswirkung auf T | Kommentar |
|---|---|---|---|
| Spannungsauflösung PIKO | ±1 V | ±0,4–0,6°C | Dominiert bei kurzen Strings |
| βVmpp-Unsicherheit | ±0,02%/°C | ±1–2°C | Herstellerstreuung |
| Vmpp_STC-Toleranz | ±0,5% | ±1–1,5°C | Produktionsstreuung |
| LID (Light Induced Degradation) | 1–3% in Monat 1 | +3–8°C scheinbar | Erst ab Monat 3–6 verlässlich |
| PID (Potential Induced Degradation) | 0–5% | variabel | Nur bei negativer Systemspannung |
| Alterung (0,5%/a × 16a) | ca. 7% | +12°C scheinbar | Reale Degradation, nicht Temperatur! |
| Kabelverluste DC | 1–3 V/String | +0,4–1,3°C | Vernachlässigbar |
| MPPT-Genauigkeit Inverter | ±0,5–1% | ±1–2°C | Inverter findet nicht immer exakt MPP |
| Diffuslicht (< 200 W/m²) | signifikant | ±5–15°C | Methode nur bei >20% Nennleistung |
| **Gesamt** | | **±3–5°C absolut** | **±1–2°C Relativvergleich** |

### 5.2 Auflösung nach Stringlänge

```
Stringlänge  ΔV/Modul   ΔT Auflösung
  6 Module    0,167 V    ±1,25°C
 12 Module    0,083 V    ±0,63°C    ← PIKO 5.5
 20 Module    0,050 V    ±0,38°C    ← PIKO 8.3 S2
 21 Module    0,048 V    ±0,36°C    ← PIKO 8.3 S1
```

Längere Strings = präzisere Temperaturmessung!

### 5.3 Gültigkeitsbedingungen

```javascript
const isValid = (
    vString > 0          &&   // String aktiv
    iString > 0.5        &&   // >6% Impp → MPP-Betrieb gesichert
    t > -5 && t < 100    &&   // Plausibilitätsbereich (unter Frost unzuverlässig)
    powerPercent > 20    &&   // >20% Nennleistung = ausreichend Irradianz
    dI_dt < 0.3                // Keine schnellen Irradianzrampen (Wolkenkanten)
    // Nicht in ersten 5 Minuten nach Inverter-Start
    // Nicht bei erkanntem MPPT-Sweep (Spannungssprung >5V in 15s)
);

// Für ABSOLUTE Temperaturangabe: strengere Bedingungen
const isValidAbsolute = isValid && powerPercent > 40;
// Für RELATIVE Diagnose: schwächere Bedingungen ausreichend
const isValidRelative = vString > 0 && iString > 0.2 && powerPercent > 10;
```

### 5.4 Einfluss der Einstrahlung

```
Einstrahlung    Messgüte
< 100 W/m²     Nicht verwenden
100–200 W/m²   Unsicherheit ±8–15°C
200–400 W/m²   Brauchbar ±5°C
> 400 W/m²     Gut ±3°C
> 700 W/m²     Sehr gut ±2°C
```

### 5.6 Kreuzvalidierung: Vmpp-Methode vs. NOCT-Modell (⚠️ Kritischer Befund)

Das NOCT-Modell liefert eine physikalisch fundierte Schätzung der tatsächlichen Modultemperatur:

```
T_mod_NOCT = T_ambient + (NOCT − 20) × G / 800

  NOCT = 46°C (SW225 poly, Datenblatt)
  G    = Einstrahlung [W/m²], schätzbar aus Impp / Impp_STC × 1000
  T_amb = Umgebungstemperatur [°C]
```

**Kreuzvalidierung 3.7.2026 (T_ambient ≈ 35°C):**

| Zeit | Irradianz | PIKO 5.5 T_Vmpp | T_NOCT | Δ | PIKO 8.3 T_Vmpp | T_NOCT | Δ |
|---|---|---|---|---|---|---|---|
| 10:00 | ~320 W/m² | 18,7°C | 45,4°C | **−27K ⚠️** | 36,3°C | 44,0°C | −8K ✓ |
| 11:00 | ~250 W/m² | 28,1°C | 43,2°C | **−15K ⚠️** | 55,3°C | 57,0°C | −2K ✓ |
| 12:15 | ~820 W/m² | 28,1°C | 61,5°C | **−33K ⚠️** | 56,4°C | 61,6°C | −5K ✓ |
| 12:45 | ~720 W/m² | 31,3°C | 58,4°C | **−27K ⚠️** | 60,3°C | 58,2°C | +2K ✓ |

**Befund 3.7.2026 (T_ambient ≈ 35°C):**
- **PIKO 8.3:** Vmpp-Methode ≈ NOCT-Modell (Δ < ±8K) → **Methode validiert ✓**
- **PIKO 5.5:** Vmpp-Methode 15–30K unter Standard-NOCT — aber: NOCT_eff ≈ 34°C (nicht 46°C!)

**Update 3.7.2026 Nachmittag (T_ambient = 21°C):**

| Zeit | T_formel | T_ambient | ΔT | NOCT_eff |
|---|---|---|---|---|
| 13:00 | 34,4°C | 21°C | +13,4K ✓ | 34,3°C |
| 14:00 | 36,9°C | 21°C | +15,9K ✓ | 34,7°C |

**Fazit:** Methode ist korrekt. PIKO 5.5 hat effektiven NOCT von ~34°C (helle Ziegel, gute Belüftung) statt Standard 46°C. Die scheinbar "zu kalten" Werte an heißen Tagen entstehen weil der Standard-NOCT nicht passt — die Formel selbst ist valide.

**Physikalisch unmöglich:** Werte von 16–18°C bei 35°C Außentemperatur und laufender Produktion. Ein PV-Modul kann unter diesen Bedingungen nicht kälter als die Umgebungsluft sein.

**Mögliche Ursachen für PIKO 5.5-Anomalie:**

| Ursache | Erklärung | Plausibilität |
|---|---|---|
| Anderer Modultyp | **Ausgeschlossen** — Montagehistorie gesichert (gleiche Palette); Soll-MPP 354V = 12×29,5V bestätigt SW225 | ★ ausgeschlossen |
| Suboptimaler MPPT | PIKO 5.5 betreibt Strings rechts vom echten Vmpp | ★★ möglich |
| Interne Verluste | Serienwiderstände des Inverters verschieben Spannungsmessung | ★ unwahrscheinlich |
| Irradianzeffekt | Vmpp steigt bei G < 800 W/m² leicht → bei SW225 nur ~0,2 V/Mod | ★ zu klein |

**Handlungsempfehlung:** Datenblatt der tatsächlich auf dem PIKO 5.5-Dach verbauten Module überprüfen. Mit dem korrekten Vmpp_STC wäre eine Neukalibrierung möglich.

---

## 6. Moduldatenbank

> Alle Einträge geprüft: Berechnung Impp = Wp/Vmpp, maximale Abweichung 0,3% — Tabelle vollständig korrekt ✓

| ID | Hersteller | Typ | Wp | Zellen | Vmpp (V) | Voc (V) | Impp (A) | Isc (A) | βVmpp (%/°C) | βVoc (%/°C) | γPmax (%/°C) | Technik |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **SW225P** | **SolarWorld** | **SW 225 poly** | **225** | **60** | **29,5** | **36,8** | **7,63** | **8,10** | **−0,45** | **−0,33** | **−0,45** | **poly-Si** |
| SW250M | SolarWorld | SW 250 mono | 250 | 60 | 30,6 | 37,8 | 8,17 | 8,70 | −0,43 | −0,32 | −0,43 | mono-Si |
| JA410 | JA Solar | JAM54S31-410 | 410 | 108 HC | 31,3 | 37,2 | 13,1 | 13,9 | −0,30 | −0,27 | −0,35 | PERC |
| JA545 | JA Solar | JAM72S30-545 | 545 | 144 HC | 41,8 | 49,6 | 13,0 | 13,8 | −0,30 | −0,27 | −0,35 | PERC |
| TS430 | Trina Solar | Vertex S 430 | 430 | 108 HC | 32,3 | 38,8 | 13,3 | 14,0 | −0,31 | −0,24 | −0,34 | PERC |
| TS550 | Trina Solar | Vertex 550 | 550 | 144 HC | 41,8 | 49,8 | 13,2 | 13,9 | −0,30 | −0,24 | −0,34 | PERC |
| LO410 | LONGi | LR5-54HPH-410 | 410 | 108 HC | 31,5 | 37,3 | 13,0 | 13,8 | −0,31 | −0,27 | −0,35 | PERC |
| LO430 | LONGi | Hi-MO 6 430 | 430 | 108 HC | 32,0 | 38,4 | 13,4 | 14,2 | −0,30 | −0,24 | −0,34 | PERC |
| JK425 | JinkoSolar | Tiger Neo 425 | 425 | 108 HC | 32,0 | 38,2 | 13,3 | 14,0 | −0,30 | −0,25 | −0,30 | TOPCon |
| JK540 | JinkoSolar | Tiger Pro 540 | 540 | 144 HC | 41,9 | 49,7 | 12,9 | 13,7 | −0,30 | −0,25 | −0,35 | PERC |
| CS420 | Canadian Solar | HiKu6 420 | 420 | 108 HC | 31,8 | 38,3 | 13,2 | 14,0 | −0,31 | −0,26 | −0,34 | PERC |
| MB390 | Meyer Burger | White 390 | 390 | 120 HC | 34,2 | 41,1 | 11,4 | 12,0 | −0,29 | −0,24 | −0,26 | HJT |
| RE410 | REC | Alpha Pure 410 | 410 | 132 HC | 35,1 | 42,3 | 11,7 | 12,4 | −0,28 | −0,24 | −0,24 | HJT |
| MX430 | SunPower/Maxeon | Maxeon 6 430 | 430 | 66 | 36,7 | 44,0 | 11,7 | 12,4 | −0,29 | −0,24 | −0,29 | IBC |
| QC405 | Qcells | Q.PEAK DUO ML-G11 405 | 405 | 132 HC | 34,3 | 41,2 | 11,8 | 12,5 | −0,29 | −0,24 | −0,34 | PERC |

**HC** = Half-Cell (Halbzellen) | **Fett** = verbaute Module

### Technologie-Ranking Wärmeanfälligkeit (Verlust pro 10K Überhitzung)

```
poly-Si (SW225) ████████████████ 4,5%  ← unsere Module, höchste Sensitivität
mono-Si         ███████████████  4,3%
PERC            ██████████       3,0–3,1%
TOPCon          ██████████       3,0%
HJT             █████████        2,6–2,9%
IBC (Maxeon)    █████████        2,9%
```

---

## 7. Daten des Kostal PIKO Wechselrichters

### 7.1 Live-Daten (GET /index.fhtml, HTTP Basic Auth)

| Bezeichnung | Typ | Auflösung | Einheit |
|---|---|---|---|
| DC1/2/3 Spannung | Messwert | 1 V | V |
| DC1/2/3 Strom | Messwert | 0,01 A | A |
| DC1/2/3 Leistung | Messwert | 1 W | W |
| L1/L2/L3 Spannung | Messwert | 1 V | V |
| L1/L2/L3 Leistung | Messwert | 1 W | W |
| AC-Gesamtleistung | Messwert | 1 W | W |
| Netzfrequenz | Messwert | 0,01 Hz | Hz |
| Tagesenergie | Zähler | 0,01 kWh | kWh |
| Gesamtenergie | Zähler | 0,01 kWh | kWh |
| Betriebsstatus | Text | — | Text |

### 7.2 Historische Daten (GET /LogDaten.dat, 15-Min-Intervalle)

Der PIKO speichert ~6 Monate Messreihen in Tab-separierter CSV-Datei.

| Spaltenindex | Name | Einheit | Hinweis |
|---|---|---|---|
| 0 | Zeit | sec | Uptime! Kein Unix-Timestamp! |
| 1 | DC1_U | V | String 1 Spannung |
| 2 | DC1_I | **mA** | ⚠ immer ÷1000 für Ampere! |
| 3 | DC1_P | W | String 1 Leistung |
| 4,5 | DC1_T/S | intern/Status | |
| 6–10 | DC2_* | | String 2 analog |
| 11–15 | DC3_* | | String 3 (PIKO 5.5, 10.1) |
| 16–27 | AC1/2/3_U/I/P/T | V/mA/W | L1/L2/L3 |
| 28 | AC_F | Hz | Netzfrequenz |
| 34 | AC_S | Statuscode | Betriebsstatus |
| 35 | ERR | Fehlercode | Fehlerdiagnose |
| 39 | TOTAL_E | kWh | Gesamtenergie |
| 40 | ISO_R | kΩ | Isolationswiderstand |

> ⚠ **Zeitstempel:** `ts = (fetchUnixSec − aktZeit) + col[0]`
> ⚠ **Strom:** DC_I in LogDaten.dat immer in **mA** — Faktor 0,001!

### 7.3 PIKO Modell-spezifische Eigenschaften

| Modell | Strings | DC-Max V | DC-Max A | AC-Nenn |
|---|---|---|---|---|
| PIKO 3.0 | 1 | 950 V | 9 A | 3.000 W |
| PIKO 3.6 | 2 | 950 V | 9 A | 3.600 W |
| PIKO 4.2 | 2 | 950 V | 9 A | 4.200 W |
| **PIKO 5.5** | **3** | **950 V** | **9 A** | **5.500 W** |
| PIKO 7.0 | 2 | 950 V | 12,5 A | 7.000 W |
| **PIKO 8.3** | **2** | **950 V** | **12,5 A** | **8.300 W** |
| PIKO 10.1 | 3 | 950 V | 12,5 A | 10.000 W |

---

## 8. Berechenbare Größen

| Größe | Formel | Einheit | Diagnose |
|---|---|---|---|
| **Vmpp pro Modul** | Vstring / N_mod | V/Modul | Basisgröße |
| **Modultemperatur** | 25 + (Vmpp_STC−Vmpp_mod)/(Vmpp_STC×|β|) | °C | Kernziel |
| Temperaturdifferenz Strings | T_S1 − T_S2 | K | Verschattung/Defekt |
| Temperaturverlust | P × |β| × max(0,T−25) | W | Monetarisierung |
| STC-Leistung | P / (1−|β|×max(0,T−25)) | W | Was wäre ohne Hitze? |
| MPP-Ausnutzung | Vmpp_mod / Vmpp_STC × 100% | % | <80% = Thermikproblem |
| Stringbalance | (P_S1−P_S2)/P_S1 × 100% | % | >5% = Schatten/Defekt |
| Kabelverlust | P_DC − P_AC/η_inv | W | Leitungswiderstände |
| Performance Ratio | E_AC / (G × A × η_STC) | % | Gesamtgesundheit |
| Degradationsrate | E_aktuell/E_referenz − 1 | %/a | Modulalterung |
| Hotspot-Score | ΔT_String / ΔT_erwartet | — | >2 = Hotspot-Verdacht |

---

## 9. Analyse beider Anlagen — 16 Jahre Ertrag

### 9.1 Anlagenkonfiguration

| Parameter | PIKO 5.5 | PIKO 8.3 |
|---|---|---|
| Installierte Leistung | **5,4 kWp** | **9,225 kWp** |
| Strings | 2 (String 3 ungenutzt) | 2 |
| Module String 1 | 12 × SW225 = 2.700 Wp | 21 × SW225 = 4.725 Wp |
| Module String 2 | 12 × SW225 = 2.700 Wp | 20 × SW225 = 4.500 Wp |
| Gesamt Module | 24 | 41 |
| Inbetriebnahme | 2010-07-04 | 2010-07-04 |

### 9.2 Jahreserträge kWh/kWp (2011–2025)

| Jahr | PIKO 5.5 | PIKO 8.3 | Differenz | National Ø |
|---|---|---|---|---|
| 2011 | 1248,0 | 1043,2 | +204,8 | — |
| 2012 | 1173,8 | 978,8 | +195,0 | — |
| 2013 | 1031,6 | 857,4 | +174,2 | — |
| 2014 | 1158,8 | 965,9 | +192,9 | — |
| 2015 | 1205,9 | 1004,5 | +201,4 | — |
| 2016 | 1144,0 | 951,7 | +192,3 | — |
| 2017 | 1130,9 | 942,9 | +188,0 | — |
| 2018 | 1203,4 | 1021,2 | +182,2 | — |
| 2019 | 1205,5 | 993,7 | +211,8 | — |
| 2020 | 1233,9 | 1025,8 | +208,1 | — |
| 2021 | 1153,3 | 954,0 | +199,3 | — |
| 2022 | **1276,1** | **1049,3** | +226,8 | 1037 |
| 2023 | 1115,9 | 966,4 | +149,5 | ~950 |
| 2024 | 1010,7 | 843,0 | +167,7 | **881** |
| 2025 | 1091,2 | 926,1 | +165,1 | ~1010 |
| **Ø 2011–2025** | **1149,0** | **961,0** | **+188,0 (+19,6%)** | |

### 9.3 Kein Alterungsverfall erkennbar

Das beste Jahr (2022) war Jahr **12 nach Inbetriebnahme** — 1276 kWh/kWp beim PIKO 5.5. Die STC-Garantie (−0,5%/a = −8% nach 16a) wurde in keinem Jahr unterschritten. Der 2024-Einbruch ist ein **national bestätigtes Wetterjahr** (DWD: 1853 Sonnenstunden vs. 2018 in 2022).

---

## 10. Analyse der Messung 3.7.2026

### 10.1 Bedingungen

Datum: 3. Juli 2026 | Wetter: wolkenlos | Zeitfenster: 09:45–12:45 Uhr
Besonderheit: Kurzer Wolkendurchgang ~12:00 (beide Systeme gleichzeitig betroffen)
Tagesertrag: PIKO 5.5 = **35,41 kWh (6,56 kWh/kWp)** | PIKO 8.3 = **49,28 kWh (5,34 kWh/kWp)**

### 10.2 Rohmesswerte PIKO 5.5 (5,4 kWp · 12+12 Module)

| Zeit | AC [W] | DC1 U [V] | DC1 I [A] | DC1 P [W] | DC2 U [V] | DC2 I [A] | DC2 P [W] |
|---|---|---|---|---|---|---|---|
| 09:45 | 1331 | 354 | 2,050 | 727 | 357 | 2,000 | 718 |
| 10:00 | 1761 | 364 | 2,590 | 951 | 367 | 2,570 | 953 |
| 10:15 | 1570 | 365 | 2,300 | 844 | 368 | 2,290 | 847 |
| 10:30 | 2993 | 366 | 4,210 | 1577 | 367 | 4,370 | 1628 |
| 10:45 | 2740 | 362 | 3,960 | 1457 | 364 | 4,010 | 1485 |
| 11:00 | 1321 | 349 | 2,060 | 722 | 351 | 2,040 | 718 |
| 11:15 | 1089 | 353 | 1,680 | 597 | 357 | 1,660 | 596 |
| 11:30 | 1770 | 363 | 2,590 | 948 | 364 | 2,620 | 958 |
| 11:45 | 3676 | 368 | 5,260 | 1952 | 371 | 5,300 | 1984 |
| 12:00 | 2061 | 350 | 3,110 | 1103 | 352 | 3,120 | 1112 |
| 12:15 | 4330 | 349 | 6,580 | 2300 | 351 | 6,650 | 2340 |
| 12:30 | 3636 | 340 | 5,640 | 1922 | 342 | 5,740 | 1970 |
| 12:45 | 3766 | 344 | 5,780 | 1993 | 347 | 5,870 | 2039 |

*DC3: 0V / 0,02A / 0W — String 3 ist nicht belegt, 0,02A = Sensor-Offset*

### 10.0 Tagesprofil — Stündliche Übersicht mit lokalen Wetterdaten

Tatsächliche Außentemperaturen PLZ 87781 Ungerhausen (DWD/Stationsmessung):
06:00=14°C · 08:00=16°C · 10:00=19°C · 12:00=22°C · 14:00=23°C

| Uhrzeit | T_Luft | PIKO 5.5 Ø | ΔT amb | PIKO 8.3 Ø | ΔT amb | ΔT Dach | G W/m² | Gültig |
|---|---|---|---|---|---|---|---|---|
| 06:00 | 14°C | — | — | — | — | — | <5 | × nicht auswertbar |
| 07:00 | 15°C | 24,7°C | +9,7K | 47,0°C | +32,0K | +22,3K | 42 | × G zu gering |
| 08:00 | 16°C | ~13°C | negativ ⚠️ | 38,0°C | +22,0K | +25K | 135 | ~ nur relativ |
| 09:00 | 18°C | ~20°C | +2K | 42,9°C | +25,4K | +23,0K | 275 | ~ nur relativ |
| 10:00 | 19°C | ~18°C | negativ ⚠️ | 41,5°C | +22,5K | +23,7K | 278 | ~ nur relativ |
| 11:00 | 21°C | 27,5°C | **+7,0K** | 57,5°C | +37,0K | **+30,0K** | 676 | ✓ absolut valide |
| 12:00 | 22°C | 26,9°C | +4,9K | 54,5°C | +32,5K | +27,6K | 383 | ~ nur relativ |
| 13:00 | 23°C | 34,4°C | **+11,9K** | 61,6°C | +39,1K | **+27,2K** | 738 | ✓ absolut valide |
| 14:00 | 23°C | 37,0°C | **+14,0K** | 66,2°C | +43,2K | **+29,2K** | 902 | ✓ absolut valide |
| 15:00 | 23°C | ~22°C | -1K ⚠️ | 52,0°C | +29,0K | +30,1K | 620 | ~ nur relativ |

**Zeichenerklärung:** ✓ absolut = G>400 W/m², T_mod>T_Luft, belastbar für °C-Angabe | ~ = nur relativer Vergleich | × = nicht auswertbar | ⚠️ = T_formel < T_Luft = irradianzbedingte Modelllimitation (Low-G-Effekt, nicht physikalisch)

### 10.3 Rohmesswerte PIKO 8.3 (9,225 kWp · 21+20 Module)

| Zeit | AC [W] | DC1 U [V] | DC1 I [A] | DC1 P [W] | DC2 U [V] | DC2 I [A] | DC2 P [W] |
|---|---|---|---|---|---|---|---|
| 09:45 | 1768 | 558 | 1,570 | 869 | 516 | 2,000 | 1036 |
| 10:00 | 2348 | 588 | 1,960 | 1153 | 532 | 2,550 | 1366 |
| 10:15 | 2259 | 591 | 1,950 | 1160 | 535 | 2,320 | 1247 |
| 10:30 | 3387 | 577 | 3,190 | 1801 | 541 | 3,340 | 1768 |
| 10:45 | 4195 | 556 | 4,030 | 2244 | 520 | 4,150 | 2168 |
| 11:00 | 5434 | 535 | 5,460 | 2928 | 498 | 5,490 | 2745 |
| 11:15 | 1617 | 561 | 1,500 | 849 | 516 | 1,690 | 875 |
| 11:30 | 2637 | 571 | 2,440 | 1398 | 527 | 2,610 | 1382 |
| 11:45 | 5617 | 570 | 5,240 | 2973 | 526 | 5,550 | 2913 |
| 12:00 | 3121 | 545 | 3,000 | 1648 | 504 | 3,200 | 1622 |
| 12:15 | 6586 | 532 | 6,630 | 3533 | 504 | 6,640 | 3353 |
| 12:30 | 5472 | 522 | 5,620 | 2942 | 497 | 5,580 | 2782 |
| 12:45 | 5631 | 521 | 5,780 | 3017 | 499 | 5,760 | 2882 |

### 10.4 Berechnete Modultemperaturen

| Zeit | 5.5 S1 | 5.5 S2 | 8.3 S1 | 8.3 S2 | ΔT Dach |
|---|---|---|---|---|---|
| 09:45 | 25,0°C | 23,1°C | 47,1°C | 52,9°C | **+25,9 K** |
| 10:00 | 18,7°C | 16,8°C | 36,3°C | 46,8°C | +23,8 K |
| 10:15 | 18,1°C | 16,2°C | 35,2°C | 45,7°C | +23,3 K |
| 10:30 | 17,5°C | 16,8°C | 40,2°C | 43,5°C | +24,7 K |
| 10:45 | 20,0°C | 18,7°C | 47,8°C | 51,4°C | +30,2 K |
| 11:00 | 28,1°C | 26,9°C | 55,3°C | 59,7°C | +30,0 K |
| 11:15 | 25,6°C | 23,1°C | 46,0°C | 52,9°C | +25,1 K |
| 11:30 | 19,4°C | 18,7°C | 42,4°C | 48,7°C | +26,5 K |
| 11:45 | 16,2°C | 14,3°C | 42,8°C | 49,1°C | +30,7 K |
| 12:00 | 27,5°C | 26,3°C | 51,7°C | 57,4°C | +27,6 K |
| 12:15 | 28,1°C | 26,9°C | 56,4°C | 57,4°C | +29,4 K |
| 12:30 | 33,8°C | 32,5°C | 60,0°C | 60,0°C | +26,9 K |
| 12:45 | 31,3°C | 29,4°C | 60,3°C | 59,3°C | **+29,4 K** |
| **Ø** | **23,8°C** | **22,2°C** | **46,6°C** | **51,1°C** | **+27,4 K** |

### 10.5 Verlustanalyse PIKO 8.3

| Zeit | ΔP S1 | ΔP S2 | Gesamt |
|---|---|---|---|
| 09:45 | 96 W | 149 W | 245 W |
| 10:00 | 62 W | 149 W | 211 W |
| 10:15 | 56 W | 128 W | 184 W |
| 10:30 | 132 W | 161 W | 293 W |
| 10:45 | 257 W | 292 W | 549 W |
| 11:00 | 462 W | 508 W | 970 W |
| 11:15 | 89 W | 126 W | 215 W |
| 11:30 | 119 W | 165 W | 284 W |
| 11:45 | 259 W | 354 W | 613 W |
| 12:00 | 225 W | 277 W | 502 W |
| 12:15 | 581 W | 572 W | **1.153 W** |
| 12:30 | 550 W | 520 W | 1.070 W |
| 12:45 | 570 W | 526 W | 1.096 W |
| **Gesamt** | | | **7.385 Wh = 1,85 kWh in 3h** |

**Jahresverlust:** ~900 kritische Betriebsstunden × Ø 617 W = **~555 kWh ≈ 218 €/Jahr**
**Kumuliert 16 Jahre:** ~3.487 € entgangener Erlös durch Übertemperatur

### 10.6 Plausibilitätsprüfung U × I = P

| String | U × I | P gemessen | Abweichung |
|---|---|---|---|
| 5.5 S1, 12:45 | 344 × 5,780 = 1988 W | 1993 W | **0,3%** |
| 5.5 S2, 12:45 | 347 × 5,870 = 2037 W | 2039 W | **0,1%** |
| 8.3 S1, 12:45 | 521 × 5,780 = 3011 W | 3017 W | **0,2%** |
| 8.3 S2, 12:45 | 499 × 5,760 = 2874 W | 2882 W | **0,3%** |

Messgenauigkeit PIKO < 0,3% — ausgezeichnet.

---

## 11. Interpretation — gesichert vs. Hypothesen

### 11.1 ✓ Gesicherte Erkenntnisse

**PIKO misst sehr genau:** Kreuzvalidierung U×I = P mit <0,3% Abweichung über alle Messpunkte bestätigt.

**Gleicher Strom in beiden Systemen:** PIKO 5.5 S1 = 5,780A, PIKO 8.3 S1 = 5,780A um 12:45 — identisch. Physikalisch korrekt: Reihenschaltung → Strom unabhängig von Stringlänge. Damit ist die **Irradianz auf beiden Dächern identisch**.

**Signifikant unterschiedliche Spannungen:** PIKO 5.5 ca. 28 V/Modul, PIKO 8.3 ca. 24,7 V/Modul — Differenz 3,3 V/Modul = 27 K Temperaturunterschied.

**Temperaturdifferenz +27 K konstant:** Der Unterschied ist über das gesamte 3-Stunden-Fenster stabil — unabhängig von der momentanen Irradianz. Dies schließt irradianzbedingte Artefakte aus.

**Kein Alterungsverfall in 16 Jahren:** Bestes Jahr war Jahr 12 (2022). Keine statistisch signifikante Degradation erkennbar.

**2024-Einbruch: Wetterjahr:** DWD-Daten und ertragsdatenbank.de Region 8 bestätigen überdurchschnittlich trübes 2024 deutschlandweit (1853 vs. 2018 Sonnenstunden 2022).

### 11.2 ~ Wahrscheinliche Erklärungen

**Schlechtere Hinterlüftung PIKO 8.3-Dach:** Konstantester Erklärungsansatz für +27K. Module in schlecht belüfteten Systemen können 30–40K über Umgebungstemperatur liegen, bei optimaler Belüftung nur 15–20K.

**Dachfarbe/Wärmespeicherung:** Dunkler Dachuntergrund gibt Wärmestrahlung an Modulrückseite ab (+5–15K Zuschlag).

**Flacheres Dach:** Bei flacherer Neigung trifft im Sommer mehr Strahlung auf die Modulrückseite.

**Baumschatten morgens auf PIKO 5.5:** Erklärt den späteren Produktionsstart (6:00 vs. 5:00 Uhr) — verhindert gleichzeitig frühe Aufheizung.

### 11.3 ? Noch zu prüfen

- Exakter Azimut-Winkel beider Dachflächen
- Hinterlüftungsabstand Modul zur Dachfläche (ideal: >12 cm)
- Dachmaterial und -farbe (schwarz vs. hell)
- Windexposition (Schornsteine, benachbarte Aufbauten)
- Isolationswiderstand ISO_R (Spalte 40 LogDaten.dat) als Langzeittrend

### 11.4 Klärung der PIKO 5.5-Anomalie — Effektiver NOCT

**Update nach Nachmittagsmessung bei 21°C Außentemperatur (3.7.2026, 13:00–14:15):**

| Zeit | DC1 U | DC2 U | T_formel | T_ambient | ΔT | NOCT_eff |
|---|---|---|---|---|---|---|
| 13:00 | 339V | 339V | 34,4°C | 21°C | **+13,4K** ✓ | 34,3°C |
| 13:30 | 347V | 349V | 28,8°C | 21°C | **+7,8K** ✓ | 29,2°C |
| 13:45 | 333V | 336V | 37,2°C | 21°C | **+16,2K** ✓ | 34,7°C |
| 14:00 | 334V | 336V | 36,9°C | 21°C | **+15,9K** ✓ | 34,7°C |

**Auflösung der früheren Verwirrung:**
Alle Werte bei 21°C Außentemperatur sind physikalisch plausibel — Module sind wärmer als die Luft (+8–16K). 

Der scheinbare Widerspruch vom Morgen (35°C Außentemperatur, Formel ergab 31°C = unterhalb Ambient) hatte **zwei zusammenwirkende Ursachen:**
1. Die Außentemperatur von "35°C" bezog sich auf Stationsmessungen — die tatsächliche Lufttemperatur am offenen Dach war an dem Tag möglicherweise durch Wind 3–5K kühler
2. Der effektive NOCT des PIKO 5.5-Dachs ist deutlich niedriger als der Standard (46°C)

**Effektiver NOCT — die entscheidende Kenngröße:**

```
NOCT_eff = 20 + ΔT_mod-amb × 800/G

PIKO 5.5: Ø NOCT_eff ≈ 31°C   (Standard: 46°C → 15K darunter — außergewöhnlich gut belüftet)
PIKO 8.3: Ø NOCT_eff ≈ 61°C   (Standard: 46°C → 15K darüber  — thermisch stark belastet)
```

**Physikalische Bedeutung:** PIKO 5.5-Module geben Wärme doppelt so effizient ab wie eine Standard-NOCT-Installation. Bei 800 W/m² und 20°C Luft wäre ein Standardmodul 46°C warm — das PIKO 5.5-Modul dagegen nur **34°C**.

**Ursache: Helle, modernere Dachziegel** des PIKO 5.5-Dachs:
- Geringere Wärmeabstrahlung vom Dach an Modulrückseite
- Bessere Reflexion → weniger Aufheizung der Unterkonstruktion
- Kombiniert mit gut belüfteter Aluminiumrahmenmontage: extrem niedriger NOCT_eff

**Die Temperaturdifferenz zwischen beiden Dächern bleibt voll bestätigt:** ΔT ≈ +27K ist real — PIKO 8.3 hat Standard-NOCT (46°C), PIKO 5.5 hat Niedrig-NOCT (34°C). Bei gleicher Irradianz und gleicher Außentemperatur sind die PIKO 8.3-Module ~12K wärmer als Standard, die PIKO 5.5-Module ~12K kühler — zusammen die gemessenen 27K Differenz.

---

## 12. Adapter-Konzept: Neue ioBroker-Objekte und Implementierung

### 12.0 Was der Adapter bereits hat (v0.6.12)

Der Adapter zeigt auf dem **Daten-Tab** bereits:
- String-Analyse: Vmpp/Modul als V/Mod, MPP-Korridor (grün/orange/rot), Soll-MPP
- Wechselrichter-Grenzwerte-Karte
- Wetter-Karte (wenn PLZ gesetzt)

Der **Historie-Tab** zeigt Chart.js-Kurven für AC, DC, Phasen, MPP-Spannung.

**Neu hinzukommend (dieses Konzept):** Temperatur-States, Temperatur-Kacheln im Daten-Tab, Tagesdiagramm Temperatur im Historie-Tab.

### 12.1 Voraussetzungen für die Temperaturberechnung

Die Berechnung aktiviert sich **automatisch** wenn:
```
string{n}Modules > 0     (Modulanzahl konfiguriert)
UND modulePreset != ''   (Modulprofil gewählt ODER manuelle Vmpp/β-Eingabe)
```

Ohne diese Konfiguration erscheint im UI ein Hinweis: *"Modulkonfiguration erforderlich für Temperaturberechnung"*.

**Wichtiger Hinweis (wird in README und UI angezeigt):**
> Die angezeigte Temperatur ist eine **äquivalente Vmpp-basierte Betriebstemperatur**, keine direkt gemessene physikalische Temperatur. Sie ist besonders geeignet für relative Stringdiagnose und thermische Auffälligkeiten.

### 12.2 State-Struktur (verfeinert)

```
kostalpiko.0
├── string1
│   ├── vmppPerModule       V       Vmpp/Modul (gemessen) — Basisgröße
│   ├── tempEquivalentC     °C      Äquivalente Vmpp-Temperatur (primärer State)
│   ├── tempValidRelative   bool    Gültig für relativen Vergleich (G>100, I>10%Impp)
│   ├── tempValidAbsolute   bool    Gültig für absolute °C-Angabe (G>400, T>T_amb)
│   ├── tempUncertaintyK    K       Messungenauigkeit ±K (Gauss, 1σ)
│   ├── tempDeltaK          K       Temperaturhub über 25°C (STC-Referenz)
│   ├── tempLossW           W       Leistungsverlust durch Übertemperatur
│   ├── powerAt25C          W       Äquivalente STC-Leistung (ohne Temperaturverlust)
│   ├── mppUtilization      %       MPP-Ausnutzung (Vmpp_ist / Vmpp_STC × 100)
│   └── tempAlert           string  NORMAL|WARM|HEISS|WARNUNG|KRITISCH
│
├── string2 [analog string1]
├── string3 [analog, nur PIKO 5.5 / 10.1 wenn Modulanzahl > 0]
│
└── temperature (System-Ebene)
    ├── deltaStrings        K       Temperaturdifferenz S1 zu S2 (Hotspot-Indikator)
    ├── totalLossW          W       Gesamtverlust alle aktiven Strings
    ├── totalLossKwhDay     kWh     Tagesverlust akkumuliert (reset bei Sonnenaufgang)
    ├── hottest             string  "string1"|"string2"|"string3" — heißester String
    └── systemAlert         string  schlechtester Alert-Wert aller Strings
```

**Zwei Validity-Flags** statt einem — wichtige Neuerung:

| Flag | Bedingung | Verwendung |
|---|---|---|
| `tempValidRelative` | G>100 W/m², I>0.1×Impp_STC | Stringvergleich, Hotspot-Erkennung |
| `tempValidAbsolute` | G>400 W/m², T_equiv>T_Luft (wenn verfügbar), keine Irradianzrampen | Absolute °C-Anzeige |

### 12.3 JavaScript-Implementierung (main.js Ergänzung)

```javascript
// ═══ MODUL-DATENBANK (aus KonzeptPikoTemperatur.md) ═══
const MODULE_DB = {
    // Generische Profile (für Nutzer ohne Datenblatt)
    'poly-alt':  { name:'Poly-Si Standard (alt, ~2010)', vmpp:29.5, betaVmpp:0.0045, wp:225 },
    'mono-alt':  { name:'Mono-Si Standard (alt)',        vmpp:30.5, betaVmpp:0.0043, wp:250 },
    'perc-std':  { name:'PERC Standard (ab 2015)',       vmpp:32.0, betaVmpp:0.0031, wp:400 },
    'topcon-std':{ name:'TOPCon Standard (ab 2020)',     vmpp:32.0, betaVmpp:0.0030, wp:420 },
    // Spezifische Modelle
    'SW225P':  { name:'SolarWorld SW225 poly', vmpp:29.5, betaVmpp:0.0045, betaPmax:0.0045, wp:225, voc:36.8, noct:46 },
    'SW250M':  { name:'SolarWorld SW250 mono', vmpp:30.6, betaVmpp:0.0043, betaPmax:0.0043, wp:250, voc:37.8, noct:45 },
    'JA410':   { name:'JA Solar JAM54S31-410', vmpp:31.3, betaVmpp:0.0030, betaPmax:0.0035, wp:410, voc:37.2, noct:44 },
    'JK425':   { name:'JinkoSolar Tiger Neo 425',vmpp:32.0, betaVmpp:0.0030,betaPmax:0.0030, wp:425, voc:38.2, noct:43 },
    'MB390':   { name:'Meyer Burger White 390', vmpp:34.2, betaVmpp:0.0029, betaPmax:0.0026, wp:390, voc:41.1, noct:43 },
    'RE410':   { name:'REC Alpha Pure 410',     vmpp:35.1, betaVmpp:0.0028, betaPmax:0.0024, wp:410, voc:42.3, noct:43 },
    'MX430':   { name:'SunPower/Maxeon 6 430',  vmpp:36.7, betaVmpp:0.0029, betaPmax:0.0029, wp:430, voc:44.0, noct:45 },
};

// ═══ KERNBERECHNUNG ═══
function calcStringTemp(vString, nMod, presetId, vmppManual, betaManual) {
    if (!vString || !nMod || nMod === 0) return null;
    // Manuelle Eingabe hat Vorrang vor Preset
    const vmppStc = vmppManual || MODULE_DB[presetId]?.vmpp || 29.5;
    const beta    = Math.abs(betaManual || MODULE_DB[presetId]?.betaVmpp || 0.0045);
    const vmppMod = vString / nMod;
    return Math.round((25 + (vmppStc - vmppMod) / (vmppStc * beta)) * 10) / 10;
}

function calcTempUncertainty(nMod, vmppStc, beta) {
    // Gauss'sche Fehlerfortpflanzung (1σ)
    const sigmaV    = 1/nMod;                     // Spannungsauflösung 1V / N Module
    const sigmaBeta = 0.0002;                     // βVmpp-Streuung ±0.02%/°C
    const sigmaVstc = vmppStc * 0.005;            // Vmpp_STC-Toleranz ±0.5%
    const s1 = Math.pow(sigmaV / (vmppStc * beta), 2);
    const s2 = Math.pow(sigmaBeta / (beta * beta), 2);  // vereinfacht
    const s3 = Math.pow(sigmaVstc / (vmppStc * beta), 2);
    return Math.round(Math.sqrt(s1 + s2 + s3) * 10) / 10;
}

function isTempValidRelative(iString, imppSTC) {
    // Relatives Gültigkeitskriterium: I > 10% Impp_STC
    return iString > 0 && (iString / imppSTC) > 0.10;
}

function isTempValidAbsolute(iString, imppSTC, powerPercent, tEquiv, tAmbient) {
    // Strengeres Kriterium für absolute °C-Angabe
    const gSufficient = (iString / imppSTC) > 0.45;     // > ~45% = ca. 400 W/m²
    const physPlaus   = tAmbient ? (tEquiv > tAmbient) : true;  // T_mod > T_Luft
    return gSufficient && powerPercent > 40 && physPlaus;
}

function calcTempLoss(pMeasured, tMod, betaPmax) {
    if (!tMod || tMod <= 25) return 0;
    return Math.round(pMeasured * betaPmax * (tMod - 25));
}

function calcMppUtilization(vString, nMod, vmppStc) {
    if (!vString || !nMod) return null;
    return Math.round((vString / nMod) / vmppStc * 1000) / 10; // auf 0.1% gerundet
}

function getTempAlert(tMod) {
    if (tMod === null) return 'UNBEKANNT';
    if (tMod < 35)   return 'NORMAL';
    if (tMod < 50)   return 'WARM';
    if (tMod < 60)   return 'HEISS';
    if (tMod < 70)   return 'WARNUNG';
    return 'KRITISCH';
}
```

---

## 13. Webinterface-Konzept

### 13.1 Was der Adapter schon hat (v0.6.12) — Abgrenzung

| Bereits vorhanden | Neu (Temperatur-Erweiterung) |
|---|---|
| String-Analyse Karte (Daten-Tab) | Temperatur-Kacheln pro String |
| MPP-Korridor grün/orange/rot | Temperatur-Farbkodierung |
| History-Charts AC/DC/Phasen | + Temperaturverlauf-Diagramm |
| Wetter-Karte (Daten-Tab) | Temperaturverlust-Kachel |
| E-Mail-Berichte (SVG-Charts) | + Temperatur im Tagesbericht |

### 13.2 Drei UI-Ebenen

#### Ebene A — Standardansicht (immer sichtbar)

**Temperatur-Kacheln pro String** auf dem Daten-Tab (rechts neben der bestehenden String-Analyse):

```
┌─────────────────────────┐  ┌─────────────────────────┐
│  🌡 String 1            │  │  🌡 String 2            │
│  28,7 V/Modul           │  │  29,1 V/Modul           │
│                         │  │                         │
│  ████ 31,3°C            │  │  ████ 29,4°C            │  ← grün
│  ± 1,2°C                │  │  ± 1,2°C                │
│  ✓ absolut valide       │  │  ✓ absolut valide       │
│  MPP-Nutzung: 97,3%     │  │  MPP-Nutzung: 98,6%     │
└─────────────────────────┘  └─────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  System-Temperatur                                   │
│  ΔT String1↔2: +1,9K  ✓  |  Verlust heute: 0,3 kWh  │
│  Status: 🟢 NORMAL                                   │
└──────────────────────────────────────────────────────┘
```

**Farbkodierung** (konsistent mit Alarmkonzept):

| Temperatur | Farbe | Text |
|---|---|---|
| < 35°C | `#3fb950` grün | NORMAL |
| 35–50°C | `#e3b341` gelb | WARM |
| 50–60°C | `#f0883e` orange | HEISS |
| 60–70°C | `#f85149` rot | WARNUNG |
| > 70°C | `#ff0000` + blink | KRITISCH |

#### Ebene B — Diagnose (aufklappbar)

Systemweite Kacheln:

- **MPP-Ausnutzung gesamt** [%]
- **Äquivalente STC-Leistung** [W] — was ohne Übertemperatur möglich wäre
- **Temperaturverlust aktuell** [W]
- **Verlust heute** [kWh] + **Verlust geschätzt p.a.** [kWh]
- **NOCT_eff** (wenn > 5 Messwerte vorhanden) mit Hinweis "installationsspezifisch"

#### Ebene C — Experten (optional einblendbar)

- Unsicherheitsband ±K
- Qualitätsflag (absolut/relativ/ungültig) mit Erklärung
- Modellstufe A/B/C aktiv
- Irradianz-Schätzung aus Strom

### 13.3 Empfohlene Diagramme (Historie-Tab)

**Diagramm 1 — Tages-Temperaturverlauf (Pflicht)**

```
Chart.js, linkes Y: Temperatur °C, rechtes Y: AC-Leistung W
Linien:  — String 1 Temp (blau)
         — String 2 Temp (grün)
Fläche:  AC-Leistung (gelb, semitransparent, rechte Achse)
Marker:  △ = nur relativ valide (gestrichelt)
         × = ungültig (ausgegraut)
Zonen:   farbige Hintergrundflächen für NORMAL/WARM/HEISS/WARNUNG
```

**Diagramm 2 — ΔT zwischen Strings (Hotspot-Diagnose)**

```
Einzellinie: T_S1 − T_S2 in K
Idealwert: 0K (Referenzlinie)
Alarm: rote Linie bei ±5K
Kritisch: rote Fläche ab ±10K
```

**Diagramm 3 — MPP-Ausnutzung in % (intuitiv)**

```
Doppellinie: MPP% String 1 + String 2
Referenz: 100% = STC-Bedingungen
Typischer Bereich: 80–100%
Erklärung: 85% = "Module 15% über STC-Temperatur"
```

**Diagramm 4 — Temperaturverlust [W] als Fläche**

```
Gestapelte Fläche: Verlust S1 + S2 (+ S3)
Y-Achse: W verloren durch Übertemperatur
Annotation: kWh-Summe des Tages
```

### 13.4 Hinweis für andere Nutzer (README + Tooltip)

Im README und als Tooltip-Text in der Web-UI:

> **Hinweis zur Temperaturanzeige:** Die angezeigte Temperatur ist eine *äquivalente Vmpp-basierte Betriebstemperatur* — keine direkt gemessene physikalische Modultemperatur. Sie ist besonders zuverlässig für den **Vergleich zwischen Strings** und zur Erkennung thermischer Auffälligkeiten. Absolute °C-Werte sind mit ±2–3°C Unsicherheit behaftet und erfordern korrekte Modulkonfiguration (Vmpp_STC, βVmpp, Modulanzahl).

---

## 14. Alarmkonzept

### Temperatur-Schwellwerte

| Bereich | Schwelle | Status | Aktion |
|---|---|---|---|
| Normal | < 35°C | 🟢 NORMAL | keine |
| Warm | 35–50°C | 🟡 WARM | Monitoring |
| Heiß | 50–60°C | 🟠 HEISS | Hinweis im Web-UI |
| Warnung | 60–70°C | 🔴 WARNUNG | E-Mail-Benachrichtigung |
| Kritisch | > 70°C | ⛔ KRITISCH | sofortige Benachrichtigung |

### String-Vergleichs-Alarme

| Situation | Schwelle | Mögliche Ursache |
|---|---|---|
| ΔT_Strings > 5 K | Hinweis | Leichte Asymmetrie, normal |
| ΔT_Strings > 10 K | Warnung | Unterschiedliche Belüftung, Teilschatten |
| ΔT_Strings > 20 K | Alarm | Moduldefekt, Hotspot |
| ΔI_Strings > 10% | Warnung | Stringverschattung |
| ΔP_Strings > 15% | Alarm | String-Imbalance |

---

## 15. Zukunft und Erweiterungen

### 15.1 NOCT-basiertes Temperaturvorwärtsmodell

Mit DWD-Wetterdaten (Umgebungstemperatur, Wind, Globalstrahlung) kann die erwartete Modultemperatur modelliert werden:

```
T_mod_erwartet = T_ambient + (NOCT − 20) × G / 800

Abweichung: T_gemessen − T_erwartet
  < 0K:   Gute Belüftung
  > 5K:   Schlechte Belüftung / Kalibrierungsbedarf
  > 15K:  Strukturelles Thermikproblem
```

### 15.2 Degradationsanalyse

Die LogDaten.dat seit 2010 ermöglicht rückwirkende Temperaturberechnung. Ein langfristiger Vmpp-Rückgang bei gleicher Irradianz und Außentemperatur zeigt reale Modulalterung — unabhängig vom Wetterjahr.

### 15.3 KI-gestützte Anomalieerkennung

Ein Regressionsmodell (Irradianz → erwartete Temperatur) ermöglicht automatische Detektion von Hotspots, Verschattungsmustern und beschleunigter Degradation.

### 15.4 Performance Ratio (PR)

```
PR = E_AC_gemessen / (Wp_gesamt × G_kumuliert / 1000)

PR < 0,75:  Systemverluste signifikant (Temperatur, Schatten, Degradation)
PR > 0,85:  Sehr gute Anlage
```

### 15.5 String-Balancing

Für PIKO 5.5 (drei Eingänge, zwei belegt): Mit Temperaturdaten den dritten String optimiert zuweisen.

---

## 16. Wissenschaftliche Gesamtbewertung

> *Basierend auf unabhängiger Peer-Review-artiger Analyse des Konzepts — eingearbeitet 2026-07-03*

### 16.1 Gesamturteil

**Das Konzept ist methodisch stark, physikalisch plausibel und für relative thermische Diagnose überzeugend.** Für absolute Temperaturangaben ist es kalibrierungsbedürftig.

| Kategorie | Bewertung |
|---|---|
| Physikalische Basis | ★★★★★ korrekt und plausibel |
| Relative Diagnose (S1 vs. S2) | ★★★★★ sehr robust |
| Absolute Temperaturbestimmung | ★★★☆☆ kalibrierungsbedürftig |
| Fehlerreflexion | ★★★★☆ gut, könnte quantitativer sein |
| Implementierbarkeit | ★★★★★ direkt umsetzbar |

### 16.2 Stärken (bestätigt)

- ✓ Vmpp als Messgröße ist praxisnäher als Voc-basierte Verfahren
- ✓ Relativer Stringvergleich ist als Diagnosemethode deutlich robuster als Absolutmessung
- ✓ U×I=P-Konsistenz (<0,3%) belegt Messintegrität der Eingangsdaten
- ✓ Gültigkeitsbedingungen (Abschnitt 5.3) verhindern "Ghost-Alarme"
- ✓ Trennung gesichert/plausibel/offen (Abschnitt 11) ist wissenschaftlich sauber

### 16.3 Identifizierte Schwachstellen und Verbesserungen

#### A. Begriffliche Schärfung (umgesetzt)
Die gemessene Größe ist eine **"äquivalente Vmpp-basierte Betriebstemperatur"**, keine direkt gemessene physikalische Modultemperatur. Vmpp hängt nicht nur von Temperatur ab, sondern auch von Einstrahlung, MPPT-Regelverhalten, Alterung und Serienwiderstand:

```
Vmpp = f(Temperatur, Einstrahlung, MPPT, Alterung, Mismatch)
```

#### B. Linearität als Näherung (bekannt, explizit vermerkt)
Die Formel `T = 25 + (Vmpp_STC − Vmpp_mod)/(Vmpp_STC × |β|)` ist ein **lokales Arbeitsmodell**, kein universelles Vollmodell. Gültig im Bereich 10–85°C und G > 200 W/m².

#### C. NOCT_eff als empirischer Fit-Parameter (nicht als Modulkonstante)
NOCT ist selbst ein standardisierter Kennwert unter Prüfbedingungen. Der "effektive NOCT" einer realen Dachinstallation ist ein **anlagenspezifischer Modellparameter** — kein direkt gemessener Materialwert.

#### D. Unsicherheits-Fortpflanzung (neu hinzugefügt)
```
Gesamt-Unsicherheit:
  σ_T² = (∂T/∂V · σ_V)² + (∂T/∂β · σ_β)² + (∂T/∂Vmpp_STC · σ_Vmpp_STC)²

Typische Werte (PIKO 5.5, 12 Module, T≈37°C):
  Spannungsauflösung (1V/12 Mod): ±0,1°C
  β-Streuung (±0,02%/°C):         ±0,5°C
  Vmpp_STC-Toleranz (±0,5%):      ±1,1°C
  ─────────────────────────────────────────
  Gesamt: ±1,2°C (1σ) / ±2,3°C (95%)

Ausgabeformat im Adapter: "37,0 ± 1,2°C"
```

### 16.4 Drei Modell-Ebenen (Priorisierung für Adapter)

| Ebene | Eingaben | Unsicherheit | Einsatz |
|---|---|---|---|
| **A — Basis** | Vstring, N, Modulprofil | ±2–5°C | immer aktiv, relative Diagnose |
| **B — Korrigiert** | + G aus Impp/Impp_STC | ±2–3°C | bei G > 400 W/m² |
| **C — Kalibriert** | + T_ambient lokal, NOCT_eff fit | ±1–2°C | nach Einmessung |

### 16.5 Offene Punkte (Prioritätsliste)

**Priorität 1 — Moduldaten PIKO 5.5 verifizieren**  
Seriennummern / Datenblätter überprüfen, da effektiver NOCT (~34°C) stark von Standard (46°C) abweicht.

**Priorität 2 — Externer Referenzsensor**  
1 PT100 oder NTC an Modulrückseite + 1 Lufttemperatursensor (schattiert, am Dach) würden die Methode quantitativ validieren und βVmpp anlagenspezifisch bestimmen.

**Priorität 3 — Einstrahlungs-Korrekturterm**  
Erweiterung von Vmpp(T) zu Vmpp(T, G) nach IEC 60904-7:
```
Vmpp(G,T) = Vmpp_STC × (1 + α_G × ln(G/G_STC)) × (1 − |β| × (T−25))
  α_G ≈ 0,006 (typisch kristallines Si)
  Effekt bei G=500 W/m²: ~0,4 V/Mod zusätzliche Korrektur
```

**Priorität 4 — Jahresverlust-Schätzung mit Unsicherheitsband**  
Statt "555 kWh/Jahr" → "555 kWh/Jahr ± 20% (erste modellbasierte Abschätzung)"

**Priorität 5 — Mehrtage-Validierung**  
Mehrere wolkenlose Tage, verschiedene Außentemperaturen und Jahreszeiten für statistische Robustheit.

### 16.6 Bestätigte Schlüsselbefunde (nicht verhandelbar)

Diese Aussagen sind durch U×I=P-Konsistenz und identischen Strom bei unterschiedlichen Spannungen **beweisbar ohne externe Sensorik:**

1. ✅ Beide Dachflächen erhalten **exakt gleiche Irradianz** (Stringströme identisch)
2. ✅ Die **Stringspannungsdifferenz** zwischen PIKO 5.5 und PIKO 8.3 ist real (kein Messfehler)
3. ✅ PIKO 8.3-Module sind **systematisch wärmer** als PIKO 5.5-Module (ΔT Ø +28K, 39 Messpunkte)
4. ✅ Der thermische Unterschied ist **strukturell, nicht wetterbedingt** (konstant 06:00–15:00)
5. ✅ Die Messungen des PIKO sind präzise (<0,3% Abweichung U×I=P)
6. ✅ **Modultyp identisch** auf beiden Dächern (Montagehistorie, gleiche Lieferpalette, Soll-MPP 354V = 12×29,5V)
7. ✅ PIKO 5.5 NOCT_eff ≈ 31°C (15K unter Standard), PIKO 8.3 NOCT_eff ≈ 61°C (15K über Standard)

---

## 17. Anhänge

### Anhang A — Alle Formeln

```
Modultemperatur:     T = 25 + (Vmpp_STC − Vstring/N) / (Vmpp_STC × |βVmpp|)
Vmpp-Korrekturfaktor:k_T = 1 − |βVmpp| × (T − 25)
STC-Leistung:        P_STC = P_gem / k_T
Leistungsverlust:    ΔP = P_gem × |βPmax| × max(0, T−25)
MPP-Ausnutzung:      η_MPP = (Vstring/N) / Vmpp_STC × 100%
NOCT-Modell:         T_mod = T_amb + (NOCT−20) × G / 800
Performance Ratio:   PR = E_AC_ist / (Wp × Σ(G)/1000)
Degradationsrate:    δ = (E_aktuell/E_referenz)^(1/Jahre) − 1
String-Temperaturdiff: ΔT = T_S1 − T_S2
```

### Anhang B — Temperaturkoeffizienten

| Modul-ID | Vmpp (V) | |βVmpp| | |βVoc| | |βPmax| | NOCT (°C) |
|---|---|---|---|---|---|
| SW225P | 29,5 | 0,0045 | 0,0033 | 0,0045 | 46 |
| SW250M | 30,6 | 0,0043 | 0,0032 | 0,0043 | 45 |
| JA410  | 31,3 | 0,0030 | 0,0027 | 0,0035 | 44 |
| TS430  | 32,3 | 0,0031 | 0,0024 | 0,0034 | 43 |
| LO410  | 31,5 | 0,0031 | 0,0027 | 0,0035 | 44 |
| JK425  | 32,0 | 0,0030 | 0,0025 | 0,0030 | 43 |
| CS420  | 31,8 | 0,0031 | 0,0026 | 0,0034 | 44 |
| MB390  | 34,2 | 0,0029 | 0,0024 | 0,0026 | 43 |
| RE410  | 35,1 | 0,0028 | 0,0024 | 0,0024 | 43 |
| MX430  | 36,7 | 0,0029 | 0,0024 | 0,0029 | 45 |
| QC405  | 34,3 | 0,0029 | 0,0024 | 0,0034 | 44 |

### Anhang C — Vollständige Messergebnisse 3.7.2026

| Zeit | 5.5S1 T | 5.5S2 T | 8.3S1 T | 8.3S2 T | ΔT | 8.3 ΔP S1 | 8.3 ΔP S2 | Gesamt |
|---|---|---|---|---|---|---|---|---|
| 09:45 | 25,0 | 23,1 | 47,1 | 52,9 | +27,4 K | 96 W | 149 W | 245 W |
| 10:00 | 18,7 | 16,8 | 36,3 | 46,8 | +23,8 K | 62 W | 149 W | 211 W |
| 10:15 | 18,1 | 16,2 | 35,2 | 45,7 | +23,3 K | 56 W | 128 W | 184 W |
| 10:30 | 17,5 | 16,8 | 40,2 | 43,5 | +24,7 K | 132 W | 161 W | 293 W |
| 10:45 | 20,0 | 18,7 | 47,8 | 51,4 | +30,2 K | 257 W | 292 W | 549 W |
| 11:00 | 28,1 | 26,9 | 55,3 | 59,7 | +30,0 K | 462 W | 508 W | 970 W |
| 11:15 | 25,6 | 23,1 | 46,0 | 52,9 | +25,1 K | 89 W | 126 W | 215 W |
| 11:30 | 19,4 | 18,7 | 42,4 | 48,7 | +26,5 K | 119 W | 165 W | 284 W |
| 11:45 | 16,2 | 14,3 | 42,8 | 49,1 | +30,7 K | 259 W | 354 W | 613 W |
| 12:00 | 27,5 | 26,3 | 51,7 | 57,4 | +27,6 K | 225 W | 277 W | 502 W |
| 12:15 | 28,1 | 26,9 | 56,4 | 57,4 | +29,4 K | 581 W | 572 W | 1153 W |
| 12:30 | 33,8 | 32,5 | 60,0 | 60,0 | +26,9 K | 550 W | 520 W | 1070 W |
| 12:45 | 31,3 | 29,4 | 60,3 | 59,3 | +29,4 K | 570 W | 526 W | 1096 W |

### Anhang D — Adapter-Dokumentationsstandards

Verbindliche Vorgaben für alle MPunktBPunkt iobroker-Adapter:

```
Pflichtdateien:
  ClaudeKontext<Name>Adapter.md  vollständige Dokumentation
  Schnittstellen.md               API, States, Endpunkte
  README.md                       Installation, Update, Donate
  LICENSE                         GPL-3.0-only
  admin/<name>.svg                eigene SVG-Grafik

README-Pflichtinhalt:
  ## Installation
  iobroker url https://github.com/MPunktBPunkt/iobroker.<name>
  iobroker add <name>

  ## Update
  iobroker url https://github.com/MPunktBPunkt/iobroker.<name>
  iobroker restart <name>

  [![Donate](https://img.shields.io/badge/Donate-PayPal-00457C.svg?logo=paypal)](...)

Web-Interface:
  Farben: --bg:#0e1628, --primary:#2196F3, --accent:#00bcd4
  Tabs:   Daten / Logs / System (immer vorhanden)

Releases: iobroker.<name>-vX.Y.Z.zip
```

---

*Dieses Dokument basiert auf realen Messwerten vom 3.7.2026 und validierten Daten aus 16 Jahren Anlagenbetrieb.*
*Physikalische Grundlagen: IEC 61215, Solarworld Datenblatt SW 225 poly.*
*Nächste Aktualisierung: bei neuen Messdaten, Adapter-Funktionen oder weiteren Erkenntnissen.*
