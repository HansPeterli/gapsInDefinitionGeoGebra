// ==UserScript==
// @name         GeoGebra Definitionslücken 3D
// @namespace    https://github.com/HansPeterli/gapsInDefinitionGeoGebra
// @version      1.3
// @description  Erkennt Definitionslücken (hebbare Unstetigkeiten) von Funktionen f(x,y) in GeoGebra 3D und markiert sie als 3D-Punkte (x | y | z).
// @author       HansPeterli
// @match        https://www.geogebra.org/classic*
// @match        https://www.geogebra.org/3d*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let ggb = null;
    const bekannteSignaturen = new Map();   // Funktionsname -> Signatur (Definition + Parameterwerte)
    const erzeugteObjekte = new Map();      // Funktionsname -> Set mit Namen der erzeugten Punkte/Listen
    const letzteBox = new Map();            // Funktionsname -> zuletzt durchsuchter (x,y)-Bereich
    const busySet = new Set();
    let intervallId = null;
    let listenerAktiv = false;
    function pflegeIntervall() {
        // Polling-Fallback läuft nur, solange mindestens eine Funktion f(x,y) bekannt ist
        // (oder wenn kein Event-Listener verfügbar ist).
        const noetig = !listenerAktiv || bekannteSignaturen.size > 0;
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
            return TEXTE[l].steuer + "3D_";
        });
    }
    function steuerObjektNameNeu(funktionsName) {
        return TEXTE[sprache()].steuer + "3D_" + funktionsName;
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
    const debounceTimer = new Map();
    const registrierteSteuerListener = new Set();
    let ansichtsDebounce = null;
    let deadline = Infinity;

    const RESERVIERT = new Set([
        "x", "y", "z", "pi", "e", "sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan",
        "atan2", "sinh", "cosh", "tanh", "exp", "ln", "log", "lg", "ld", "sgn", "sign",
        "floor", "ceil", "round", "cbrt", "nroot", "min", "max", "gamma", "erf", "random"
    ]);
    const BEZ = "[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*";

    // ------------------------------------------------------------------
    // Erkennung: Funktion mit zwei Variablen x und y
    // ------------------------------------------------------------------
    function hatVariable(s, v) {
        return new RegExp("(^|[^A-Za-zÀ-ÖØ-öø-ÿ_])" + v + "(?![A-Za-zÀ-ÖØ-öø-ÿ0-9_])").test(s);
    }

    function istFlaechenFunktion(name) {
        try {
            if (!ggb.exists(name)) {
                return false;
            }
            const typ = String(ggb.getObjectType(name)).toLowerCase();
            if (typ.indexOf("function") === -1 && typ.indexOf("surface") === -1) {
                return false;
            }
            const d = holeDefinition(name);
            return !!d && hatVariable(d, "y");
        } catch (e) {
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Definition holen und normalisieren
    // ------------------------------------------------------------------
    const HOCHZAHLEN = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };

    function normalisiereExponenten(s) {
        return s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, function (t) {
            let d = "";
            for (const z of t) {
                d += HOCHZAHLEN[z];
            }
            return "^" + d;
        });
    }

    function leseKlammerGruppe(s, start) {
        // s[start] ist "(" -> Index NACH der passenden ")"
        let tiefe = 0;
        for (let j = start; j < s.length; j++) {
            if (s[j] === "(") {
                tiefe++;
            } else if (s[j] === ")") {
                tiefe--;
                if (tiefe === 0) {
                    return j + 1;
                }
            }
        }
        return s.length;
    }

    function normalisiereWurzeln(s) {
        if (s.indexOf("√") === -1) {
            return s;
        }
        let erg = "";
        let i = 0;
        while (i < s.length) {
            if (s[i] !== "√") {
                erg += s[i];
                i++;
                continue;
            }
            const j = i + 1;
            if (s[j] === "(") {
                const ende = leseKlammerGruppe(s, j);
                erg += "sqrt(" + s.substring(j + 1, ende - 1) + ")";
                i = ende;
            } else {
                let k = j;
                while (k < s.length && /[0-9.A-Za-z_À-ÖØ-öø-ÿ]/.test(s[k])) {
                    k++;
                }
                erg += "sqrt(" + s.substring(j, k) + ")";
                i = k;
            }
        }
        return erg;
    }

    function normalisiereKonstanten(s) {
        s = s.replace(/π/g, "pi").replace(/[ℯⅇ]/g, "e");
        try {
            s = s.normalize("NFKC");
        } catch (e) {}
        return s;
    }

    function normalisiereBetraege(s) {
        s = s.replace(/∣/g, "|");
        if (s.indexOf("|") === -1) {
            return s;
        }
        let erg = "";
        let i = 0;
        while (i < s.length) {
            if (s[i] === "|") {
                let j = i + 1;
                while (j < s.length && s[j] !== "|") {
                    j++;
                }
                if (j < s.length) {
                    erg += "abs(" + s.substring(i + 1, j) + ")";
                    i = j + 1;
                    continue;
                }
            }
            erg += s[i];
            i++;
        }
        return erg;
    }

    function normalisiereDefinition(s) {
        return normalisiereBetraege(normalisiereKonstanten(normalisiereWurzeln(normalisiereExponenten(s))));
    }

    function holeDefinition(name) {
        const quellen = ["getDefinitionString", "getCommandString", "getValueString"];
        for (const q of quellen) {
            try {
                if (typeof ggb[q] === "function") {
                    const d = ggb[q](name);
                    if (d && typeof d === "string") {
                        return normalisiereDefinition(d);
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Parameter (Schieberegler etc.) durch aktuelle Werte ersetzen
    // ------------------------------------------------------------------
    function extrahiereAbhaengigeVariablen(definition, eigenerName) {
        const gefunden = new Set();
        const regex = new RegExp(BEZ, "g");
        let t;
        while ((t = regex.exec(definition)) !== null) {
            if (t[0] !== eigenerName && !RESERVIERT.has(t[0])) {
                try {
                    if (ggb.exists(t[0])) {
                        gefunden.add(t[0]);
                    }
                } catch (e) {}
            }
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
        } while (s !== vorher);
        return s;
    }

    function ersetzeVariablenDurchWerte(definition, eigenerName) {
        const regex = new RegExp(BEZ, "g");
        const ersetzt = definition.replace(regex, function (wort) {
            if (wort === eigenerName || RESERVIERT.has(wort)) {
                return wort;
            }
            try {
                if (ggb.exists(wort) && !istFlaechenFunktion(wort)) {
                    const typ = String(ggb.getObjectType(wort)).toLowerCase();
                    if (typ.indexOf("function") !== -1) {
                        return wort;
                    }
                    const wert = ggb.getValue(wort);
                    if (isFinite(wert)) {
                        return "(" + wert.toFixed(9).replace(/\.?0+$/, "") + ")";
                    }
                }
            } catch (e) {}
            return wort;
        });
        return vereinfacheEingesetzteWerte(ersetzt);
    }

    function berechneSignatur(name, definition) {
        let sig = definition;
        extrahiereAbhaengigeVariablen(definition, name).forEach(function (v) {
            try {
                sig += "|" + v + "=" + ggb.getValue(v);
            } catch (e) {}
        });
        return sig;
    }

    // ------------------------------------------------------------------
    // Nenner und Faktoren aus dem Definitionsstring lesen
    // ------------------------------------------------------------------
    function entferneAussenklammern(s) {
        s = s.trim();
        while (s.startsWith("(") && s.endsWith(")") && leseKlammerGruppe(s, 0) === s.length) {
            s = s.substring(1, s.length - 1).trim();
        }
        return s;
    }

    function istBezeichnerZeichen(ch) {
        return /[A-Za-z0-9_]/.test(ch);
    }

    function leseAtomarenNennerTerm(s, pos) {
        let ende = pos;
        if (ende < s.length && /[0-9.]/.test(s[ende])) {
            while (ende < s.length && /[0-9.]/.test(s[ende])) {
                ende++;
            }
        } else if (ende < s.length && /[A-Za-zÀ-ÖØ-öø-ÿ_]/.test(s[ende])) {
            while (ende < s.length && istBezeichnerZeichen(s[ende])) {
                ende++;
            }
            if (s[ende] === "(") {
                ende = leseKlammerGruppe(s, ende);
            }
        } else {
            return "";
        }
        if (s[ende] === "^") {
            let e2 = ende + 1;
            if (s[e2] === "-") {
                e2++;
            }
            if (s[e2] === "(") {
                e2 = leseKlammerGruppe(s, e2);
            } else {
                while (e2 < s.length && /[0-9.]/.test(s[e2])) {
                    e2++;
                }
            }
            if (e2 > ende + 1) {
                ende = e2;
            }
        }
        return s.substring(pos, ende);
    }

    function findeNenner(definition) {
        if (!definition) {
            return [];
        }
        const gleich = definition.indexOf("=");
        const ausdruck = gleich === -1 ? definition : definition.substring(gleich + 1);
        const nenner = [];
        for (let i = 0; i < ausdruck.length; i++) {
            if (ausdruck[i] !== "/") {
                continue;
            }
            let pos = i + 1;
            while (pos < ausdruck.length && /\s/.test(ausdruck[pos])) {
                pos++;
            }
            if (ausdruck[pos] === "(") {
                let ende = leseKlammerGruppe(ausdruck, pos);
                while (ausdruck[ende] === "(") {
                    ende = leseKlammerGruppe(ausdruck, ende);
                }
                nenner.push(ausdruck.substring(pos, ende));
            } else {
                const t = leseAtomarenNennerTerm(ausdruck, pos);
                if (t) {
                    nenner.push(t);
                }
            }
        }
        return nenner;
    }

    function extrahiereFaktoren(ausdruck) {
        // Whitespace bleibt erhalten ("x y" darf nicht zu "xy" werden!)
        const s = entferneAussenklammern(ausdruck);
        // Summe/Differenz auf oberster Ebene -> ein einziger Faktor
        let tiefe = 0;
        for (let i = 1; i < s.length; i++) {
            const c = s[i];
            if (c === "(") {
                tiefe++;
            } else if (c === ")") {
                tiefe--;
            } else if (tiefe === 0 && (c === "+" || c === "-")) {
                let k = i - 1;
                while (k >= 0 && s[k] === " ") {
                    k--;
                }
                if (k >= 0 && "^(*/+-".indexOf(s[k]) === -1) {
                    return [s];
                }
            }
        }
        const faktoren = [];
        let i = 0;
        while (i < s.length) {
            if (s[i] === "(" && !(i > 0 && istBezeichnerZeichen(s[i - 1]))) {
                const ende = leseKlammerGruppe(s, i);
                faktoren.push(s.substring(i, ende));
                i = ende;
                continue;
            }
            i++;
        }
        if (faktoren.length === 0) {
            faktoren.push(s);
        }
        return faktoren;
    }

    // ------------------------------------------------------------------
    // Auswertung: Ausdruck in x,y bzw. Funktion f(x,y) an einer Stelle
    // ------------------------------------------------------------------
    function zahl(v) {
        return "(" + v.toFixed(12) + ")";
    }

    function baueAuswerter(ausdruck) {
        // Zerlegt den Ausdruck an den freistehenden Variablen x und y, damit pro Auswertung
        // nur noch Zahlen eingesetzt werden müssen.
        const texte = [];
        const vars = [];
        const re = new RegExp(BEZ, "g");
        let letzter = 0;
        let m;
        while ((m = re.exec(ausdruck)) !== null) {
            if (m[0] === "x" || m[0] === "y") {
                texte.push(ausdruck.substring(letzter, m.index));
                vars.push(m[0]);
                letzter = m.index + 1;
            }
        }
        texte.push(ausdruck.substring(letzter));
        return function (x, y) {
            let s = texte[0];
            for (let i = 0; i < vars.length; i++) {
                s += zahl(vars[i] === "x" ? x : y) + texte[i + 1];
            }
            try {
                const w = ggb.getValue(s);
                return isFinite(w) ? w : NaN;
            } catch (e) {
                return NaN;
            }
        };
    }

    function fWert(name, x, y) {
        try {
            const w = ggb.getValue(name + "(" + zahl(x) + "," + zahl(y) + ")");
            return isFinite(w) ? w : NaN;
        } catch (e) {
            return NaN;
        }
    }

    // ------------------------------------------------------------------
    // Suchbereich (sichtbarer x/y-Bereich der 3D-Ansicht)
    // ------------------------------------------------------------------
    function holeSichtGrenzen() {
        try {
            const xs = [];
            const ys = [];
            for (let n = 1; n <= 8; n++) {
                const x = ggb.getValue("x(Corner(5," + n + "))");
                const y = ggb.getValue("y(Corner(5," + n + "))");
                if (isFinite(x) && isFinite(y)) {
                    xs.push(x);
                    ys.push(y);
                }
            }
            if (xs.length >= 2) {
                const b = { xmin: Math.min.apply(null, xs), xmax: Math.max.apply(null, xs), ymin: Math.min.apply(null, ys), ymax: Math.max.apply(null, ys) };
                if (b.xmax > b.xmin && b.ymax > b.ymin) {
                    return b;
                }
            }
        } catch (e) {}
        try {
            const b = { xmin: ggb.getValue("x(Corner(1))"), xmax: ggb.getValue("x(Corner(3))"), ymin: ggb.getValue("y(Corner(1))"), ymax: ggb.getValue("y(Corner(3))") };
            if (isFinite(b.xmin) && isFinite(b.xmax) && isFinite(b.ymin) && isFinite(b.ymax) && b.xmax > b.xmin && b.ymax > b.ymin) {
                return b;
            }
        } catch (e) {}
        return { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
    }

    function suchBox() {
        const s = holeSichtGrenzen();
        const px = (s.xmax - s.xmin) * 0.25;
        const py = (s.ymax - s.ymin) * 0.25;
        return { xmin: s.xmin - px, xmax: s.xmax + px, ymin: s.ymin - py, ymax: s.ymax + py };
    }

    // ------------------------------------------------------------------
    // Exakte Darstellung von Zahlen (ganz, Bruch, Vielfache von π/e, c·√k)
    // ------------------------------------------------------------------
    function ggT(a, b) {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b) {
            const t = b;
            b = a % b;
            a = t;
        }
        return a;
    }

    function formatBruch(z, n) {
        if (n < 0) {
            z = -z;
            n = -n;
        }
        const g = ggT(z, n) || 1;
        z /= g;
        n /= g;
        return n === 1 ? String(z) : z + "/" + n;
    }

    function exakt(x, tol) {
        if (!isFinite(x)) {
            return null;
        }
        if (Math.abs(x - Math.round(x)) < tol) {
            return { text: String(Math.round(x)), wert: Math.round(x) };
        }
        for (let n = 2; n <= 24; n++) {
            const z = x * n;
            if (Math.abs(z - Math.round(z)) < tol * n) {
                return { text: formatBruch(Math.round(z), n), wert: Math.round(z) / n };
            }
        }
        const konst = [["π", Math.PI], ["e", Math.E]];
        for (const k of konst) {
            for (let z = -12; z <= 12; z++) {
                if (z === 0) {
                    continue;
                }
                for (let n = 1; n <= 12; n++) {
                    const w = k[1] * z / n;
                    if (Math.abs(x - w) < tol * Math.max(1, Math.abs(w))) {
                        const g = ggT(Math.abs(z), n) || 1;
                        const zz = z / g;
                        const nn = n / g;
                        const pre = zz === 1 ? "" : zz === -1 ? "-" : String(zz);
                        return { text: nn === 1 ? pre + k[0] : pre + k[0] + "/" + nn, wert: w };
                    }
                }
            }
        }
        for (let kern = 2; kern <= 50; kern++) {
            const r = Math.round(Math.sqrt(kern));
            if (r * r === kern) {
                continue;
            }
            for (let c = -6; c <= 6; c++) {
                if (c === 0) {
                    continue;
                }
                const w = c * Math.sqrt(kern);
                if (Math.abs(x - w) < tol * Math.max(1, Math.abs(w))) {
                    return { text: (c === 1 ? "" : c === -1 ? "-" : String(c)) + "√" + kern, wert: w };
                }
            }
        }
        return null;
    }

    function rund6(v) {
        return String(Math.round(v * 1e6) / 1e6);
    }

    // ------------------------------------------------------------------
    // Nullstellen eines Nenner-Faktors g(x,y) = 0 finden
    //   - isolierte Nullstellen (z.B. x²+y² = 0 in (0,0))  -> "punkte"
    //   - Nullstellen-Kurven (z.B. x-1 = 0 oder x-y = 0)   -> "kurve" (Punktreihe)
    // ------------------------------------------------------------------
    function verfeinere(g, x, y, schritt) {
        let best = Math.abs(g(x, y));
        let s = schritt;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (let it = 0; it < 250 && s > 1e-10 && isFinite(best); it++) {
            let besser = false;
            for (const d of dirs) {
                const nx = x + d[0] * s;
                const ny = y + d[1] * s;
                const a = Math.abs(g(nx, ny));
                if (isFinite(a) && a < best) {
                    best = a;
                    x = nx;
                    y = ny;
                    besser = true;
                    break;
                }
            }
            if (!besser) {
                s /= 2;
            }
        }
        return { x: x, y: y, wert: best };
    }

    function istIsoliert(g, x, y) {
        // Rund um die Nullstelle muss g überall dasselbe Vorzeichen haben und in
        // ALLE Richtungen deutlich von 0 weg wachsen. Sonst liegt der Punkt auf einer Kurve.
        const rho = 1e-3 * Math.max(1, Math.abs(x), Math.abs(y));
        const werte = [];
        for (let k = 0; k < 32; k++) {
            const w = 0.0123 + (2 * Math.PI * k) / 32;
            const v = g(x + rho * Math.cos(w), y + rho * Math.sin(w));
            if (isFinite(v)) {
                werte.push(v);
            }
        }
        if (werte.length < 24) {
            return false;
        }
        let pos = 0;
        let neg = 0;
        let amin = Infinity;
        let amax = 0;
        for (const v of werte) {
            if (v > 0) {
                pos++;
            } else if (v < 0) {
                neg++;
            }
            amin = Math.min(amin, Math.abs(v));
            amax = Math.max(amax, Math.abs(v));
        }
        if (pos > 0 && neg > 0) {
            return false;
        }
        return amax > 0 && amin >= 0.01 * amax;
    }

    function bisektion(g, x0, y0, x1, y1) {
        let a = g(x0, y0);
        for (let it = 0; it < 32; it++) {
            const xm = (x0 + x1) / 2;
            const ym = (y0 + y1) / 2;
            const m = g(xm, ym);
            if (!isFinite(m)) {
                break;
            }
            if (m === 0) {
                return { x: xm, y: ym };
            }
            if ((a < 0) === (m < 0)) {
                x0 = xm;
                y0 = ym;
                a = m;
            } else {
                x1 = xm;
                y1 = ym;
            }
        }
        return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }

    function untersucheFaktor(g, box) {
        const N = 36;
        const W = N + 1;
        const dx = (box.xmax - box.xmin) / N;
        const dy = (box.ymax - box.ymin) / N;
        const v = new Array(W * W);
        for (let i = 0; i < W; i++) {
            for (let j = 0; j < W; j++) {
                v[i * W + j] = g(box.xmin + i * dx, box.ymin + j * dy);
            }
        }
        const punkte = [];
        const kurve = [];

        // (a) Vorzeichenwechsel zwischen Gitterpunkten -> Nullstellen-Kurve
        const kanten = [];
        for (let i = 0; i < W; i++) {
            for (let j = 0; j < W; j++) {
                const a = v[i * W + j];
                if (!isFinite(a)) {
                    continue;
                }
                const x = box.xmin + i * dx;
                const y = box.ymin + j * dy;
                if (a === 0) {
                    kanten.push({ x0: x, y0: y, exakt: true });
                    continue;
                }
                if (i < N) {
                    const b = v[(i + 1) * W + j];
                    if (isFinite(b) && ((a < 0 && b > 0) || (a > 0 && b < 0))) {
                        kanten.push({ x0: x, y0: y, x1: x + dx, y1: y });
                    }
                }
                if (j < N) {
                    const b = v[i * W + j + 1];
                    if (isFinite(b) && ((a < 0 && b > 0) || (a > 0 && b < 0))) {
                        kanten.push({ x0: x, y0: y, x1: x, y1: y + dy });
                    }
                }
            }
        }
        const MAX_KURVE = 80;
        const takt = Math.max(1, Math.ceil(kanten.length / MAX_KURVE));
        for (let k = 0; k < kanten.length; k += takt) {
            if (Date.now() > deadline) {
                break;
            }
            const e = kanten[k];
            kurve.push(e.exakt ? { x: e.x0, y: e.y0 } : bisektion(g, e.x0, e.y0, e.x1, e.y1));
        }

        // (b) lokale Minima von |g| -> isolierte Nullstellen (z.B. x²+y²)
        const minima = [];
        for (let i = 1; i < N; i++) {
            for (let j = 1; j < N; j++) {
                const a = Math.abs(v[i * W + j]);
                if (!isFinite(a)) {
                    continue;
                }
                let ok = true;
                for (let di = -1; di <= 1 && ok; di++) {
                    for (let dj = -1; dj <= 1; dj++) {
                        if (di === 0 && dj === 0) {
                            continue;
                        }
                        const b = Math.abs(v[(i + di) * W + j + dj]);
                        if (!isFinite(b) || b < a) {
                            ok = false;
                            break;
                        }
                    }
                }
                if (ok) {
                    minima.push({ x: box.xmin + i * dx, y: box.ymin + j * dy, a: a });
                }
            }
        }
        minima.sort(function (p, q) {
            return p.a - q.a;
        });
        const schritt = Math.min(dx, dy);
        for (const m of minima.slice(0, 6)) {
            if (Date.now() > deadline) {
                break;
            }
            const r = verfeinere(g, m.x, m.y, schritt);
            if (!(r.wert <= 1e-7)) {
                continue;
            }
            if (istIsoliert(g, r.x, r.y)) {
                punkte.push({ x: r.x, y: r.y });
            } else {
                kurve.push({ x: r.x, y: r.y });
            }
        }
        return { punkte: punkte, kurve: kurve };
    }

    function entferneDoppelte(liste, tol) {
        const sauber = [];
        for (const p of liste) {
            if (!isFinite(p.x) || !isFinite(p.y)) {
                continue;
            }
            if (!sauber.some(function (q) {
                return Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol;
            })) {
                sauber.push(p);
            }
        }
        return sauber;
    }

    // ------------------------------------------------------------------
    // Prüfung: Ist die Stelle (x,y) eine hebbare Lücke? Liefert z-Wert oder null.
    // Alle Richtungen müssen auf denselben endlichen Grenzwert zulaufen.
    // (Richtungen bewusst "schief" gewählt, damit sie nie exakt auf einer
    //  Nenner-Geraden wie x = 1 oder y = x liegen.)
    // ------------------------------------------------------------------
    function pruefeLuecke3D(name, x, y, schnell) {
        const winkel = schnell ? [17, 107, 197, 287] : [17, 47, 77, 107, 137, 167, 197, 227, 257, 287, 317, 347];
        const deltas = schnell ? [1e-4, 1e-5] : [1e-3, 1e-4, 1e-5];
        const werte = [];
        for (const d of deltas) {
            const reihe = [];
            for (const w of winkel) {
                const r = (w * Math.PI) / 180;
                const f = fWert(name, x + d * Math.cos(r), y + d * Math.sin(r));
                if (!isFinite(f)) {
                    return null;
                }
                reihe.push(f);
            }
            werte.push(reihe);
        }
        const letzte = werte[werte.length - 1];
        const vorletzte = werte[werte.length - 2];
        const mittel = letzte.reduce(function (a, b) {
            return a + b;
        }, 0) / letzte.length;
        const skala = Math.max(1, Math.abs(mittel));
        for (let k = 0; k < letzte.length; k++) {
            if (Math.abs(letzte[k] - mittel) > 2e-3 * skala + 1e-4) {
                return null;   // richtungsabhängig
            }
            if (Math.abs(letzte[k] - vorletzte[k]) > 2e-3 * skala + 1e-3) {
                return null;   // läuft nicht auf einen festen Wert zu (Polstelle, Divergenz)
            }
        }
        return mittel;
    }

    // ------------------------------------------------------------------
    // Objekte in GeoGebra anlegen / löschen
    // ------------------------------------------------------------------

    function num(v) {
        return v.toFixed(9).replace(/\.?0+$/, "") || "0";
    }

    function loescheObjekte(name) {
        const menge = erzeugteObjekte.get(name);
        if (menge) {
            menge.forEach(function (n) {
                try {
                    if (ggb.exists(n)) {
                        ggb.deleteObject(n);
                    }
                } catch (e) {}
            });
        }
        erzeugteObjekte.delete(name);
    }

    function loescheSteuerobjekt(name) {
        const s = steuerObjektName(name);
        try {
            if (ggb.exists(s)) {
                ggb.deleteObject(s);
            }
        } catch (e) {}
        registrierteSteuerListener.delete(s);
    }

    function raeumeAuf(name) {
        loescheObjekte(name);
        loescheSteuerobjekt(name);
        letzteBox.delete(name);
    }

    function registriereSteuerListener(name) {
        const s = steuerObjektName(name);
        if (registrierteSteuerListener.has(s)) {
            return;
        }
        try {
            if (typeof ggb.registerObjectUpdateListener === "function") {
                ggb.registerObjectUpdateListener(s, function () {
                    aktualisiereSichtbarkeit(name);
                });
                registrierteSteuerListener.add(s);
            }
        } catch (e) {}
    }

    function erstelleSteuerobjekt(name) {
        pflegeSteuerSprache(name);
        const s = steuerObjektName(name);
        try {
            if (!ggb.exists(s)) {
                ggb.evalCommand(s + " = false");
                try {
                    ggb.setCaption(s, tr("zeige"));
                    ggb.setLabelStyle(s, 3);
                } catch (e) {}
            }
        } catch (e) {}
        registriereSteuerListener(name);
    }

    function steuerungAktiv(name) {
        const s = steuerObjektName(name);
        try {
            if (!ggb.exists(s)) {
                return true;
            }
            return ggb.getValue(s) === 1;
        } catch (e) {
            return true;
        }
    }

    function sollSichtbarSein(name) {
        let sichtbar = true;
        try {
            sichtbar = ggb.getVisible(name);
        } catch (e) {}
        return steuerungAktiv(name) && sichtbar;
    }

    function aktualisiereSichtbarkeit(name) {
        const menge = erzeugteObjekte.get(name);
        if (!menge) {
            return;
        }
        const sichtbar = sollSichtbarSein(name);
        menge.forEach(function (n) {
            try {
                ggb.setVisible(n, sichtbar);
            } catch (e) {}
        });
    }

    // ------------------------------------------------------------------
    // Kurvengleichung der Lücke per GeoGebra-CAS bestimmen:
    //   1. Solve(Nenner = 0, y)  -> Kurve y = h(x)   (oder nach x, wenn kein y vorkommt)
    //   2. Limit(f(x, h(x) + t), t, 0) -> Höhe z(x) entlang der Kurve
    //   3. Curve(x, h(x), z(x), ...) als echte 3D-Kurve
    // Jede Kurve wird gegen die numerisch gefundenen Lückenpunkte geprüft.
    // ------------------------------------------------------------------
    const LT = "ggbLt";

    function casString(cmd) {
        try {
            if (typeof ggb.evalCommandCAS !== "function") {
                return null;
            }
            const r = ggb.evalCommandCAS(cmd);
            return typeof r === "string" ? r : null;
        } catch (e) {
            return null;
        }
    }

    function casUngueltig(s) {
        return !s || /\?|undefined|∞|infinity|infty|error/i.test(s);
    }

    function ersetzeBezeichner(s, von, nach) {
        return s.replace(new RegExp(BEZ, "g"), function (w) {
            return w === von ? nach : w;
        });
    }

    function teileTopLevel(s) {
        const teile = [];
        let tiefe = 0;
        let start = 0;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (c === "(" || c === "[" || c === "{") {
                tiefe++;
            } else if (c === ")" || c === "]" || c === "}") {
                tiefe--;
            } else if (c === "," && tiefe === 0) {
                teile.push(s.substring(start, i));
                start = i + 1;
            }
        }
        teile.push(s.substring(start));
        return teile;
    }

    function entferneGeschweifte(t) {
        t = t.trim();
        while (t.length >= 2 && t[0] === "{" && t[t.length - 1] === "}") {
            let tiefe = 0;
            let ende = -1;
            for (let i = 0; i < t.length; i++) {
                if (t[i] === "{") {
                    tiefe++;
                } else if (t[i] === "}") {
                    tiefe--;
                    if (tiefe === 0) {
                        ende = i;
                        break;
                    }
                }
            }
            if (ende !== t.length - 1) {
                break;
            }
            t = t.substring(1, t.length - 1).trim();
        }
        return t;
    }

    function parseLoesungen(s, variable) {
        const erg = [];
        teileTopLevel(entferneGeschweifte(s)).forEach(function (teil) {
            const m = entferneGeschweifte(teil).match(new RegExp("^" + variable + "\\s*=\\s*(.+)$"));
            if (m && !casUngueltig(m[1]) && !hatVariable(m[1], variable)) {
                erg.push(m[1].trim());
            }
        });
        return erg;
    }

    function ausdruckTeil(def) {
        const gl = def.indexOf("=");
        return gl === -1 ? def : def.substring(gl + 1);
    }

    function ersetzeMehrere(s, map) {
        return s.replace(new RegExp(BEZ, "g"), function (w) {
            return Object.prototype.hasOwnProperty.call(map, w) ? map[w] : w;
        });
    }

    function nimmTreffer(rest, evH, evF, nach) {
        // evH: Kurvenfunktion (y = h(x) bzw. x = c), evF: Höhe z (Funktion von x und y)
        const treffer = [];
        rest.forEach(function (p, k) {
            const hv = evH(p.x, p.y);
            const soll = nach === "y" ? p.y : p.x;
            if (!isFinite(hv) || Math.abs(hv - soll) >= 1e-4 * Math.max(1, Math.abs(soll))) {
                return;
            }
            const zv = nach === "y" ? evF(p.x, hv) : evF(hv, p.y);
            if (isFinite(zv) && Math.abs(zv - p.z) < 1e-3 * Math.max(1, Math.abs(p.z))) {
                treffer.push(k);
            }
        });
        return treffer;
    }

    function findeKurvenFormeln(def, defRoh, faktoren, punkte) {
        const ausdruck = ausdruckTeil(def);
        const ausdruckRoh = ausdruckTeil(defRoh);
        let rest = punkte.slice();
        const kurven = [];
        const gesehen = new Set();

        // Stufe A (live): Simplify(f) kürzt die Lücke weg -> fS(x,y) ist die stetige
        // Fortsetzung. Die Kurve ist dann (u, h(u), fS(u, h(u))). Alles mit Parameternamen,
        // dadurch läuft die Kurve bei Schieberegler-Änderungen von selbst mit.
        let fsRoh = null;
        {
            const t = casString("Simplify(" + ausdruckRoh + ")");
            if (!casUngueltig(t)) {
                fsRoh = normalisiereDefinition(t.trim());
                const gl = fsRoh.indexOf("=");
                if (gl !== -1 && /^\s*[A-Za-z]\w*\s*\(/.test(fsRoh.substring(0, gl))) {
                    fsRoh = fsRoh.substring(gl + 1).trim();
                }
            }
        }

        for (const f of faktoren) {
            if (gesehen.has(f.sub)) {
                continue;
            }
            gesehen.add(f.sub);
            if (rest.length < 3 || Date.now() > deadline) {
                break;
            }
            const nach = hatVariable(f.sub, "y") ? "y" : "x";
            let live = 0;

            if (fsRoh) {
                const solR = casString("Solve(" + f.roh + "=0, " + nach + ")");
                if (!casUngueltig(solR)) {
                    const evF = baueAuswerter(fsRoh);
                    for (const rhsRaw of parseLoesungen(solR, nach)) {
                        const rhs = normalisiereDefinition(rhsRaw);
                        const treffer = nimmTreffer(rest, baueAuswerter(rhs), evF, nach);
                        if (treffer.length >= 3) {
                            const weg = new Set(treffer);
                            kurven.push({ typ: nach, h: rhs, fs: fsRoh, live: true, punkte: treffer.map(function (k) {
                                return rest[k];
                            }) });
                            rest = rest.filter(function (_, k) {
                                return !weg.has(k);
                            });
                            live++;
                        }
                    }
                }
            }
            if (live > 0) {
                continue;
            }

            // Stufe B (Rückfall): Grenzwert Limit(f(x, h(x)+t), t, 0) per CAS, mit eingesetzten Parameterwerten.
            const sol = casString("Solve(" + f.sub + "=0, " + nach + ")");
            if (casUngueltig(sol)) {
                continue;
            }
            for (const rhs of parseLoesungen(sol, nach)) {
                const fe = ersetzeBezeichner(ausdruck, nach, "(" + rhs + "+" + LT + ")");
                const zStr = casString("Simplify(Limit(" + fe + ", " + LT + ", 0))");
                if (casUngueltig(zStr)) {
                    continue;
                }
                const evH = baueAuswerter(rhs);
                const evZ = baueAuswerter(zStr);
                const treffer = nimmTreffer(rest, evH, function (a, b) {
                    return evZ(a, b);
                }, nach);
                if (treffer.length >= 3) {
                    const weg = new Set(treffer);
                    kurven.push({ typ: nach, h: rhs, z: zStr, live: false, punkte: treffer.map(function (k) {
                        return rest[k];
                    }) });
                    rest = rest.filter(function (_, k) {
                        return !weg.has(k);
                    });
                }
            }
        }
        return { kurven: kurven, rest: rest };
    }

    // Sucht Punkte, die auf einer gemeinsamen 3D-Geraden liegen, und fasst sie zu
    // Strecken zusammen. Übrig bleibende Punkte (z.B. auf gekrümmten Kurven) bleiben Punkte.
    function trenneGeraden(punkte) {
        let rest = punkte.slice();
        const geraden = [];
        while (rest.length >= 3) {
            let beste = null;
            const anker = Math.min(rest.length, 10);
            for (let a = 0; a < anker; a++) {
                for (let b = 0; b < rest.length; b++) {
                    if (a === b) {
                        continue;
                    }
                    const P = rest[a];
                    const Q = rest[b];
                    const d = [Q.x - P.x, Q.y - P.y, Q.z - P.z];
                    const L = Math.hypot(d[0], d[1], d[2]);
                    if (L < 1e-3) {
                        continue;
                    }
                    const inl = [];
                    for (let k = 0; k < rest.length; k++) {
                        const w = [rest[k].x - P.x, rest[k].y - P.y, rest[k].z - P.z];
                        const c = [w[1] * d[2] - w[2] * d[1], w[2] * d[0] - w[0] * d[2], w[0] * d[1] - w[1] * d[0]];
                        if (Math.hypot(c[0], c[1], c[2]) / L < 1e-4) {
                            inl.push(k);
                        }
                    }
                    if (!beste || inl.length > beste.length) {
                        beste = inl;
                    }
                }
            }
            if (!beste || beste.length < 3) {
                break;
            }
            const pts = beste.map(function (k) {
                return rest[k];
            });
            let pa = pts[0];
            let pb = pts[0];
            let maxd = -1;
            for (let i = 0; i < pts.length; i++) {
                for (let j = i + 1; j < pts.length; j++) {
                    const dd = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
                    if (dd > maxd) {
                        maxd = dd;
                        pa = pts[i];
                        pb = pts[j];
                    }
                }
            }
            geraden.push({ a: pa, b: pb });
            const weg = new Set(beste);
            rest = rest.filter(function (_, k) {
                return !weg.has(k);
            });
        }
        return { geraden: geraden, rest: rest };
    }

    function legeObjekteAn(name, luecken, kurve, geraden, formeln, box) {
        loescheObjekte(name);
        const menge = new Set();
        erzeugteObjekte.set(name, menge);

        luecken.forEach(function (l, i) {
            const pn = "Luecke3D_" + name + "_" + (i + 1);
            try {
                ggb.evalCommand(pn + " = (" + num(l.x) + ", " + num(l.y) + ", " + num(l.z) + ")");
                if (!ggb.exists(pn)) {
                    return;
                }
            } catch (e) {
                return;
            }
            menge.add(pn);
            try { ggb.setPointSize(pn, 7); } catch (e) {}
            try { ggb.setColor(pn, 0, 0, 0); } catch (e) {}
            try { ggb.setFixed(pn, true); } catch (e) {}
            try { ggb.setAuxiliary(pn, true); } catch (e) {}
            try {
                const tx = l.ex ? l.ex.text : rund6(l.x);
                const ty = l.ey ? l.ey.text : rund6(l.y);
                const tz = l.ez ? l.ez.text : rund6(l.z);
                ggb.setCaption(pn, tr("luecke") + " (" + tx + " | " + ty + " | " + tz + ")");
                ggb.setLabelStyle(pn, 3);
                ggb.setLabelVisible(pn, true);
            } catch (e) {}
        });

        (formeln || []).forEach(function (k, i) {
            const cn = "Luecke3D_" + name + "_Kurvenfunktion" + (i + 1);
            const P = "ggbLu";
            let cmd;
            let zText;
            if (k.typ === "y") {
                const hP = "(" + ersetzeBezeichner(k.h, "x", P) + ")";
                const zP = k.live ? ersetzeMehrere(k.fs, { x: P, y: hP }) : ersetzeBezeichner(k.z, "x", P);
                zText = zP;
                cmd = cn + " = Curve(" + P + ", " + hP + ", " + zP + ", " + P + ", " + num(box.xmin) + ", " + num(box.xmax) + ")";
            } else {
                const cP = "(" + k.h + ")";
                const zP = k.live ? ersetzeMehrere(k.fs, { x: cP, y: P }) : ersetzeBezeichner(k.z, "y", P);
                zText = zP;
                cmd = cn + " = Curve(" + cP + ", " + P + ", " + zP + ", " + P + ", " + num(box.ymin) + ", " + num(box.ymax) + ")";
            }
            let ok = false;
            try {
                ok = !!ggb.evalCommand(cmd) && ggb.exists(cn);
            } catch (e) {}
            if (!ok) {
                try {
                    if (ggb.exists(cn)) {
                        ggb.deleteObject(cn);
                    }
                } catch (e) {}
                kurve = kurve.concat(k.punkte);   // Rückfall: Punkte statt Kurve
                return;
            }
            menge.add(cn);
            try { ggb.setColor(cn, 0, 0, 0); } catch (e) {}
            try { ggb.setLineThickness(cn, 6); } catch (e) {}
            try { ggb.setFixed(cn, true); } catch (e) {}
            try { ggb.setAuxiliary(cn, true); } catch (e) {}
            try {
                ggb.setCaption(cn, tr("luecke") + ": " + k.typ + " = " + k.h + ", z = " + (k.live ? "f_" + tr("gekuerzt") + "(x, y)" : k.z));
                ggb.setLabelStyle(cn, 3);
                ggb.setLabelVisible(cn, true);
            } catch (e) {}
        });

        (geraden || []).forEach(function (g, i) {
            const sn = "Luecke3D_" + name + "_Gerade" + (i + 1);
            try {
                ggb.evalCommand(sn + " = Segment((" + num(g.a.x) + ", " + num(g.a.y) + ", " + num(g.a.z) + "), (" +
                    num(g.b.x) + ", " + num(g.b.y) + ", " + num(g.b.z) + "))");
                if (!ggb.exists(sn)) {
                    return;
                }
            } catch (e) {
                return;
            }
            menge.add(sn);
            try { ggb.setColor(sn, 0, 0, 0); } catch (e) {}
            try { ggb.setLineThickness(sn, 6); } catch (e) {}
            try { ggb.setFixed(sn, true); } catch (e) {}
            try { ggb.setAuxiliary(sn, true); } catch (e) {}
            try { ggb.setLabelVisible(sn, false); } catch (e) {}
        });

        if (kurve.length > 0) {
            const ln = "Luecke3D_" + name + "_Kurve";
            const inhalt = kurve.map(function (p) {
                return "(" + num(p.x) + ", " + num(p.y) + ", " + num(p.z) + ")";
            }).join(", ");
            try {
                ggb.evalCommand(ln + " = {" + inhalt + "}");
                if (ggb.exists(ln)) {
                    menge.add(ln);
                    try { ggb.setPointSize(ln, 4); } catch (e) {}
                    try { ggb.setColor(ln, 0, 0, 0); } catch (e) {}
                    try { ggb.setFixed(ln, true); } catch (e) {}
                    try { ggb.setAuxiliary(ln, true); } catch (e) {}
                    try { ggb.setLabelVisible(ln, false); } catch (e) {}
                }
            } catch (e) {}
        }
        aktualisiereSichtbarkeit(name);
    }

    // ------------------------------------------------------------------
    // Hauptanalyse einer Funktion f(x,y)
    // ------------------------------------------------------------------
    function analysiere(name) {
        if (busySet.has(name)) {
            return;
        }
        busySet.add(name);
        try {
            const defRoh = holeDefinition(name);
            if (!defRoh) {
                raeumeAuf(name);
                return;
            }
            const def = ersetzeVariablenDurchWerte(defRoh, name);
            const hatParameter = extrahiereAbhaengigeVariablen(defRoh, name).size > 0;
            const nenner = findeNenner(def);
            if (nenner.length === 0) {
                raeumeAuf(name);
                return;
            }

            deadline = Date.now() + 10000;
            const box = suchBox();
            let isoKand = [];
            let kurvKand = [];
            const kurvenFaktoren = [];
            const nennerRoh = findeNenner(defRoh);
            for (let ni = 0; ni < nenner.length; ni++) {
                const faktorenRoh = nennerRoh[ni] ? extrahiereFaktoren(nennerRoh[ni]) : [];
                const faktorenSub = extrahiereFaktoren(nenner[ni]);
                for (let fi = 0; fi < faktorenSub.length; fi++) {
                    const faktor = entferneAussenklammern(faktorenSub[fi]);
                    if (!hatVariable(faktor, "x") && !hatVariable(faktor, "y")) {
                        continue;
                    }
                    const faktorRoh = faktorenRoh[fi] ? entferneAussenklammern(faktorenRoh[fi]) : faktor;
                    const r = untersucheFaktor(baueAuswerter(faktor), box);
                    if (r.kurve.length > 0) {
                        kurvenFaktoren.push({ sub: faktor, roh: faktorRoh });
                    }
                    isoKand = isoKand.concat(r.punkte);
                    kurvKand = kurvKand.concat(r.kurve);
                }
            }
            const hatKandidaten = isoKand.length + kurvKand.length > 0;

            // Isolierte Punkte prüfen
            const luecken = [];
            for (const k of entferneDoppelte(isoKand, 1e-6)) {
                if (Date.now() > deadline) {
                    break;
                }
                const ex = exakt(k.x, 1e-7);
                const ey = exakt(k.y, 1e-7);
                const x = ex ? ex.wert : k.x;
                const y = ey ? ey.wert : k.y;
                if (ex && ey && isFinite(fWert(name, x, y))) {
                    continue;   // an dieser Stelle ist f definiert -> keine Lücke
                }
                const z = pruefeLuecke3D(name, x, y, false);
                if (z === null) {
                    continue;
                }
                const ez = exakt(z, 1e-6);
                luecken.push({ x: x, y: y, z: ez ? ez.wert : z, ex: ex, ey: ey, ez: ez });
            }

            // Punkte auf Nenner-Kurven prüfen (z.B. (x²-1)/(x-1): ganze Gerade x = 1)
            const kurvenPunkte = [];
            for (const k of entferneDoppelte(kurvKand, 1e-6)) {
                if (Date.now() > deadline) {
                    break;
                }
                if (pruefeLuecke3D(name, k.x, k.y, true) === null) {
                    continue;
                }
                const z = pruefeLuecke3D(name, k.x, k.y, false);
                if (z !== null) {
                    kurvenPunkte.push({ x: k.x, y: k.y, z: z });
                }
            }

            if (luecken.length > 0 || kurvenPunkte.length > 0 || (hatParameter && hatKandidaten)) {
                erstelleSteuerobjekt(name);
            } else {
                loescheSteuerobjekt(name);
            }
            let restPunkte = kurvenPunkte;
            let formeln = [];
            if (kurvenPunkte.length >= 3 && kurvenFaktoren.length > 0) {
                const fk = findeKurvenFormeln(def, defRoh, kurvenFaktoren, kurvenPunkte);
                formeln = fk.kurven;
                restPunkte = fk.rest;
            }
            const getrennt = trenneGeraden(restPunkte);
            legeObjekteAn(name, luecken, getrennt.rest, getrennt.geraden, formeln, box);
            letzteBox.set(name, box);
            console.log("[Lücken3D]", name, "-> Punkte:", luecken.length, "| Kurvenpunkte:", kurvenPunkte.length);
        } catch (e) {
            console.error("[Lücken3D] Fehler beim Analysieren:", e);
        } finally {
            busySet.delete(name);
        }
    }

    // ------------------------------------------------------------------
    // Änderungen erkennen und Analyse planen
    // ------------------------------------------------------------------
    function planeAktualisierung(name, verzoegerung) {
        if (debounceTimer.has(name)) {
            clearTimeout(debounceTimer.get(name));
        }
        debounceTimer.set(name, setTimeout(function () {
            debounceTimer.delete(name);
            analysiere(name);
        }, verzoegerung));
    }

    function pruefeFunktionAufAenderung(name) {
        const definition = holeDefinition(name);
        if (!definition) {
            return;
        }
        const signatur = berechneSignatur(name, definition);
        if (!bekannteSignaturen.has(name)) {
            console.log("[Lücken3D] Neue Funktion:", name);
            bekannteSignaturen.set(name, signatur);
            pflegeIntervall();
            planeAktualisierung(name, 0);
            return;
        }
        if (bekannteSignaturen.get(name) !== signatur) {
            bekannteSignaturen.set(name, signatur);
            planeAktualisierung(name, 80);
        }
    }

    function planeAnsichtsAktualisierung() {
        if (letzteBox.size === 0) {
            return;
        }
        if (ansichtsDebounce) {
            clearTimeout(ansichtsDebounce);
        }
        ansichtsDebounce = setTimeout(function () {
            ansichtsDebounce = null;
            const s = holeSichtGrenzen();
            const bx = s.xmax - s.xmin;
            const by = s.ymax - s.ymin;
            letzteBox.forEach(function (alt, name) {
                if (!bekannteSignaturen.has(name)) {
                    return;
                }
                const drin = s.xmin >= alt.xmin + 0.1 * bx && s.xmax <= alt.xmax - 0.1 * bx &&
                             s.ymin >= alt.ymin + 0.1 * by && s.ymax <= alt.ymax - 0.1 * by;
                const zuGrob = (alt.xmax - alt.xmin) > 8 * bx || (alt.ymax - alt.ymin) > 8 * by;
                if (!drin || zuGrob) {
                    planeAktualisierung(name, 100);
                }
            });
        }, 400);
    }

    function behandleObjektHinzugefuegt(name) {
        if (name && ggb && istFlaechenFunktion(name)) {
            pruefeFunktionAufAenderung(name);
            aktualisiereSichtbarkeit(name);
        }
    }

    function behandleObjektEntfernt(name) {
        if (name && bekannteSignaturen.has(name)) {
            raeumeAuf(name);
            bekannteSignaturen.delete(name);
            pflegeIntervall();
        }
    }

    function behandleObjektAktualisiert(name) {
        if (!name || !ggb) {
            return;
        }
        if (bekannteSignaturen.has(name)) {
            pruefeFunktionAufAenderung(name);
            aktualisiereSichtbarkeit(name);
            return;
        }
        const steuerFuer = funktionsNameAusSteuer(name);
        if (steuerFuer !== null && bekannteSignaturen.has(steuerFuer)) {
            aktualisiereSichtbarkeit(steuerFuer);
            return;
        }
        if (istFlaechenFunktion(name)) {
            pruefeFunktionAufAenderung(name);
            aktualisiereSichtbarkeit(name);
        }
    }

    function verarbeiteZiel(ziel, behandler) {
        if (!ziel) {
            return;
        }
        if (Array.isArray(ziel)) {
            ziel.forEach(behandler);
        } else {
            behandler(ziel);
        }
    }

    function clientListener(event) {
        if (!ggb || !event) {
            return;
        }
        try {
            switch (event.type) {
                case "add":
                    verarbeiteZiel(event.target, behandleObjektHinzugefuegt);
                    break;
                case "remove":
                    verarbeiteZiel(event.target, behandleObjektEntfernt);
                    break;
                case "update":
                case "updateStyle":
                    verarbeiteZiel(event.target, behandleObjektAktualisiert);
                    break;
                case "renameComplete":
                    pruefeAlleFunktionen();
                    break;
                case "clear":
                    bekannteSignaturen.clear();
                    erzeugteObjekte.clear();
                    letzteBox.clear();
                    pflegeIntervall();
                    break;
                case "viewChanged2D":
                case "viewChanged3D":
                    planeAnsichtsAktualisierung();
                    break;
                default:
                    verarbeiteZiel(event.target, behandleObjektAktualisiert);
                    break;
            }
        } catch (e) {
            console.error("[Lücken3D] Fehler im Client-Listener:", e);
        }
    }

    function pruefeAlleFunktionen() {
        if (!ggb) {
            return;
        }
        try {
            const anzahl = ggb.getObjectNumber();
            const vorhanden = new Set();
            for (let i = 0; i < anzahl; i++) {
                const name = ggb.getObjectName(i);
                if (!name || !istFlaechenFunktion(name)) {
                    continue;
                }
                vorhanden.add(name);
                pruefeFunktionAufAenderung(name);
                aktualisiereSichtbarkeit(name);
            }
            Array.from(bekannteSignaturen.keys()).forEach(function (name) {
                if (!vorhanden.has(name)) {
                    raeumeAuf(name);
                    bekannteSignaturen.delete(name);
                }
            });
            pflegeIntervall();
        } catch (e) {
            console.error("[Lücken3D] Fehler:", e);
        }
    }

    // ------------------------------------------------------------------
    // Start
    // ------------------------------------------------------------------
    function starte() {
        if (typeof ggbApplet === "undefined" || typeof ggbApplet.getObjectNumber !== "function") {
            setTimeout(starte, 800);
            return;
        }
        try {
            ggbApplet.getObjectNumber();
        } catch (e) {
            setTimeout(starte, 500);
            return;
        }
        ggb = ggbApplet;
        console.log("[Lücken3D] Script gestartet");
        try {
            if (typeof ggb.registerClientListener === "function") {
                ggb.registerClientListener(clientListener);
                listenerAktiv = true;
            }
        } catch (e) {
            console.error("[Lücken3D] Konnte Client-Listener nicht registrieren:", e);
        }
        pruefeAlleFunktionen();
        pflegeIntervall();
    }

    starte();
})();
