# npm-Release – iobroker.kostalpiko

Der Adapter wird **nicht** vom ioBroker-Server auf npm veröffentlicht.  
Publishing läuft über **GitHub Actions** beim Pushen eines Versions-Tags (`v*.*.*`).

---

## Einmalig: Trusted Publishing auf npmjs.com

1. Einloggen: https://www.npmjs.com/ (Account: **mpunktbpunkt**)
2. Paketseite öffnen (nach erstem Publish) oder unter **Packages** → **iobroker.kostalpiko**
3. **Settings** → **Publishing access** → **Add trusted publisher**
4. Exakt eintragen (Groß-/Kleinschreibung beachten):

| Feld | Wert |
|------|------|
| Provider | GitHub Actions |
| Repository owner | `MPunktBPunkt` |
| Repository name | `iobroker.kostalpiko` |
| Workflow filename | `test-and-release.yml` |
| Environment | *(leer lassen)* |

Referenz: [ioBroker Trusted Publishing](https://github.com/ioBroker/create-adapter/blob/master/docs/updates/20251013_trusted_deploy.md)

> **Hinweis:** Beim allerersten Publish existiert das Paket noch nicht.  
> Entweder Trusted Publisher **vor** dem Tag setzen (npm erlaubt das für neue Paketnamen),  
> oder einmalig manuell von einem **sauberen Git-Checkout** publishen (siehe unten).

---

## Release auslösen (Standard)

```bash
git pull origin main
git tag v0.6.21
git push origin v0.6.21
```

GitHub Actions (`test-and-release.yml`):

1. Lint + Tests (Node 22/24)
2. **deploy**-Job (nur bei Tag `v*.*.*`) → npm + GitHub Release

Fortschritt: https://github.com/MPunktBPunkt/iobroker.kostalpiko/actions

---

## Fallback: Erstes Publish manuell (nur wenn CI scheitert)

**Nicht** aus `/opt/iobroker/node_modules/` publishen!

```bash
git clone https://github.com/MPunktBPunkt/iobroker.kostalpiko.git
cd iobroker.kostalpiko
git checkout v0.6.21
npm ci
npm publish --access public
```

Danach Trusted Publishing einrichten (siehe oben) – künftige Releases nur noch per Tag.

---

## ioBroker nach npm-Release aktualisieren

```bash
iobroker stop kostalpiko
cd /opt/iobroker
npm update iobroker.kostalpiko
iobroker start kostalpiko
```

Oder weiterhin per GitHub-URL:

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kostalpiko
iobroker restart kostalpiko
```

---

## Nächster Schritt: ioBroker.repositories

Damit der Adapter im offiziellen Admin erscheint, PR an  
https://github.com/ioBroker/ioBroker.repositories  
(Eintrag `kostalpiko` in `sources-dist.json`).

Danach auf Issue #32 kommentieren: `@iobroker-bot recheck`
