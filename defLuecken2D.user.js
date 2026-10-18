// ==UserScript==
// @name         GeoGebra Definitionslücken
// @namespace    https://github.com/HansPeterli/gapsInDefinitionGeoGebra
// @version      1.3
// @description  Erkennt und zeigt Definitionslücken (hebbare Unstetigkeiten) von Funktionen in GeoGebra automatisch an.
// @author       HansPeterli
// @match        https://www.geogebra.org/classic*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    let ggb = null;
    let bekannteDefinitionen = new Map();
    let bekannteSteuerwerte = new Map();
    const busySet = new Set();
    let intervallId = null;
    let listenerAktiv = false;
    function pflegeIntervall() {
        // Polling-Fallback läuft nur, solange mindestens eine 2D-Funktion bekannt ist
        // (oder wenn kein Event-Listener verfügbar ist).
        const noetig = !listenerAktiv || bekannteDefinitionen.size > 0;
        if (noetig && intervallId === null) {
            intervallId = setInterval(pruefeAlleFunktionen, 2000);
        } else if (!noetig && intervallId !== null) {
            clearInterval(intervallId);
            intervallId = null;
        }
    }

    // ------------------------------------------------------------------
    // Sprache: übernimmt automatisch die Sprache von GeoGebra
    // ------------------------------------------------------------------
    const TEXTE = {
        de: { steuer: "Lücken", luecke: "Definitionslücke", zeige: "Definitionslücken anzeigen", gekuerzt: "gekürzt" },
        en: { steuer: "Discontinuities", luecke: "Removable discontinuity", zeige: "Show removable discontinuities", gekuerzt: "simplified" },
        fr: { steuer: "Discontinuités", luecke: "Discontinuité éliminable", zeige: "Afficher les discontinuités éliminables", gekuerzt: "simplifiée" },
        es: { steuer: "Discontinuidades", luecke: "Discontinuidad evitable", zeige: "Mostrar discontinuidades evitables", gekuerzt: "simplificada" },
        it: { steuer: "Discontinuità", luecke: "Discontinuità eliminabile", zeige: "Mostra discontinuità eliminabili", gekuerzt: "semplificata" },
        pt: { steuer: "Descontinuidades", luecke: "Descontinuidade removível", zeige: "Mostrar descontinuidades removíveis", gekuerzt: "simplificada" },
        nl: { steuer: "Discontinuïteiten", luecke: "Hefbare discontinuïteit", zeige: "Hefbare discontinuïteiten tonen", gekuerzt: "vereenvoudigd" },
        pl: { steuer: "Nieciągłości", luecke: "Nieciągłość usuwalna", zeige: "Pokaż nieciągłości usuwalne", gekuerzt: "uproszczona" },
        cs: { steuer: "Nespojitosti", luecke: "Odstranitelná nespojitost", zeige: "Zobrazit odstranitelné nespojitosti", gekuerzt: "zjednodušená" },
        ru: { steuer: "Разрывы", luecke: "Устранимый разрыв", zeige: "Показать устранимые разрывы", gekuerzt: "упрощённая" },
        tr: { steuer: "Süreksizlikler", luecke: "Kaldırılabilir süreksizlik", zeige: "Kaldırılabilir süreksizlikleri göster", gekuerzt: "sadeleştirilmiş" }
    };
    function sprache() {
        let l = "";
        try {
            if (ggb && typeof ggb.getLanguage === "function") {
                l = ggb.getLanguage();
            }
        } catch (e) {}
        if (!l) {
            try {
                l = new URLSearchParams(window.location.search).get("lang") || "";
            } catch (e) {}
        }
        if (!l) {
            l = document.documentElement.lang || navigator.language || "";
        }
        l = String(l).toLowerCase().substring(0, 2);
        return TEXTE[l] ? l : "en";
    }
    function tr(schluessel) {
        return TEXTE[sprache()][schluessel];
    }

    // Name des Steuer-Booleans: ebenfalls in der Sprache von GeoGebra.
    // Existiert bereits ein Boolean in einer anderen Sprache, wird er weiterverwendet (und bei Bedarf umbenannt).
    function steuerPraefixe() {
        return Object.keys(TEXTE).map(function (l) {
            return TEXTE[l].steuer + "_";
        });
    }
    function steuerObjektNameNeu(funktionsName) {
        return TEXTE[sprache()].steuer + "_" + funktionsName;
    }
    function funktionsNameAusSteuer(name) {
        const ps = steuerPraefixe();
        for (let i = 0; i < ps.length; i++) {
            if (name.indexOf(ps[i]) === 0) {
                return name.substring(ps[i].length);
            }
        }
        return null;
    }
    function steuerObjektName(funktionsName) {
        const ps = steuerPraefixe();
        for (let i = 0; i < ps.length; i++) {
            try {
                if (ggb.exists(ps[i] + funktionsName)) {
                    return ps[i] + funktionsName;
                }
            } catch (e) {}
        }
        return steuerObjektNameNeu(funktionsName);
    }
    function pflegeSteuerSprache(funktionsName) {
        const alt = steuerObjektName(funktionsName);
        const neu = steuerObjektNameNeu(funktionsName);
        try {
            if (alt !== neu && ggb.exists(alt) && !ggb.exists(neu)) {
                ggb.renameObject(alt, neu);
                registrierteSteuerListener.delete(alt);
            }
            const s = steuerObjektName(funktionsName);
            if (ggb.exists(s)) {
                ggb.setCaption(s, tr("zeige"));
                ggb.setLabelStyle(s, 3);
            }
        } catch (e) {}
    }
    function hatYVariable(name) {
        // Funktionen mit zwei Variablen f(x,y) gehören zum 3D-Script und werden hier ignoriert.
        try {
            const d = String(ggb.getDefinitionString(name) || "");
            return /(^|[^A-Za-zÀ-ÖØ-öø-ÿ_])y(?![A-Za-zÀ-ÖØ-öø-ÿ0-9_])/.test(d);
        }catch(e) {
            return false;
        }
    }
    function istFunktionsTyp(name) {
        try {
            const type = ggb.getObjectType(name);
            if (type !== "function" && type !== "functionnv" && type !== "FUNCTION") {
                return false;
            }
            return !hatYVariable(name);
        }catch(e) {
            return false;
        }
    }
    function behandleObjektHinzugefuegt(name) {
        if (!name || !ggb) {
            return;
        }
        if (!istFunktionsTyp(name)) {
            return;
        }
        pruefeFunktionAufAenderung(name);
        aktualisiereLueckenSichtbarkeit(name);
    }
    function behandleObjektEntfernt(name) {
        if (!name) {
            return;
        }
        if (bekannteDefinitionen.has(name)) {
            console.log("[Lücken] Funktion gelöscht (Event):", name);
            loescheLueckenPunkte(name);
            const steuerName = steuerObjektName(name);
            try {
                if (ggb.exists(steuerName)) {
                    ggb.deleteObject(steuerName);
                }
            }catch(e) {}
            bekannteDefinitionen.delete(name);
            bekannteSteuerwerte.delete(name);
            pflegeIntervall();
        }
    }
    function behandleObjektAktualisiert(name) {
        if (!name || !ggb) {
            return;
        }
        if (bekannteDefinitionen.has(name)) {
            pruefeFunktionAufAenderung(name);
            aktualisiereLueckenSichtbarkeit(name);
            return;
        }
        const steuerFuer = funktionsNameAusSteuer(name);
        if (steuerFuer !== null && bekannteDefinitionen.has(steuerFuer)) {
            const funktionsName = steuerFuer;
            if (bekannteDefinitionen.has(funktionsName)) {
                aktualisiereLueckenSichtbarkeit(funktionsName);
            }
            return;
        }
        if (istFunktionsTyp(name)) {
            pruefeFunktionAufAenderung(name);
            aktualisiereLueckenSichtbarkeit(name);
        }
    }
    function verarbeiteZiel(ziel, behandler) {
        if (!ziel) {
            return;
        }
        if (Array.isArray(ziel)) {
            ziel.forEach(function(einzelnesZiel) {
                behandler(einzelnesZiel);
            });
        }else {
            behandler(ziel);
        }
    }
    function clientListener(event) {
        if (!ggb || !event) {
            return;
        }
        try {
            const typ = event.type;
            const ziel = event.target;
            switch(typ) {
                case"add":
                    verarbeiteZiel(ziel, behandleObjektHinzugefuegt);
                    break;
                case"remove":
                    verarbeiteZiel(ziel, behandleObjektEntfernt);
                    break;
                case"update":
                case"updateStyle":
                    verarbeiteZiel(ziel, behandleObjektAktualisiert);
                    break;
                case"renameComplete":
                    pruefeAlleFunktionen();
                    break;
                case"clear":
                    bekannteDefinitionen.clear();
                    bekannteSteuerwerte.clear();
                    pflegeIntervall();
                    break;
                case"viewChanged2D":
                case"viewChanged3D":
                    // Sichtbarer Bereich hat sich durch Zoomen/Verschieben geändert -
                    // periodische Nenner (z.B. sin(x)) können dadurch neue Lücken im
                    // Sichtbereich haben. Debounced neu analysieren.
                    planeAnsichtsAktualisierung();
                    break;
                default:
                    verarbeiteZiel(ziel, behandleObjektAktualisiert);
                    break;
            }
        }catch(e) {
            console.error("[Lücken] Fehler im Client-Listener:", e);
        }
    }
    function starte() {
        console.log("[Lücken] Script gestartet");
        if (typeof ggbApplet === "undefined") {
            console.log("[Lücken] Warte auf GeoGebra...");
            setTimeout(starte, 1000);
            return;
        }
        if (typeof ggbApplet.getObjectNumber !== "function") {
            console.log("[Lücken] GeoGebra vorhanden, API aber noch nicht bereit...");
            setTimeout(starte, 500);
            return;
        }
        try {
            ggbApplet.getObjectNumber();
        }catch(e) {
            console.log("[Lücken] GeoGebra-API wirft noch Fehler, warte weiter...");
            setTimeout(starte, 500);
            return;
        }
        ggb = ggbApplet;
        console.log("[Lücken] GeoGebra vollständig bereit");
        try {
            if (typeof ggb.registerClientListener === "function") {
                ggb.registerClientListener(clientListener);
                listenerAktiv = true;
                console.log("[Lücken] Client-Listener registriert (sofortige Reaktion aktiv)");
            } else {
                console.log("[Lücken] registerClientListener nicht verfügbar, nutze nur Intervall-Prüfung");
            }
        }catch(e) {
            console.error("[Lücken] Konnte Client-Listener nicht registrieren:", e);
        }
        pruefeAlleFunktionen();
        pflegeIntervall();
    }
    const registrierteSteuerListener = new Set();
    function registriereSteuerListener(funktionsName) {
        const steuerName = steuerObjektName(funktionsName);
        if (registrierteSteuerListener.has(steuerName)) {
            return;
        }
        try {
            if (typeof ggb.registerObjectUpdateListener === "function") {
                ggb.registerObjectUpdateListener(steuerName, function() {
                    aktualisiereLueckenSichtbarkeit(funktionsName);
                });
                registrierteSteuerListener.add(steuerName);
            }
        }catch(e) {
            console.error("[Lücken] Konnte Objekt-Listener nicht registrieren:", steuerName, e);
        }
    }
    function erstelleSteuerobjekt(funktionsName) {
        pflegeSteuerSprache(funktionsName);
        const steuerName = steuerObjektName(funktionsName);
        try {
            if (!ggb.exists(steuerName)) {
                ggb.evalCommand(steuerName+" = false");
                try {
                    ggb.setCaption(steuerName, tr("zeige"));
                    ggb.setLabelStyle(steuerName, 3);
                } catch(e) {}
                console.log("[Lücken] Steuerobjekt erstellt:", steuerName);
            }
        }catch(e) {
            console.error("[Lücken] Fehler beim Erstellen des Steuerobjekts:", steuerName, e);
        }
        registriereSteuerListener(funktionsName);
    }
    function loescheSteuerobjekt(funktionsName) {
        const steuerName = steuerObjektName(funktionsName);
        try {
            if (ggb.exists(steuerName)) {
                ggb.deleteObject(steuerName);
                console.log("[Lücken] Steuerobjekt entfernt (keine Lücken mehr):", steuerName);
            }
        }catch(e) {}
        registrierteSteuerListener.delete(steuerName);
    }
    function steuerungAktiv(funktionsName) {
        const steuerName = steuerObjektName(funktionsName);
        try {
            if (!ggb.exists(steuerName)) {
                return true;
            }
            const wert = ggb.getValue(steuerName);
            return wert === 1;
        }catch(e) {
            return true;
        }
    }
    function funktionSichtbar(funktionsName) {
        try {
            return ggb.getVisible(funktionsName);
        }catch(e) {
            return true;
        }
    }
    function sollLueckeSichtbarSein(funktionsName) {
        return steuerungAktiv(funktionsName) && funktionSichtbar(funktionsName);
    }
    function aktualisiereLueckenSichtbarkeit(funktionsName) {
        const sichtbar = sollLueckeSichtbarSein(funktionsName);
        let i = 1;
        while (true) {
            const punktName = "Luecke_"+funktionsName+"_"+i;
            let vorhanden = false;
            try {
                vorhanden = ggb.exists(punktName);
            }catch(e) {
                vorhanden = false;
            }
            if (!vorhanden) {
                break;
            }
            try {
                ggb.setVisible(punktName, sichtbar);
            }catch(e) {}
            i++;
        }
    }
    function pruefeAlleFunktionen() {
        if (!ggb) {
            return;
        }
        try {
            const anzahl = ggb.getObjectNumber();
            const aktuellVorhanden = new Set();
            for (let i = 0; i < anzahl; i++) {
                const name = ggb.getObjectName(i);
                if (!name) {
                    continue;
                }
                if (!istFunktionsTyp(name)) {
                    continue;
                }
                aktuellVorhanden.add(name);
                pruefeFunktionAufAenderung(name);
                aktualisiereLueckenSichtbarkeit(name);
            }
            for (const name of bekannteDefinitionen.keys()) {
                if (!aktuellVorhanden.has(name)) {
                    console.log("[Lücken] Funktion gelöscht:", name);
                    loescheLueckenPunkte(name);
                    const steuerName = steuerObjektName(name);
                    try {
                        if (ggb.exists(steuerName)) {
                            ggb.deleteObject(steuerName);
                        }
                    }catch(e) {}
                    bekannteDefinitionen.delete(name);
                    bekannteSteuerwerte.delete(name);
                }
            }
            pflegeIntervall();
        }catch(e) {
            console.error("[Lücken] Fehler:", e);
        }
    }
    const RESERVIERTE_BEZEICHNER = new Set(["x", "pi", "e", "sqrt", "abs"]);
    function extrahiereAbhaengigeVariablen(definition, eigenerName) {
        const gefunden = new Set();
        const regex = /[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*/g;
        let treffer;
        while ((treffer = regex.exec(definition)) !== null) {
            const wort = treffer[0];
            if (wort === eigenerName || RESERVIERTE_BEZEICHNER.has(wort)) {
                continue;
            }
            gefunden.add(wort);
        }
        return gefunden;
    }
    function vereinfacheEingesetzteWerte(s) {
        let vorher;
        do {
            vorher = s;
            s = s.replace(/\+\s*\(\s*-([0-9.]+)\s*\)/g, "-$1");
            s = s.replace(/-\s*\(\s*-([0-9.]+)\s*\)/g, "+$1");
            s = s.replace(/\+\s*\(\s*([0-9.]+)\s*\)/g, "+$1");
            s = s.replace(/-\s*\(\s*([0-9.]+)\s*\)/g, "-$1");
            s = s.replace(/\(\s*-([0-9.]+)\s*\)/g, "-$1");
            s = s.replace(/\(\s*([0-9.]+)\s*\)/g, "$1");
        }while (s !== vorher);
        return s;
    }
    function ersetzeVariablenDurchWerte(definition, eigenerName) {
        if (!definition) {
            return definition;
        }
        const regex = /[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*/g;
        let ersetzt = definition.replace(regex, function(wort) {
            if (wort === eigenerName || RESERVIERTE_BEZEICHNER.has(wort)) {
                return wort;
            }
            try {
                if (ggb.exists(wort) && istFunktionsTyp(wort) === false) {
                    const wert = ggb.getValue(wort);
                    if (isFinite(wert)) {
                        const gerundet = Math.round(wert*1e9)/1e9;
                        return "("+gerundet+")";
                    }
                }
            }catch(e) {}
            return wort;
        });
        return vereinfacheEingesetzteWerte(ersetzt);
    }
    function berechneSignatur(name, definition) {
        let signatur = definition;
        const variablen = extrahiereAbhaengigeVariablen(definition, name);
        variablen.forEach(function(v) {
            try {
                if (ggb.exists(v)) {
                    signatur += "|"+v+"="+ggb.getValue(v);
                }
            }catch(e) {}
        });
        return signatur;
    }
    function holeSichtGrenzen() {
        // Nutzt GeoGebras eingebauten Corner()-Befehl (Corner(1) = untere linke,
        // Corner(2) = untere rechte Ecke der Zeichenfläche), um den aktuell
        // sichtbaren x-Bereich zu ermitteln - unabhängig von Zoomstufe/Verschiebung.
        try {
            const xmin = ggb.getValue("x(Corner(1))");
            const xmax = ggb.getValue("x(Corner(2))");
            if (isFinite(xmin) && isFinite(xmax) && xmax > xmin) {
                return {
                    xmin: xmin,
                    xmax: xmax
                };
            }
        }catch(e) {}
        return null;
    }
    // Merkt sich pro Funktion, welcher x-Bereich beim letzten Durchlauf durchsucht
    // wurde (nur für Funktionen, die Stufe 3/den Sichtbereich überhaupt brauchen,
    // z.B. periodische Nenner wie sin(x)). Siehe planeAnsichtsAktualisierung.
    const letzterSuchbereich = new Map();
    let ansichtsDebounce = null;
    function planeAnsichtsAktualisierung() {
        if (letzterSuchbereich.size === 0) {
            return;
        }
        if (ansichtsDebounce) {
            clearTimeout(ansichtsDebounce);
        }
        ansichtsDebounce = setTimeout(function() {
            ansichtsDebounce = null;
            const sicht = holeSichtGrenzen();
            if (!sicht) {
                return;
            }
            for (const name of letzterSuchbereich.keys()) {
                const alt = letzterSuchbereich.get(name);
                // Kleiner Sicherheitsabstand (10% der Sichtbreite): löst erst aus,
                // wenn man sich dem Rand des zuletzt durchsuchten Puffers wirklich
                // nähert - normales Zoomen/Verschieben innerhalb des Puffers löst
                // KEINE Neuanalyse aus (kein Flackern/Verschwinden der Punkte).
                const puffer = Math.max(0.5, (sicht.xmax-sicht.xmin)*0.1);
                const nochGueltig = sicht.xmin >= alt.min+puffer && sicht.xmax <= alt.max-puffer;
                if (!nochGueltig && bekannteDefinitionen.has(name)) {
                    aktualisiereFunktion(name);
                    aktualisiereLueckenSichtbarkeit(name);
                }
            }
        }, 300);
    }
    const debounceTimer = new Map();
    function planeAktualisierung(name, verzoegerung) {
        if (debounceTimer.has(name)) {
            clearTimeout(debounceTimer.get(name));
        }
        const timer = setTimeout(function() {
            debounceTimer.delete(name);
            aktualisiereFunktion(name);
            aktualisiereLueckenSichtbarkeit(name);
        }, verzoegerung);
        debounceTimer.set(name, timer);
    }
    function pruefeFunktionAufAenderung(name) {
        const definition = holeDefinition(name);
        if (!definition) {
            return;
        }
        const signatur = berechneSignatur(name, definition);
        if (!bekannteDefinitionen.has(name)) {
            console.log("[Lücken] Neue Funktion:", name);
            bekannteDefinitionen.set(name, signatur);
            pflegeIntervall();
            planeAktualisierung(name, 0);
            // Sicherheits-Nachprüfung: GeoGebras CAS-Engine (für Solutions())
            // ist direkt nach dem Laden manchmal noch nicht vollständig bereit,
            // daher hier unabhängig vom Debounce noch ein zweiter Check etwas
            // später, damit Lücken nicht erst nach einer manuellen Änderung
            // (z.B. Schieberegler bewegen) korrekt erkannt werden.
            setTimeout(function() {
                aktualisiereFunktion(name);
                aktualisiereLueckenSichtbarkeit(name);
            }, 1000);
            return;
        }
        const alteSignatur = bekannteDefinitionen.get(name);
        if (alteSignatur !== signatur) {
            bekannteDefinitionen.set(name, signatur);
            // Kurzes Debounce (statt sofort löschen+neu anlegen): sammelt viele
            // schnell aufeinanderfolgende Events (z.B. beim Ziehen eines
            // Schiebereglers) zu einer einzigen, günstigeren Aktualisierung.
            planeAktualisierung(name, 60);
        }
    }
    const HOCHZAHLEN = {
        "⁰": "0",
        "¹": "1",
        "²": "2",
        "³": "3",
        "⁴": "4",
        "⁵": "5",
        "⁶": "6",
        "⁷": "7",
        "⁸": "8",
        "⁹": "9",
        "⁻": "-"
    };
    function normalisiereExponenten(s) {
        if (!s) {
            return s;
        }
        return s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, function(treffer) {
            let digits = "";
            for (const zeichen of treffer) {
                digits += HOCHZAHLEN[zeichen];
            }
            return"^"+digits;
        });
    }
    function normalisiereWurzeln(s) {
        if (!s || s.indexOf("√") === -1) {
            return s;
        }
        let ergebnis = "";
        let i = 0;
        while (i < s.length) {
            if (s[i] !== "√") {
                ergebnis += s[i];
                i++;
                continue;
            }
            let j = i+1;
            if (s[j] === "(") {
                let tiefe = 0;
                let k = j;
                for (; k < s.length; k++) {
                    if (s[k] === "(") {
                        tiefe++;
                    } else if (s[k] === ")") {
                        tiefe--;
                        if (tiefe === 0) {
                            break;
                        }
                    }
                }
                ergebnis += "sqrt("+s.substring(j+1, k)+")";
                i = k+1;
            } else {
                let start = j;
                while (j < s.length && /[0-9.]/.test(s[j])) {
                    j++;
                }
                if (j > start) {
                    ergebnis += "sqrt("+s.substring(start, j)+")";
                    i = j;
                } else {
                    ergebnis += "sqrt(";
                    i++;
                }
            }
        }
        return ergebnis;
    }
    function normalisiereKonstanten(s) {
        if (!s) {
            return s;
        }
        // π (griechischer Buchstabe) -> "pi"; verschiedene Unicode-Varianten von "e"
        // (z.B. Skript- oder Kursiv-e für die Eulersche Zahl) -> "e". Da GeoGebra
        // je nach Version/Plattform unterschiedliche Zeichen nutzen kann, fangen wir
        // zusätzlich per Unicode-Normalisierung (NFKC) generische "Buchstaben-Varianten"
        // ab (z.B. mathematisch-kursive Buchstaben), die sich sonst leicht der reinen
        // String-Ersetzung entziehen.
        s = s.replace(/π/g, "pi").replace(/[ℯⅇ]/g, "e");
        if (typeof s.normalize === "function") {
            try {
                s = s.normalize("NFKC");
            }catch(e) {}
        }
        return s;
    }
    function normalisiereBetraege(s) {
        if (!s) {
            return s;
        }
        // Manche GeoGebra-Versionen nutzen statt des einfachen Tastatur-Strichs "|"
        // das mathematische "Teilt"-Zeichen "∣" für Betragsstriche.
        s = s.replace(/∣/g, "|");
        if (s.indexOf("|") === -1) {
            return s;
        }
        let ergebnis = "";
        let i = 0;
        while (i < s.length) {
            if (s[i] === "|") {
                let j = i+1;
                while (j < s.length && s[j] !== "|") {
                    j++;
                }
                if (j < s.length) {
                    ergebnis += "abs("+s.substring(i+1, j)+")";
                    i = j+1;
                    continue;
                }
            }
            ergebnis += s[i];
            i++;
        }
        return ergebnis;
    }
    function normalisiereDefinition(s) {
        if (!s) {
            return s;
        }
        s = normalisiereExponenten(s);
        s = normalisiereWurzeln(s);
        s = normalisiereKonstanten(s);
        s = normalisiereBetraege(s);
        return s;
    }
    function holeDefinition(name) {
        let definition = null;
        try {
            if (typeof ggb.getDefinitionString === "function") {
                definition = ggb.getDefinitionString(name);
                if (definition && typeof definition === "string") {
                    return normalisiereDefinition(definition);
                }
            }
        }catch(e) {}
        try {
            if (typeof ggb.getCommandString === "function") {
                definition = ggb.getCommandString(name);
                if (definition && typeof definition === "string") {
                    return normalisiereDefinition(definition);
                }
            }
        }catch(e) {}
        try {
            if (typeof ggb.getValueString === "function") {
                definition = ggb.getValueString(name);
                if (definition && typeof definition === "string") {
                    return normalisiereDefinition(definition);
                }
            }
        }catch(e) {}
        return null;
    }
    function loescheLueckenPunkte(name) {
        let i = 1;
        while (true) {
            const pointName = "Luecke_"+name+"_"+i;
            let vorhanden = false;
            try {
                vorhanden = ggb.exists(pointName);
            }catch(e) {
                vorhanden = false;
            }
            if (!vorhanden) {
                break;
            }
            try {
                ggb.deleteObject(pointName);
            }catch(e) {}
            i++;
        }
    }
    function entferneAussenklammern(s) {
        s = s.trim();
        let veraendert = true;
        while (veraendert && s.startsWith("(") && s.endsWith(")")) {
            veraendert = false;
            let tiefe = 0;
            let passt = true;
            for (let i = 0; i < s.length; i++) {
                if (s[i] === "(") {
                    tiefe++;
                } else if (s[i] === ")") {
                    tiefe--;
                    if (tiefe === 0 && i !== s.length-1) {
                        passt = false;
                        break;
                    }
                }
            }
            if (passt && tiefe === 0) {
                s = s.substring(1, s.length-1).trim();
                veraendert = true;
            }
        }
        return s;
    }
    function findeNenner(definition) {
        if (!definition) {
            return[];
        }
        const gleich = definition.indexOf("=");
        const ausdruck = gleich===-1?definition: definition.substring(gleich+1);
        const nenner = [];
        for (let i = 0; i < ausdruck.length; i++) {
            if (ausdruck[i] !== "/") {
                continue;
            }
            let pos = i+1;
            while (pos < ausdruck.length && /\s/.test(ausdruck[pos])) {
                pos++;
            }
            if (ausdruck[pos] === "(") {
                let tiefe = 0;
                let ende=-1;
                for (let j = pos; j < ausdruck.length; j++) {
                    if (ausdruck[j] === "(") {
                        tiefe++;
                    } else if (ausdruck[j] === ")") {
                        tiefe--;
                        if (tiefe === 0) {
                            ende = j;
                            break;
                        }
                    }
                }
                if (ende===-1) {
                    continue;
                }
                let endeGesamt = ende+1;
                while (endeGesamt < ausdruck.length) {
                    if (ausdruck[endeGesamt] === "(") {
                        let t = 0;
                        let j = endeGesamt;
                        for (; j < ausdruck.length; j++) {
                            if (ausdruck[j] === "(") {
                                t++;
                            } else if (ausdruck[j] === ")") {
                                t--;
                                if (t === 0) {
                                    break;
                                }
                            }
                        }
                        endeGesamt = j+1;
                    } else {
                        break;
                    }
                }
                nenner.push(ausdruck.substring(pos, endeGesamt));
            } else {
                nenner.push(leseAtomarenNennerTerm(ausdruck, pos));
            }
        }
        return nenner;
    }
    function leseKlammerGruppe(s, start) {
        // s[start] muss "(" sein. Liefert den Index NACH der zugehörigen
        // schließenden Klammer (balanciert).
        let tiefe = 0;
        for (let j = start; j < s.length; j++) {
            if (s[j] === "(") {
                tiefe++;
            } else if (s[j] === ")") {
                tiefe--;
                if (tiefe === 0) {
                    return j+1;
                }
            }
        }
        return s.length;
    }
    function leseAtomarenNennerTerm(ausdruck, pos) {
        // Liest GENAU EINEN atomaren Term ab pos: eine Zahl (34, 3.14), einen
        // Bezeichner (x, pi, a) - optional gefolgt von einem eigenen
        // Funktionsaufruf wie sqrt(...) - und optional einem direkt
        // angehängten Exponenten (x^2, 34^2). Danach ist IMMER Schluss, auch
        // wenn ohne Operator ein weiterer Faktor folgt (implizite
        // Multiplikation, z.B. das "x" in "34 x" oder "sqrt(x) y"): dieser
        // gehört mathematisch NICHT mehr zum Nenner, da Division und
        // Multiplikation gleichrangig links-nach-rechts ausgewertet werden
        // ("14 / 34 x" = "(14 / 34) * x", nicht "14 / (34 x)").
        let ende = pos;
        if (ende < ausdruck.length && /[0-9.]/.test(ausdruck[ende])) {
            while (ende < ausdruck.length && /[0-9.]/.test(ausdruck[ende])) {
                ende++;
            }
        } else if (ende < ausdruck.length && /[A-Za-zÀ-ÖØ-öø-ÿ_]/.test(ausdruck[ende])) {
            while (ende < ausdruck.length && istBezeichnerZeichen(ausdruck[ende])) {
                ende++;
            }
            if (ausdruck[ende] === "(") {
                ende = leseKlammerGruppe(ausdruck, ende);
            }
        } else {
            return "";
        }
        if (ausdruck[ende] === "^") {
            let expEnde = ende+1;
            if (ausdruck[expEnde] === "-") {
                expEnde++;
            }
            if (ausdruck[expEnde] === "(") {
                expEnde = leseKlammerGruppe(ausdruck, expEnde);
            } else {
                while (expEnde < ausdruck.length && /[0-9.]/.test(ausdruck[expEnde])) {
                    expEnde++;
                }
            }
            if (expEnde > ende+1) {
                ende = expEnde;
            }
        }
        return ausdruck.substring(pos, ende);
    }
    function istBezeichnerZeichen(ch) {
        return /[A-Za-z0-9_]/.test(ch);
    }
    function extrahiereFaktoren(ausdruck) {
        let s = ausdruck.replace(/\s/g, "");
        s = entferneAussenklammern(s);
        const faktoren = [];
        let i = 0;
        while (i < s.length) {
            // Nur "echte" Gruppierungsklammern als eigenen Faktor behandeln - nicht die
            // Klammern eines Funktionsaufrufs wie abs(...), sqrt(...) etc. Eine Klammer
            // gehört zu einem Funktionsaufruf, wenn direkt davor ein Bezeichner-Zeichen steht.
            if (s[i] === "(" && !(i > 0 && istBezeichnerZeichen(s[i-1]))) {
                let tiefe = 0;
                let ende=-1;
                for (let j = i; j < s.length; j++) {
                    if (s[j] === "(") {
                        tiefe++;
                    } else if (s[j] === ")") {
                        tiefe--;
                        if (tiefe === 0) {
                            ende = j;
                            break;
                        }
                    }
                }
                if (ende!==-1) {
                    faktoren.push(s.substring(i, ende+1));
                    i = ende+1;
                    continue;
                }
            }
            i++;
        }
        if (faktoren.length === 0) {
            faktoren.push(s);
        }
        return faktoren;
    }
    function lineareNullstelle(ausdruck, exakteFormen) {
        let s = ausdruck.replace(/\s/g, "").replace(/−/g, "-");
        s = entferneAussenklammern(s);
        const match = s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)?)(?:\*?)x([+-](?:\d+(?:\.\d*)?|\.\d+)?)?$/);
        if (!match) {
            return[];
        }
        let a = match[1];
        if (a === "" || a === "+") {
            a = 1;
        } else if (a === "-") {
            a=-1;
        } else {
            a = Number(a);
        }
        let b = 0;
        if (match[2]) {
            b = Number(match[2]);
        }
        if (!isFinite(a)||!isFinite(b) || a === 0) {
            return[];
        }
        const x=-b/a;
        if (exakteFormen && istGanzzahlig(a) && istGanzzahlig(b)) {
            merkeExakteForm(exakteFormen, x, formatBruch(-b, a));
        }
        return[x];
    }
    function koeffizientWert(s) {
        if (s === "" || s === "+") {
            return 1;
        }
        if (s === "-") {
            return-1;
        }
        return Number(s);
    }
    function polynomKoeffizientenAllgemein(ausdruck) {
        let s = ausdruck.replace(/\s/g, "").replace(/−/g, "-");
        s = entferneAussenklammern(s);
        const terme = s.match(/[+-]?[^+-]+/g);
        if (!terme) {
            return null;
        }
        const zahl = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
        const reTerm = new RegExp("^([+-]?"+zahl+"?)(?:\\*?x(?:\\^(\\d+))?)?$");
        const gradKoeffizient = {};
        let maxGrad = 0;
        for (const term of terme) {
            const m = term.match(reTerm);
            if (!m) {
                return null;
            }
            let grad;
            let koeff;
            if (term.indexOf("x")===-1) {
                grad = 0;
                koeff = Number(m[1]);
                if (!isFinite(koeff)) {
                    return null;
                }
            } else {
                grad = m[2] !== undefined?parseInt(m[2], 10): 1;
                koeff = koeffizientWert(m[1]);
            }
            gradKoeffizient[grad] = (gradKoeffizient[grad] || 0)+koeff;
            if (grad > maxGrad) {
                maxGrad = grad;
            }
        }
        const coeffs = [];
        for (let g = maxGrad; g >= 0; g--) {
            coeffs.push(gradKoeffizient[g] || 0);
        }
        return coeffs;
    }
    function merkeExakteForm(exakteFormen, x, text) {
        exakteFormen.set(x.toFixed(6), text);
    }
    function ggT(a, b) {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b) {
            const t = b;
            b = a%b;
            a = t;
        }
        return a;
    }
    function istGanzzahlig(x) {
        return Math.abs(x-Math.round(x)) < 1e-9;
    }
    function formatBruch(zaehler, nenner) {
        zaehler = Math.round(zaehler);
        nenner = Math.round(nenner);
        if (nenner < 0) {
            zaehler=-zaehler;
            nenner=-nenner;
        }
        const g = ggT(zaehler, nenner) || 1;
        zaehler /= g;
        nenner /= g;
        if (nenner === 1) {
            return String(zaehler);
        }
        return zaehler+"/"+nenner;
    }
    function vereinfacheWurzel(n) {
        n = Math.round(n);
        let faktor = 1;
        let rest = n;
        for (let i = 2; i*i <= rest; i++) {
            while (rest%(i*i) === 0) {
                rest /= i*i;
                faktor *= i;
            }
        }
        return {
            faktor: faktor,
            rest: rest
        };
    }
    function formatiereWurzelPaar(b, diskriminante, a) {
        if (!istGanzzahlig(a)||!istGanzzahlig(b)||!istGanzzahlig(diskriminante) || diskriminante <= 0) {
            return null;
        }
        const wurzel = Math.sqrt(diskriminante);
        if (istGanzzahlig(wurzel)) {
            const k = Math.round(wurzel);
            return[
                formatBruch(-b+k, 2*a),
                formatBruch(-b-k, 2*a)
            ];
        }
        const zerlegt = vereinfacheWurzel(diskriminante);
        const p=-Math.round(b);
        const q = Math.round(2*a);
        function bauen(vorzeichen) {
            const k = vorzeichen*zerlegt.faktor;
            let g = ggT(ggT(p, k), q) || 1;
            let pp = p/g;
            let kk = k/g;
            let qq = q/g;
            if (qq < 0) {
                pp=-pp;
                kk=-kk;
                qq=-qq;
            }
            const radikal = (kk === 1?"": kk===-1?"-": String(kk))+"√"+zerlegt.rest;
            let zaehlerStr;
            if (pp === 0) {
                zaehlerStr = radikal;
            } else {
                zaehlerStr = pp+(kk >= 0?"+": "")+radikal;
            }
            if (qq === 1) {
                return zaehlerStr;
            }
            if (pp !== 0) {
                return"("+zaehlerStr+")/"+qq;
            }
            return zaehlerStr+"/"+qq;
        }
        return[
            bauen(1),
            bauen(-1)
        ];
    }
    function loeseLinearArray(a, b) {
        if (a === 0) {
            return[];
        }
        return[-b/a];
    }
    function loeseQuadratischArray(a, b, c) {
        if (a === 0) {
            return loeseLinearArray(b, c);
        }
        const diskriminante = b*b-4*a*c;
        if (diskriminante < 0) {
            return[];
        }
        if (diskriminante === 0) {
            return[-b/(2*a)];
        }
        const wurzel = Math.sqrt(diskriminante);
        return[
            (-b+wurzel)/(2*a),
            (-b-wurzel)/(2*a)
        ];
    }
    function loeseKubischArray(A, B, C, D) {
        if (A === 0) {
            return loeseQuadratischArray(B, C, D);
        }
        const p = (3*A*C-B*B)/(3*A*A);
        const q = (2*B*B*B-9*A*B*C+27*A*A*D)/(27*A*A*A);
        const verschiebung = B/(3*A);
        let t = [];
        if (Math.abs(p) < 1e-9 && Math.abs(q) < 1e-9) {
            t = [0];
        } else {
            const delta = (q*q)/4+(p*p*p)/27;
            if (delta > 1e-9) {
                const u = Math.cbrt(-q/2+Math.sqrt(delta));
                const v = Math.cbrt(-q/2-Math.sqrt(delta));
                t = [u+v];
            } else if (Math.abs(delta) <= 1e-9) {
                const u = Math.cbrt(-q/2);
                t = [
                    2*u,
                    -u
                ];
            } else {
                const r = Math.sqrt((-p*p*p)/27);
                const phi = Math.acos(Math.max(-1, Math.min(1, -q/2/r)));
                const m = 2*Math.sqrt(-p/3);
                t = [
                    m*Math.cos(phi/3),
                    m*Math.cos(phi/3-(2*Math.PI)/3),
                    m*Math.cos(phi/3-(4*Math.PI)/3)
                ];
            }
        }
        return t.map(function(ti) {
            return ti-verschiebung;
        });
    }
    function loeseNiedrigenGradArray(k) {
        const grad = k.length-1;
        if (grad <= 0) {
            return[];
        }
        if (grad === 1) {
            return loeseLinearArray(k[0], k[1]);
        }
        if (grad === 2) {
            return loeseQuadratischArray(k[0], k[1], k[2]);
        }
        return loeseKubischArray(k[0], k[1], k[2], k[3]);
    }
    function polyAuswerten(coeffs, x) {
        let ergebnis = 0;
        for (let i = 0; i < coeffs.length; i++) {
            ergebnis = ergebnis*x+coeffs[i];
        }
        return ergebnis;
    }
    function polyAbleitungKoeffizienten(coeffs) {
        const grad = coeffs.length-1;
        const abgeleitet = [];
        for (let i = 0; i < coeffs.length-1; i++) {
            abgeleitet.push(coeffs[i]*(grad-i));
        }
        return abgeleitet;
    }
    function newtonNullstelle(coeffs, x0) {
        const abl = polyAbleitungKoeffizienten(coeffs);
        let x = x0;
        for (let i = 0; i < 200; i++) {
            const fx = polyAuswerten(coeffs, x);
            const dfx = polyAuswerten(abl, x);
            if (Math.abs(dfx) < 1e-12) {
                return null;
            }
            const xNeu = x-fx/dfx;
            if (!isFinite(xNeu)) {
                return null;
            }
            if (Math.abs(xNeu-x) < 1e-10*Math.max(1, Math.abs(xNeu))) {
                x = xNeu;
                for (let j = 0; j < 5; j++) {
                    const fx2 = polyAuswerten(coeffs, x);
                    const dfx2 = polyAuswerten(abl, x);
                    if (Math.abs(dfx2) < 1e-12) {
                        break;
                    }
                    x = x-fx2/dfx2;
                }
                return x;
            }
            x = xNeu;
        }
        return null;
    }
    function cauchySchranke(coeffs) {
        const fuehrend = coeffs[0];
        let maxVerhaeltnis = 0;
        for (let i = 1; i < coeffs.length; i++) {
            maxVerhaeltnis = Math.max(maxVerhaeltnis, Math.abs(coeffs[i]/fuehrend));
        }
        return 1+maxVerhaeltnis;
    }
    function findeEineNullstelleNewton(coeffs) {
        const schranke = cauchySchranke(coeffs);
        const startwerte = [];
        for (let i=-10; i <= 10; i++) {
            startwerte.push(i);
        }
        for (let k = 0; k <= 40; k++) {
            startwerte.push(-schranke+(2*schranke*k)/40);
        }
        const grad = coeffs.length-1;
        for (const x0 of startwerte) {
            const wurzel = newtonNullstelle(coeffs, x0);
            if (wurzel !== null) {
                const skala = Math.max(1, Math.pow(Math.abs(wurzel), grad));
                if (Math.abs(polyAuswerten(coeffs, wurzel)) < 1e-6*skala) {
                    return wurzel;
                }
            }
        }
        return null;
    }
    function polynomDividieren(coeffs, nullstelle) {
        const quotient = [coeffs[0]];
        for (let i = 1; i < coeffs.length-1; i++) {
            quotient.push(coeffs[i]+quotient[i-1]*nullstelle);
        }
        return quotient;
    }
    function hoehereNullstellen(ausdruck) {
        const koeffizienten = polynomKoeffizientenAllgemein(ausdruck);
        if (!koeffizienten || koeffizienten.length-1 < 4) {
            return[];
        }
        let ergebnis = [];
        let k = koeffizienten.slice();
        while (k.length > 1 && Math.abs(k[0]) < 1e-9) {
            k.shift();
        }
        while (k.length-1 > 3) {
            const wurzel = findeEineNullstelleNewton(k);
            if (wurzel === null) {
                return[];
            }
            ergebnis.push(wurzel);
            k = polynomDividieren(k, wurzel);
        }
        return ergebnis.concat(loeseNiedrigenGradArray(k));
    }
    function quadratischeNullstellen(ausdruck, exakteFormen) {
        const k = polynomKoeffizientenAllgemein(ausdruck);
        if (!k || k.length-1 !== 2) {
            return[];
        }
        const wurzeln = loeseQuadratischArray(k[0], k[1], k[2]);
        if (exakteFormen && wurzeln.length === 2) {
            const diskriminante = k[1]*k[1]-4*k[0]*k[2];
            const formen = formatiereWurzelPaar(k[1], diskriminante, k[0]);
            if (formen) {
                merkeExakteForm(exakteFormen, wurzeln[0], formen[0]);
                merkeExakteForm(exakteFormen, wurzeln[1], formen[1]);
            }
        }
        return wurzeln;
    }
    function kubischeNullstellen(ausdruck) {
        const k = polynomKoeffizientenAllgemein(ausdruck);
        if (!k || k.length-1 !== 3) {
            return[];
        }
        return loeseKubischArray(k[0], k[1], k[2], k[3]);
    }
    function baueWurzelText(a, c, kern, vorzeichen) {
        const wurzelBasis = (c===1?"":String(c))+"√"+kern;
        if (a === 0) {
            return vorzeichen<0?"-"+wurzelBasis: wurzelBasis;
        }
        return a+(vorzeichen<0?" - ":" + ")+wurzelBasis;
    }
    function sucheWurzelForm(x) {
        const toleranz = 1e-7;
        for (let kern = 2; kern <= 100; kern++) {
            const w = Math.sqrt(kern);
            const wr = Math.round(w);
            if (wr*wr === kern) {
                continue;
            }
            for (let c = 1; c <= 10; c++) {
                for (let a = -30; a <= 30; a++) {
                    if (Math.abs(x-(a+c*w)) < toleranz) {
                        return baueWurzelText(a, c, kern, 1);
                    }
                    if (Math.abs(x-(a-c*w)) < toleranz) {
                        return baueWurzelText(a, c, kern, -1);
                    }
                }
            }
        }
        return null;
    }
    function sucheExakteForm(x) {
        const toleranz = 1e-7;
        if (Math.abs(x-Math.round(x)) < toleranz) {
            return String(Math.round(x));
        }
        for (let nenner = 2; nenner <= 20; nenner++) {
            const zaehler = x*nenner;
            if (Math.abs(zaehler-Math.round(zaehler)) < toleranz*nenner) {
                return formatBruch(Math.round(zaehler), nenner);
            }
        }
        const konstanten = [
            {
                symbol: "π",
                wert: Math.PI
            },
            {
                symbol: "e",
                wert: Math.E
            }
        ];
        for (const k of konstanten) {
            for (let zaehler=-12; zaehler <= 12; zaehler++) {
                if (zaehler === 0) {
                    continue;
                }
                for (let nenner = 1; nenner <= 12; nenner++) {
                    const wert = k.wert*zaehler/nenner;
                    if (Math.abs(x-wert) < toleranz*Math.max(1, Math.abs(wert))) {
                        const g = ggT(Math.abs(zaehler), nenner) || 1;
                        const z = zaehler/g;
                        const n = nenner/g;
                        let vorfaktor;
                        if (z === 1) {
                            vorfaktor = "";
                        } else if (z===-1) {
                            vorfaktor = "-";
                        } else {
                            vorfaktor = String(z);
                        }
                        return n === 1?vorfaktor+k.symbol: vorfaktor+k.symbol+"/"+n;
                    }
                }
            }
        }
        const wurzelForm = sucheWurzelForm(x);
        if (wurzelForm) {
            return wurzelForm;
        }
        return null;
    }
    function findeNullstellenMitGeoGebra(nenner, index, exakteFormen, sucheGrenzen) {
        const ergebnis = [];
        const tempName = "ggbLueckenNenner"+index+"_"+Date.now();
        const befehl = tempName+"(x)="+nenner;
        try {
            const erfolg = ggb.evalCommand(befehl);
            if (!erfolg || !ggb.exists(tempName)) {
                console.warn("[Lücken] Konnte Hilfsfunktion nicht erzeugen. Befehl:", befehl, "| evalCommand-Ergebnis:", erfolg, "| exists:", ggb.exists(tempName));
                return ergebnis;
            }
            const merken = function(x) {
                if (exakteFormen) {
                    const form = sucheExakteForm(x);
                    if (form) {
                        merkeExakteForm(exakteFormen, x, form);
                    }
                }
            };
            // Statt einer festen Grenze von ±100 orientieren wir uns am aktuell
            // sichtbaren x-Bereich der Zeichenfläche (plus Puffer von einer ganzen
            // Sichtbreite auf jeder Seite), den der Aufrufer (aktualisiereFunktion)
            // einmal pro Analyse-Durchlauf ermittelt und hier übergibt. So werden
            // bei periodischen Nennern (z.B. sin(x), die unendlich viele
            // Nullstellen haben) immer alle im sichtbaren Bereich liegenden Lücken
            // gefunden - und beim Zoomen/Verschieben wird automatisch neu gesucht,
            // sodass es sich für den Nutzer wie ein "unendlicher" Bereich anfühlt.
            // Ist der Sichtbereich nicht ermittelbar, greift als Rückfallebene
            // weiterhin die alte feste Grenze von ±100.
            const grenzeMin = sucheGrenzen?sucheGrenzen.min: -100;
            const grenzeMax = sucheGrenzen?sucheGrenzen.max: 100;
            // Feste Anzahl Abtastschritte (statt fester Schrittweite): bleibt
            // dadurch bei jeder Zoomstufe ähnlich performant, wird beim Reinzoomen
            // automatisch feiner und beim Rauszoomen automatisch gröber.
            const anzahlSchritte = 400;
            const schritt = Math.max(0.001, (grenzeMax-grenzeMin)/anzahlSchritte);
            let xLetzte = null;
            let yLetzte = null;
            let treffer = 0;
            for (let x=grenzeMin; x <= grenzeMax+1e-9; x += schritt) {
                const y = wertBei(tempName, x);
                if (isFinite(y)) {
                    if (xLetzte !== null && isFinite(yLetzte)) {
                        if (yLetzte === 0) {
                            ergebnis.push(xLetzte);
                            merken(xLetzte);
                        } else if ((yLetzte < 0 && y > 0) || (yLetzte > 0 && y < 0)) {
                            const wurzel = grenzeMitRoot(tempName, xLetzte, x, index, treffer);
                            treffer++;
                            if (wurzel !== null) {
                                ergebnis.push(wurzel);
                                merken(wurzel);
                            }
                        }
                    }
                    xLetzte = x;
                    yLetzte = y;
                } else {
                    xLetzte = null;
                    yLetzte = null;
                }
            }
        }catch(e) {
            console.warn("[Lücken] Fehler beim Auswerten. Befehl:", befehl, "| Fehler:", e);
        }
        try {
            ggb.deleteObject(tempName);
        }catch(e) {}
        return ergebnis;
    }
    function grenzeMitRoot(tempName, a, b, index, n) {
        const punktName = tempName+"_root_"+index+"_"+n;
        let x = null;
        try {
            ggb.evalCommand(punktName+" = Root("+tempName+", "+a+", "+b+")");
            if (ggb.exists(punktName)) {
                const wert = ggb.getXcoord(punktName);
                if (isFinite(wert)) {
                    x = wert;
                }
            }
        }catch(e) {}
        try {
            if (ggb.exists(punktName)) {
                ggb.deleteObject(punktName);
            }
        }catch(e) {}
        return x;
    }
    function sucheLineareFormel(faktorRoh) {
        const s = entferneAussenklammern(faktorRoh.replace(/\s/g, ""));
        let m = s.match(/^x([+-])([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*)$/);
        if (m && !RESERVIERTE_BEZEICHNER.has(m[2])) {
            return m[1]==="-"?m[2]: "-"+m[2];
        }
        m = s.match(/^([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*)([+-])x$/);
        if (m && !RESERVIERTE_BEZEICHNER.has(m[1])) {
            return m[2]==="-"?m[1]: "-"+m[1];
        }
        return null;
    }
    const listenQuelltext = new Map();
    function versucheAllgemeineFormel(faktorRoh, name, listenName) {
        const variablen = extrahiereAbhaengigeVariablen(faktorRoh, name);
        if (variablen.size === 0) {
            return null;
        }
        const existiertSchon = (function() {
            try {
                return ggb.exists(listenName);
            }catch(e) {
                return false;
            }
        })();
        const gleicheQuelle = listenQuelltext.get(listenName) === faktorRoh;
        if (!existiertSchon || !gleicheQuelle) {
            // Nur neu per (langsamem) CAS-Solutions()-Aufruf berechnen, wenn die
            // Liste noch nicht existiert oder sich der Faktor-Text strukturell
            // geändert hat. Bei reinen Wertänderungen (z.B. Regler bewegen) bleibt
            // die bestehende, bereits "lebendige" Liste unverändert bestehen - sie
            // aktualisiert sich über GeoGebras eigene Abhängigkeiten von selbst.
            try {
                if (existiertSchon) {
                    ggb.deleteObject(listenName);
                }
            }catch(e) {}
            let erfolg = false;
            try {
                erfolg = ggb.evalCommand(listenName+" = Solutions("+faktorRoh+"=0, x)");
            }catch(e) {
                erfolg = false;
            }
            if (!erfolg || !ggb.exists(listenName)) {
                try {
                    ggb.deleteObject(listenName);
                }catch(e) {}
                listenQuelltext.delete(listenName);
                return null;
            }
            listenQuelltext.set(listenName, faktorRoh);
            try {
                ggb.setAuxiliary(listenName, true);
                ggb.setVisible(listenName, false);
            }catch(e) {}
        }
        let anzahl = 0;
        try {
            anzahl = ggb.getValue("Length("+listenName+")");
        }catch(e) {
            anzahl = 0;
        }
        if (!isFinite(anzahl) || anzahl <= 0 || anzahl > 20) {
            try {
                ggb.deleteObject(listenName);
            }catch(e) {}
            listenQuelltext.delete(listenName);
            return null;
        }
        const ergebnisse = [];
        for (let k = 1; k <= anzahl; k++) {
            const formelText = "Element("+listenName+","+k+")";
            let xWert = NaN;
            try {
                xWert = ggb.getValue(formelText);
            }catch(e) {}
            if (isFinite(xWert)) {
                ergebnisse.push({
                    x: xWert,
                    formel: formelText
                });
            }
        }
        if (ergebnisse.length === 0) {
            try {
                ggb.deleteObject(listenName);
            }catch(e) {}
            listenQuelltext.delete(listenName);
            return null;
        }
        return ergebnisse;
    }
    function entferneDoppelte(werte) {
        const sauber = [];
        for (const x of werte) {
            if (!isFinite(x)) {
                continue;
            }
            let vorhanden = false;
            for (const y of sauber) {
                if (Math.abs(x-y) < 0.000001) {
                    vorhanden = true;
                    break;
                }
            }
            if (!vorhanden) {
                sauber.push(x);
            }
        }
        sauber.sort(function(a, b) {
            return a-b;
        });
        return sauber;
    }
    function wertBei(name, x) {
        try {
            const wert = ggb.getValue(name+"("+x+")");
            return isFinite(wert)?wert: NaN;
        }catch(e) {
            return NaN;
        }
    }
    function pruefeLuecke(name, x) {
        const abstaende = [
            0.01,
            0.001,
            0.0001,
            0.00001
        ];
        const links = [];
        const rechts = [];
        for (const delta of abstaende) {
            const l = wertBei(name, x-delta);
            const r = wertBei(name, x+delta);
            if (!isFinite(l)||!isFinite(r)) {
                return null;
            }
            links.push(l);
            rechts.push(r);
        }
        const l = links[links.length-1];
        const r = rechts[rechts.length-1];
        const toleranz = Math.max(0.0001, Math.max(Math.abs(l), Math.abs(r))*0.001);
        if (Math.abs(l-r) > toleranz) {
            return null;
        }
        return(l+r)/2;
    }
    function findeNullstellen(nenner, index, exakteFormen, sucheGrenzen) {
        let ergebnis = [];
        const faktoren = extrahiereFaktoren(nenner);
        for (let i = 0; i < faktoren.length; i++) {
            const faktor = faktoren[i];
            let teilergebnis = lineareNullstelle(faktor, exakteFormen);
            if (teilergebnis.length === 0) {
                teilergebnis = quadratischeNullstellen(faktor, exakteFormen);
            }
            if (teilergebnis.length === 0) {
                teilergebnis = kubischeNullstellen(faktor);
            }
            if (teilergebnis.length === 0) {
                teilergebnis = hoehereNullstellen(faktor);
            }
            if (teilergebnis.length === 0) {
                teilergebnis = findeNullstellenMitGeoGebra(entferneAussenklammern(faktor), index+"_"+i, exakteFormen, sucheGrenzen);
            }
            ergebnis = ergebnis.concat(teilergebnis);
        }
        return entferneDoppelte(ergebnis);
    }
    function erzeugeLueckenPunkt(name, nummer, x, y, exakteFormen, formel) {
        const pointName = "Luecke_"+name+"_"+nummer;
        try {
            if (ggb.exists(pointName)) {
                ggb.deleteObject(pointName);
            }
        }catch(e) {}
        let erfolgreichAlsFormel = false;
        if (formel) {
            try {
                const befehl = pointName+" = ("+formel+", Limit("+name+"(x), x, "+formel+"))";
                const erfolg = ggb.evalCommand(befehl);
                if (erfolg && ggb.exists(pointName)) {
                    erfolgreichAlsFormel = true;
                    console.log("[Lücken] Punkt als lebendige Formel erstellt:", befehl);
                }
            }catch(e) {}
        }
        if (!erfolgreichAlsFormel) {
            try {
                ggb.evalCommand(pointName+" = ("+x+", "+y+")");
            }catch(e) {
                return false;
            }
        }
        if (!ggb.exists(pointName)) {
            return false;
        }
        try {
            ggb.setPointStyle(pointName, 2);
        }catch(e) {}
        try {
            ggb.setPointSize(pointName, 7);
        }catch(e) {}
        try {
            ggb.setColor(pointName, 0, 0, 0);
        }catch(e) {}
        try {
            ggb.setFixed(pointName, true);
        }catch(e) {}
        const xAnzeige = Math.round(x*1000000)/1000000;
        const exakterText = exakteFormen && exakteFormen.get(x.toFixed(6));
        const istReineGanzzahl = exakterText && /^-?\d+$/.test(exakterText);
        let xBeschriftung;
        if (istReineGanzzahl && Number(exakterText) === xAnzeige) {
            // Garantiert konstanter, ganzzahliger Wert -> statische Beschriftung reicht.
            xBeschriftung = "x = "+exakterText;
        } else if (erfolgreichAlsFormel) {
            // Der Punkt ist eine lebendige Formel (hängt evtl. von einem Schieberegler /
            // Parameter ab). Damit sich die Beschriftung in Echtzeit mitbewegt, statt nur
            // beim nächsten Skript-Durchlauf aktualisiert zu werden, nutzen wir GeoGebras
            // eigenen dynamischen Beschriftungs-Platzhalter %x (x-Koordinate des Objekts
            // selbst). Der wird von GeoGebra bei jeder Neuberechnung automatisch ersetzt.
            xBeschriftung = exakterText ? ("x ≈ %x  ("+exakterText+")") : "x = %x";
        } else if (exakterText) {
            xBeschriftung = "x = "+exakterText+" (≈ "+xAnzeige+")";
        } else {
            xBeschriftung = "x = "+xAnzeige;
        }
        try {
            ggb.setCaption(pointName, tr("luecke")+" "+xBeschriftung);
            ggb.setLabelStyle(pointName, 3);
            ggb.setLabelVisible(pointName, true);
        }catch(e) {}
        try {
            ggb.setAuxiliary(pointName, true);
        }catch(e) {}
        try {
            ggb.setVisible(pointName, sollLueckeSichtbarSein(name));
        }catch(e) {}
        return true;
    }
    function aktualisiereFunktion(name) {
        if (busySet.has(name)) {
            return;
        }
        busySet.add(name);
        try {
            console.log("[Lücken] Analysiere neu:", name);
            const definitionRoh = holeDefinition(name);
            if (!definitionRoh) {
                loescheSteuerobjekt(name);
                loescheLueckenPunkte(name);
                letzterSuchbereich.delete(name);
                return;
            }
            const definition = ersetzeVariablenDurchWerte(definitionRoh, name);
            const abhaengigeVariablen = extrahiereAbhaengigeVariablen(definitionRoh, name);
            const hatParameter = abhaengigeVariablen.size > 0;
            const nennerRoh = findeNenner(definitionRoh);
            const nenner = findeNenner(definition);
            if (nenner.length === 0) {
                console.log("[Lücken] Kein Nenner.");
                loescheSteuerobjekt(name);
                loescheLueckenPunkte(name);
                letzterSuchbereich.delete(name);
                return;
            }
            let kandidaten = [];
            const formelZuX = new Map();
            const exakteFormen = new Map();
            const verwendeteListen = new Set();
            // Sichtbereich (für periodische Nenner wie sin(x)) nur EINMAL pro
            // Analyse-Durchlauf ermitteln, statt bei jedem einzelnen Faktor neu -
            // spart unnötige GeoGebra-API-Aufrufe und sorgt für konsistente Grenzen
            // innerhalb eines Durchlaufs.
            let sucheGrenzen = null;
            {
                const sicht = holeSichtGrenzen();
                if (sicht) {
                    const breite = Math.max(1, sicht.xmax-sicht.xmin);
                    sucheGrenzen = {
                        min: sicht.xmin-breite,
                        max: sicht.xmax+breite
                    };
                }
            }
            // Wird true, sobald ein Nenner-Faktor tatsächlich per numerischer
            // Sichtbereichs-Suche (Stufe 3) gelöst werden musste - nur dann lohnt
            // sich eine erneute Analyse bei reinem Zoomen/Verschieben (siehe
            // planeAnsichtsAktualisierung).
            let brauchtSichtBereich = false;
            for (let i = 0; i < nenner.length; i++) {
                const faktorenRoh = nennerRoh[i]?extrahiereFaktoren(nennerRoh[i]): [];
                const faktorenSub = extrahiereFaktoren(nenner[i]);
                for (let j = 0; j < faktorenSub.length; j++) {
                    const faktorRoh = faktorenRoh[j];
                    // Stufe 1: einfaches Muster (x-a, a-x, ...) - schnell, ohne CAS-Aufruf.
                    const einfacheFormel = faktorRoh?sucheLineareFormel(faktorRoh): null;
                    if (einfacheFormel) {
                        const teilergebnis = findeNullstellen(faktorenSub[j], i+"_"+j, exakteFormen);
                        for (const x of teilergebnis) {
                            kandidaten.push(x);
                            formelZuX.set(x.toFixed(6), einfacheFormel);
                        }
                        continue;
                    }
                    // Stufe 2: allgemeiner Fall mit Variable(n) - GeoGebras eigenes
                    // Solutions()-CAS-Kommando übernimmt das Auflösen. Deckt auch
                    // kompliziertere Faktoren mit Beträgen, Wurzeln usw. ab.
                    const listenName = "LoesListe_"+name+"_"+i+"_"+j;
                    const allgemein = faktorRoh?versucheAllgemeineFormel(faktorRoh, name, listenName): null;
                    if (allgemein) {
                        verwendeteListen.add(listenName);
                        for (const eintrag of allgemein) {
                            kandidaten.push(eintrag.x);
                            formelZuX.set(eintrag.x.toFixed(6), eintrag.formel);
                        }
                        continue;
                    }
                    // Stufe 3: Fallback - rein numerisch (z.B. wenn Solutions()
                    // scheitert, oder keine Variable im Faktor vorkommt).
                    brauchtSichtBereich = true;
                    const teilergebnis = findeNullstellen(faktorenSub[j], i+"_"+j, exakteFormen, sucheGrenzen);
                    kandidaten = kandidaten.concat(teilergebnis);
                }
            }
            // Verwaiste Lösungslisten von früheren Analysen entfernen (z.B. wenn
            // sich die Anzahl der Faktoren durch eine Bearbeitung geändert hat).
            for (let i = 0; i < 10; i++) {
                for (let j = 0; j < 10; j++) {
                    const kandidatName = "LoesListe_"+name+"_"+i+"_"+j;
                    if (verwendeteListen.has(kandidatName)) {
                        continue;
                    }
                    try {
                        if (ggb.exists(kandidatName)) {
                            ggb.deleteObject(kandidatName);
                        }
                    }catch(e) {}
                    listenQuelltext.delete(kandidatName);
                }
            }
            kandidaten = entferneDoppelte(kandidaten);
            console.log("[Lücken] Kandidaten:", kandidaten);
            const luecken = [];
            for (const x of kandidaten) {
                const y = pruefeLuecke(name, x);
                if (y !== null) {
                    luecken.push({
                        x: x,
                        y: y,
                        formel: formelZuX.get(x.toFixed(6))||null
                    });
                }
            }
            // Checkbox erscheint, wenn:
            // - tatsächlich mindestens eine echte (hebbare) Lücke vorliegt, ODER
            // - die Funktion von einem Parameter abhängt UND es mindestens einen
            //   Nenner-Kandidaten gibt. Dann könnte durch Ändern des Parameters
            //   jederzeit eine echte Lücke entstehen, auch wenn das beim
            //   aktuellen Parameterwert (noch) nicht der Fall ist.
            // Bei Funktionen OHNE Parameter (z.B. reine Polstelle wie 1/x) bleibt
            // die Box dagegen weg, wenn keine echte Lücke vorliegt, da sich das
            // Ergebnis nie ändern kann.
            if (luecken.length > 0 || (hatParameter && kandidaten.length > 0)) {
                erstelleSteuerobjekt(name);
            } else {
                loescheSteuerobjekt(name);
            }
            let counter = 1;
            for (const luecke of luecken) {
                erzeugeLueckenPunkt(name, counter, luecke.x, luecke.y, exakteFormen, luecke.formel);
                counter++;
            }
            // Übrig gebliebene Punkte von einer früheren Berechnung mit mehr
            // Lücken entfernen (z.B. wenn sich eine Variable so ändert, dass
            // aus 2 Lücken nur noch 1 wird).
            let ueberzaehligerIndex = counter;
            while (true) {
                const punktName = "Luecke_"+name+"_"+ueberzaehligerIndex;
                let vorhanden = false;
                try {
                    vorhanden = ggb.exists(punktName);
                }catch(e) {
                    vorhanden = false;
                }
                if (!vorhanden) {
                    break;
                }
                try {
                    ggb.deleteObject(punktName);
                }catch(e) {}
                ueberzaehligerIndex++;
            }
            aktualisiereLueckenSichtbarkeit(name);
            // Nur merken, wenn diese Funktion überhaupt vom Sichtbereich abhängt
            // (Stufe 3 wurde gebraucht, z.B. bei periodischen Nennern wie sin(x)).
            // Für alle anderen Funktionen soll ein reines Zoomen/Verschieben keine
            // erneute Analyse auslösen (siehe planeAnsichtsAktualisierung).
            if (brauchtSichtBereich && sucheGrenzen) {
                letzterSuchbereich.set(name, sucheGrenzen);
            } else {
                letzterSuchbereich.delete(name);
            }
            console.log("[Lücken] Neue Lücken:", luecken);
        }catch(e) {
            console.error("[Lücken] Fehler beim Aktualisieren:", e);
        }finally {
            busySet.delete(name);
        }
    }
    starte();
})();
