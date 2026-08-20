# GeoGebra-Lücken-Skript (`defLuecke.js`)

Ein Userscript, das für GeoGebra-Funktionen automatisch **Definitionslücken** erkennt, sichtbar hält und sofort aktualisiert – inklusive Sichtbarkeits-Kopplung an die Funktion selbst und eine steuerbare Checkbox.

> ⚠️ **Wichtig:** Das Skript läuft nur, wenn GeoGebra im **Browser** geöffnet wird (z. B. Safari, Chrome, Edge, Firefox) – **nicht** in der nativen GeoGebra-App aus dem App Store / Play Store. In nativen Apps können keine Userscripts injiziert werden.

---

## Inhaltsverzeichnis

- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
  - [🪟 Windows (Chrome, Edge, Firefox)](#-windows-chrome-edge-firefox)
  - [🤖 Android](#-android)
  - [🍎 iOS / iPadOS (Safari)](#-ios--ipados-safari)
- [Fehlerbehebung](#fehlerbehebung)
- [Funktionsweise](#funktionsweise)

---

## Voraussetzungen

Du brauchst in jedem Browser einen **Userscript-Manager** – eine kleine Erweiterung, die das Skript automatisch auf der GeoGebra-Seite lädt. Empfohlen:

| Manager | Plattformen
|---|---|
| [Tampermonkey](https://www.tampermonkey.net/) | Windows, Android (via Kiwi/Firefox) |
| [Userscripts](https://github.com/quoid/userscripts) | iOS / iPadOS / macOS (Safari) |

---

## Installation

### 🪟 Windows (Chrome, Edge, Firefox)

1. **Tampermonkey installieren**
   - Chrome/Edge → [Chrome Web Store](https://chromewebstore.google.com/) bzw. Edge Add-ons → `Tampermonkey` suchen → hinzufügen.
   - Firefox → [addons.mozilla.org](https://addons.mozilla.org/) → `Tampermonkey` suchen → hinzufügen.
2. Auf das **Tampermonkey-Symbol** oben rechts im Browser klicken → **Dashboard** öffnen.
3. Reiter **„Neues Skript“** bzw. das **„+“**-Symbol anklicken.
4. Den kompletten Inhalt von `defLuecke.js` in den Editor kopieren (Beispieltext vorher löschen).
5. Mit <kbd>Strg</kbd> + <kbd>S</kbd> speichern.
6. GeoGebra öffnen: [geogebra.org/classic](https://www.geogebra.org/classic) (Seite ggf. neu laden, falls schon offen).

✅ **Kontrolle:** <kbd>F12</kbd> → Tab „Konsole“ → es sollten Meldungen wie `[Lücken] GeoGebra vollständig bereit` erscheinen.

---

### 🤖 Android

Der Standard-Chrome auf Android unterstützt **keine** Erweiterungen. Zwei Alternativen:

<details>
<summary><b>Variante A – Firefox für Android</b></summary>

1. [Firefox](https://play.google.com/store/apps/details?id=org.mozilla.firefox) aus dem Play Store installieren.
2. Menü → **Add-ons** → `Tampermonkey` suchen → installieren.
3. Skript wie gewohnt im Tampermonkey-Dashboard einfügen und speichern.
4. GeoGebra in Firefox öffnen.

</details>

<details>
<summary><b>Variante B – Kiwi Browser</b></summary>

1. [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser) aus dem Play Store installieren.
2. Kiwi Browser öffnen → Menü (⋮) → **Extensions**.
3. **„Weitere Erweiterungen laden“** → Chrome Web Store → `Tampermonkey` installieren.
4. Tampermonkey-Dashboard öffnen → neues Skript → Inhalt von `defLuecke.js` einfügen → speichern.
5. GeoGebra in Kiwi Browser öffnen: [geogebra.org/classic](https://www.geogebra.org/classic).

</details>

---

### 🍎 iOS / iPadOS (Safari)

<details>
<summary><b>Userscripts (kostenlos, Open Source)</b></summary>

1. Im App Store die kostenlose App [`Userscripts`](https://apps.apple.com/app/userscripts/id1463298887) installieren.
2. **Einstellungen** → **Safari** → **Erweiterungen** → `Userscripts` aktivieren und Website-Zugriff erlauben.
3. In der Userscripts-App einen Ordner für Skripte anlegen/auswählen und `defLuecke.js` dort ablegen (z. B. über die Dateien-App: **Teilen** → **In Dateien sichern** → gewählter Ordner).
4. Safari öffnen → GeoGebra laden – das Skript greift automatisch.

</details>

> 💡 Nach iOS-Updates wird die Erweiterung manchmal deaktiviert. Reagiert das Skript plötzlich nicht mehr: **Einstellungen → Safari → Erweiterungen** prüfen.

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| Skript reagiert gar nicht | Prüfen, ob der Userscript-Manager für die aktuelle Seite **aktiv** ist (Symbol in der Adressleiste/Toolbar zeigt Status). Seite komplett neu laden. |
| Keine Konsolen-Meldungen | Nur am Desktop sinnvoll prüfbar: <kbd>F12</kbd> → **Konsole**. Dort sollten `[Lücken] ...`-Zeilen erscheinen. |
| Öffnet sich in nativer App statt Browser | Direkt `https://www.geogebra.org/classic` in die Adressleiste eingeben statt einen Kurzlink zu antippen. |
| URL passt nicht zu `@match`/`@include` | Im Tampermonkey-Editor prüfen, ob die geöffnete GeoGebra-URL zu den im Skriptkopf hinterlegten Adressmustern passt; ggf. ergänzen. |

---

## Funktionsweise

- Erkennt automatisch alle Funktionen im Konstruktionsprotokoll und legt für jede eine Steuer-Checkbox `Lücken_<Name>` an.
- Berechnet Definitionslücken und zeigt sie als offene Punkte an.
- Ein Lückenpunkt ist **nur sichtbar**, wenn:
  - die zugehörige Checkbox **aktiviert** ist, **und**
  - die Funktion selbst **sichtbar** ist.
- Reagiert **sofort** (event-basiert über `registerClientListener` / `registerObjectUpdateListener`) auf:
  - Sichtbarkeits-Toggle der Funktion,
  - Klick auf die Steuer-Checkbox,
  - Hinzufügen, Ändern, Löschen oder Umbenennen von Funktionen.
- Ein `setInterval`-Fallback (alle 2 Sekunden) fängt Randfälle ab, die keine Events auslösen.
