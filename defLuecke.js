// ==UserScript==
// @name         GeoGebra Lücken automatisch
// @namespace    http://tampermonkey.net/
// @version      23.0
// @description  Erkennt hebbare Definitionslücken
// @author       Hans_Peterli
// @match        https://www.geogebra.org/*
// @grant        none
// @run-at       document-end
// @inject-into  page
// ==/UserScript==
(function() {
    'use strict';
    let ggb = null;
    let bekannteDefinitionen = new Map();
    let bekannteSteuerwerte = new Map();
    let busy = false;
    function istFunktionsTyp(name) {
        try {
            const type = ggb.getObjectType(name);
            return type === "function" || type === "functionnv" || type === "FUNCTION";
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
        if (name.indexOf("Lücken_") === 0) {
            const funktionsName = name.substring("Lücken_".length);
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
                console.log("[Lücken] Client-Listener registriert (sofortige Reaktion aktiv)");
            } else {
                console.log("[Lücken] registerClientListener nicht verfügbar, nutze nur Intervall-Prüfung");
            }
        }catch(e) {
            console.error("[Lücken] Konnte Client-Listener nicht registrieren:", e);
        }
        setInterval(pruefeAlleFunktionen, 2000);
        pruefeAlleFunktionen();
    }
    const registrierteSteuerListener = new Set();
    function steuerObjektName(funktionsName) {
        return"Lücken_"+funktionsName;
    }
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
        const steuerName = steuerObjektName(funktionsName);
        try {
            if (!ggb.exists(steuerName)) {
                ggb.evalCommand(steuerName+" = false");
                console.log("[Lücken] Steuerobjekt erstellt:", steuerName);
            }
        }catch(e) {
            console.error("[Lücken] Fehler beim Erstellen des Steuerobjekts:", steuerName, e);
        }
        registriereSteuerListener(funktionsName);
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
        const prefix = "Luecke_"+funktionsName+"_";
        try {
            const anzahl = ggb.getObjectNumber();
            for (let i = 0; i < anzahl; i++) {
                const objektName = ggb.getObjectName(i);
                if (objektName && objektName.startsWith(prefix)) {
                    try {
                        ggb.setVisible(objektName, sichtbar);
                    }catch(e) {}
                }
            }
        }catch(e) {
            console.error("[Lücken] Fehler bei Sichtbarkeit:", e);
        }
    }
    function pruefeAlleFunktionen() {
        if (!ggb || busy) {
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
                let type;
                try {
                    type = ggb.getObjectType(name);
                }catch(e) {
                    continue;
                }
                if (type !== "function" && type !== "functionnv" && type !== "FUNCTION") {
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
        }catch(e) {
            console.error("[Lücken] Fehler:", e);
        }
    }
    function pruefeFunktionAufAenderung(name) {
        const definition = holeDefinition(name);
        if (!definition) {
            return;
        }
        if (!bekannteDefinitionen.has(name)) {
            console.log("[Lücken] Neue Funktion:", name);
            bekannteDefinitionen.set(name, definition);
            erstelleSteuerobjekt(name);
            setTimeout(function() {
                aktualisiereFunktion(name);
                aktualisiereLueckenSichtbarkeit(name);
            }, 100);
            return;
        }
        const alteDefinition = bekannteDefinitionen.get(name);
        if (alteDefinition !== definition) {
            console.log("[Lücken] Funktion geändert:", name);
            console.log("[Lücken] Alt:", alteDefinition);
            console.log("[Lücken] Neu:", definition);
            bekannteDefinitionen.set(name, definition);
            loescheLueckenPunkte(name);
            setTimeout(function() {
                aktualisiereFunktion(name);
                aktualisiereLueckenSichtbarkeit(name);
            }, 100);
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
    function holeDefinition(name) {
        let definition = null;
        try {
            if (typeof ggb.getDefinitionString === "function") {
                definition = ggb.getDefinitionString(name);
                if (definition && typeof definition === "string") {
                    return normalisiereExponenten(definition);
                }
            }
        }catch(e) {}
        try {
            if (typeof ggb.getCommandString === "function") {
                definition = ggb.getCommandString(name);
                if (definition && typeof definition === "string") {
                    return normalisiereExponenten(definition);
                }
            }
        }catch(e) {}
        try {
            if (typeof ggb.getValueString === "function") {
                definition = ggb.getValueString(name);
                if (definition && typeof definition === "string") {
                    return normalisiereExponenten(definition);
                }
            }
        }catch(e) {}
        return null;
    }
    function loescheLueckenPunkte(name) {
        console.log("[Lücken] Lösche alte Punkte für:", name);
        try {
            const anzahl = ggb.getObjectNumber();
            const loeschen = [];
            for (let i = 0; i < anzahl; i++) {
                const objektName = ggb.getObjectName(i);
                if (!objektName) {
                    continue;
                }
                if (objektName.startsWith("Luecke_"+name+"_")) {
                    loeschen.push(objektName);
                }
            }
            for (const objektName of loeschen) {
                try {
                    ggb.deleteObject(objektName);
                    console.log("[Lücken] Gelöscht:", objektName);
                }catch(e) {}
            }
        }catch(e) {
            console.error("[Lücken] Fehler beim Löschen:", e);
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
        if (gleich===-1) {
            return[];
        }
        const ausdruck = definition.substring(gleich+1);
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
                let ende = pos;
                while (ende < ausdruck.length&&!"+-*/".includes(ausdruck[ende])) {
                    ende++;
                }
                nenner.push(ausdruck.substring(pos, ende));
            }
        }
        return nenner;
    }
    function extrahiereFaktoren(ausdruck) {
        let s = ausdruck.replace(/\s/g, "");
        s = entferneAussenklammern(s);
        const faktoren = [];
        let i = 0;
        while (i < s.length) {
            if (s[i] === "(") {
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
    function findeNullstellenMitGeoGebra(nenner, index) {
        const ergebnis = [];
        const tempName = "__LueckenNenner_"+index+"_"+Date.now();
        try {
            ggb.evalCommand(tempName+"(x)="+nenner);
            if (!ggb.exists(tempName)) {
                return ergebnis;
            }
            const grenze = 100;
            const schritt = 0.5;
            let xLetzte = null;
            let yLetzte = null;
            let treffer = 0;
            for (let x=-grenze; x <= grenze+1e-9; x += schritt) {
                const y = wertBei(tempName, x);
                if (isFinite(y)) {
                    if (xLetzte !== null && isFinite(yLetzte)) {
                        if (yLetzte === 0) {
                            ergebnis.push(xLetzte);
                        } else if ((yLetzte < 0 && y > 0) || (yLetzte > 0 && y < 0)) {
                            const wurzel = grenzeMitRoot(tempName, xLetzte, x, index, treffer);
                            treffer++;
                            if (wurzel !== null) {
                                ergebnis.push(wurzel);
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
        }catch(e) {}
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
    function findeNullstellen(nenner, index, exakteFormen) {
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
                teilergebnis = findeNullstellenMitGeoGebra(faktor, index+"_"+i);
            }
            ergebnis = ergebnis.concat(teilergebnis);
        }
        return entferneDoppelte(ergebnis);
    }
    function erzeugeLueckenPunkt(name, nummer, x, y, exakteFormen) {
        const pointName = "Luecke_"+name+"_"+nummer;
        try {
            if (ggb.exists(pointName)) {
                ggb.deleteObject(pointName);
            }
        }catch(e) {}
        try {
            ggb.evalCommand(pointName+" = ("+x+", "+y+")");
        }catch(e) {
            return false;
        }
        if (!ggb.exists(pointName)) {
            return false;
        }
        try {
            ggb.setPointStyle(pointName, 1);
        }catch(e) {}
        try {
            ggb.setPointSize(pointName, 7);
        }catch(e) {}
        try {
            ggb.setColor(pointName, 0, 0, 0);
        }catch(e) {}
        const xAnzeige = Math.round(x*1000000)/1000000;
        const exakterText = exakteFormen && exakteFormen.get(x.toFixed(6));
        const xBeschriftung = exakterText?"x = "+exakterText+" (≈ "+xAnzeige+")": "x = "+xAnzeige;
        try {
            ggb.setCaption(pointName, "Definitionslücke "+xBeschriftung);
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
        if (busy) {
            return;
        }
        busy = true;
        try {
            console.log("[Lücken] Analysiere neu:", name);
            const definition = holeDefinition(name);
            if (!definition) {
                return;
            }
            const nenner = findeNenner(definition);
            if (nenner.length === 0) {
                console.log("[Lücken] Kein Nenner.");
                return;
            }
            let kandidaten = [];
            const exakteFormen = new Map();
            for (let i = 0; i < nenner.length; i++) {
                kandidaten = kandidaten.concat(findeNullstellen(nenner[i], i, exakteFormen));
            }
            kandidaten = entferneDoppelte(kandidaten);
            console.log("[Lücken] Kandidaten:", kandidaten);
            const luecken = [];
            for (const x of kandidaten) {
                const y = pruefeLuecke(name, x);
                if (y !== null) {
                    luecken.push({
                        x: x,
                        y: y
                    });
                }
            }
            let counter = 1;
            for (const luecke of luecken) {
                erzeugeLueckenPunkt(name, counter, luecke.x, luecke.y, exakteFormen);
                counter++;
            }
            aktualisiereLueckenSichtbarkeit(name);
            console.log("[Lücken] Neue Lücken:", luecken);
        }catch(e) {
            console.error("[Lücken] Fehler beim Aktualisieren:", e);
        }finally {
            busy = false;
        }
    }
    starte();
})();
