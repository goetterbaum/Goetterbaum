// Rechenbaustein Kostenanalyse: berechnet aus den Zeiteinträgen der Firma
// je Objekt und Zusatzauftrag Einnahmen, Arbeitgeberkosten für Arbeits-
// und Fahrzeit und den Deckungsbeitrag für einen Zeitraum. Ein reiner
// Baustein ohne Datenbank und Oberfläche. Die Einnahmen rechnet der
// Rechenbaustein der Rechnungsvorbereitung (siehe ADR-0004); hier werden
// sie nur auf Zeilen und Zeiteinträge verteilt. Alle Beträge in Cent als
// ganze Zahlen, je Zeiteintrag bzw. Anteil gerundet; Summen entstehen aus
// den gerundeten Werten.
import type { Rundungsregel } from "./abrechnung";
import {
  geltendeArbeitgeberkosten,
  type Arbeitgeberkosten,
  type Herkunft,
} from "./arbeitgeberkosten/regeln";
import { aufBerlinerTageVerteilt, berlinerDatum } from "./berliner-zeit";
import {
  rechnungsvorbereitung,
  type Monat,
  type Objekt,
  type ObjektStundensatz,
  type Zeiteintrag,
  type Zusatzauftrag,
} from "./rechnungsvorbereitung";
import { ARBEITSTAG_ENDET_NACH_STUNDEN } from "./zeiterfassung/live-erfassung";

// Ein beendeter Zeiteintrag; laufende zählen nicht.
export type ZeiteintragFuerKosten = Zeiteintrag & {
  freigegeben: boolean;
  arbeitstagEndetHier: boolean;
};

export type Eingabe = {
  // Die Monate des Zeitraums: einer oder die zwölf eines Jahres.
  monate: Monat[];
  // In der Reihenfolge, in der sie erscheinen sollen.
  kunden: {
    id: string;
    // Die bereits aufgelöste Rundungsregel (Kunde oder Firmen-Standard).
    rundungsregel: Rundungsregel;
    kundenStundensaetze: { taetigkeitId: string; stundensatzCent: number }[];
  }[];
  // Alle Objekte der Kunden, auch archivierte, in der Reihenfolge, in der
  // sie bei gleichem Deckungsbeitrag erscheinen sollen.
  objekte: (Objekt & { kundeId: string; archiviert: boolean })[];
  // Alle Tätigkeiten, auch archivierte.
  taetigkeiten: { id: string; standardStundensatzCent: number }[];
  objektStundensaetze: ObjektStundensatz[];
  // Alle Zusatzaufträge der Objekte, ob abgerechnet oder nicht.
  zusatzauftraege: Zusatzauftrag[];
  // Alle beendeten Zeiteinträge der Firma im Zeitraum, dazu genug davor
  // und danach, damit jeder Arbeitstag ganz dabei ist, und alle Einträge
  // der Zusatzaufträge mit Festbetrag, die im Zeitraum erscheinen.
  zeiteintraege: ZeiteintragFuerKosten[];
  arbeitgeberkosten: {
    standard: Arbeitgeberkosten[];
    // Die eigenen Werte je Mitarbeiter-Kennung.
    jeMitarbeiter: Record<string, Arbeitgeberkosten[]>;
  };
};

// Zahlen einer Zeile oder Summe. Fehlen für einen Mitarbeiter die
// Arbeitgeberkosten, bleiben Kosten und Deckungsbeitrag leer (null), nie 0.
export type Bewertung = {
  einnahmenCent: number;
  arbeitsMinuten: number;
  arbeitskostenCent: number | null;
  fahrtMinuten: number;
  fahrkostenCent: number | null;
  // Arbeits- und Fahrkosten zusammen.
  kostenCent: number | null;
  deckungsbeitragCent: number | null;
  // Deckungsbeitrag ÷ Einnahmen, z. B. 0.25; null ohne Einnahmen oder
  // ohne Kosten.
  deckungsbeitragAnteil: number | null;
  // Es zählen nicht freigegebene Einträge mit oder ein noch nicht
  // erledigter Zusatzauftrag mit Festbetrag.
  vorlaeufig: boolean;
  // Mitarbeiter-Kennungen ohne Arbeitgeberkosten, in der Reihenfolge des
  // ersten Vorkommens.
  kostenFehlenFuer: string[];
};

// Ein Zeiteintrag in einem Objekt mit dem, was ihm zugeordnet ist.
export type BewerteterEintrag = {
  zeiteintragId: string;
  mitarbeiterId: string;
  // Der Kalendertag in Berlin, an dem sein Arbeitstag beginnt.
  datum: string;
  beginn: string;
  ende: string;
  // Ungerundet, damit die Summen einer Zeile stimmen.
  arbeitsMinuten: number;
  // Sein Anteil an den Fahrten des Arbeitstags, ungerundet.
  fahrtMinuten: number;
  arbeitskostenCent: number | null;
  fahrkostenCent: number | null;
  // Arbeits- und Fahrkosten zusammen.
  kostenCent: number | null;
  einnahmeCent: number;
  // Welcher Wert der Arbeitgeberkosten an diesem Tag galt, null ohne.
  herkunft: Herkunft | null;
  vorlaeufig: boolean;
};

// Die regelmäßige Arbeit in einem Objekt (zusatzauftragId null) oder ein
// Zusatzauftrag.
export type Zeile = Bewertung & {
  objektId: string;
  zusatzauftragId: string | null;
  // Nach Beginn sortiert.
  eintraege: BewerteterEintrag[];
  // Dieselben Einträge je Kalendertag ihres Beginns, mit Tagessumme.
  tage: { datum: string; eintraege: BewerteterEintrag[]; summe: Bewertung }[];
  // Einnahmen, die bei keinem Eintrag stehen, z. B. die Pauschale eines
  // Monats ohne Einsatz.
  einnahmenOhneZeiteintragCent: number;
};

export type Kostenanalyse = {
  kunden: {
    kundeId: string;
    // Die schwächsten zuerst (Deckungsbeitrag in %, ohne Wert ganz oben).
    objekte: { zeile: Zeile; zusatzauftraege: Zeile[] }[];
    summe: Bewertung;
  }[];
  // Fahrten aus Arbeitstagen ganz ohne Objekt; null, wenn es keine gibt.
  fahrtenOhneObjekt: Bewertung | null;
  summe: Bewertung;
};

export function kostenanalyse(eingabe: Eingabe): Kostenanalyse {
  const monate = new Set(eingabe.monate);
  const objektVon = new Map(eingabe.objekte.map((o) => [o.id, o]));
  const zusatzauftragVon = new Map(eingabe.zusatzauftraege.map((za) => [za.id, za]));

  // Ein Zusatzauftrag mit Festbetrag wird als Ganzes bewertet, im Monat
  // seines letzten Zeiteintrags.
  const letzterMonat = new Map<string, Monat>();
  for (const z of eingabe.zeiteintraege) {
    if (z.zusatzauftragId === null) continue;
    const monat = berlinerMonat(z.beginn);
    if (monat > (letzterMonat.get(z.zusatzauftragId) ?? "")) {
      letzterMonat.set(z.zusatzauftragId, monat);
    }
  }
  const imZeitraum = (z: ZeiteintragFuerKosten) => {
    const za = z.zusatzauftragId === null ? undefined : zusatzauftragVon.get(z.zusatzauftragId);
    const monat =
      za?.abrechnungsart === "festbetrag" ? letzterMonat.get(za.id) : berlinerMonat(z.beginn);
    return monat !== undefined && monate.has(monat);
  };

  // Ein Arbeitstag zählt mit Kosten und Fahrten zum Kalendertag seines
  // Beginns, auch über Mitternacht.
  const tagDesArbeitstags = new Map<string, string>();
  const satz = (z: ZeiteintragFuerKosten) =>
    geltendeArbeitgeberkosten(
      tagDesArbeitstags.get(z.id)!,
      eingabe.arbeitgeberkosten.jeMitarbeiter[z.mitarbeiterId] ?? [],
      eingabe.arbeitgeberkosten.standard,
    );

  // Die Fahrten jedes Arbeitstags gehen an Einträge in Objekten.
  const fahrtenJeEintrag = new Map<string, FahrtAnteil[]>();
  const fahrtenOhneObjekt: ZeiteintragFuerKosten[] = [];
  for (const tag of arbeitstage(eingabe.zeiteintraege)) {
    // Eine Fahrt vor dem ersten Objekt gehört nicht zum Arbeitstag.
    const erster = tag.find((z) => z.art === "taetigkeit") ?? tag[0];
    for (const z of tag) tagDesArbeitstags.set(z.id, berlinerDatum(Date.parse(erster.beginn)));
    const verteilt = fahrtenVerteilen(tag);
    if (verteilt === null) {
      fahrtenOhneObjekt.push(...tag.filter((z) => monate.has(berlinerMonat(z.beginn))));
      continue;
    }
    for (const [id, anteile] of verteilt) fahrtenJeEintrag.set(id, anteile);
  }

  const einnahmen = einnahmenVerteilen(eingabe, letzterMonat);

  // Die Zeilen aller Einträge in Objekten, die im Zeitraum zählen.
  const zeilen = new Map<string, Zeile>();
  const zeileFuer = (objektId: string, zusatzauftragId: string | null) => {
    const schluessel = zeilenSchluessel(objektId, zusatzauftragId);
    const zeile = zeilen.get(schluessel) ?? {
      ...leereBewertung(),
      objektId,
      zusatzauftragId,
      eintraege: [],
      tage: [],
      einnahmenOhneZeiteintragCent: 0,
    };
    zeilen.set(schluessel, zeile);
    return zeile;
  };
  const eintraegeInObjekten = eingabe.zeiteintraege
    .filter(
      (z): z is ZeiteintragFuerKosten & { objektId: string } =>
        z.art === "taetigkeit" && z.objektId !== null && objektVon.has(z.objektId),
    )
    .filter(imZeitraum)
    .sort((a, b) => Date.parse(a.beginn) - Date.parse(b.beginn));
  for (const z of eintraegeInObjekten) {
    const gilt = satz(z);
    const arbeitsMs = Date.parse(z.ende) - Date.parse(z.beginn);
    const fahrten = fahrtenJeEintrag.get(z.id) ?? [];
    const fahrkosten = summeOderNull(
      fahrten.map((f) => {
        const fuerFahrt = satz(f.fahrt);
        return fuerFahrt === null ? null : kostenCent(f.ms, fuerFahrt.centJeStunde);
      }),
    );
    // Fehlt ein Wert, bleiben beide Kosten leer, statt halb zu zählen.
    const fehlt = gilt === null || fahrkosten === null;
    const arbeitskostenCent = fehlt ? null : kostenCent(arbeitsMs, gilt.centJeStunde);
    const fahrkostenCent = fehlt ? null : fahrkosten;
    zeileFuer(z.objektId, z.zusatzauftragId).eintraege.push({
      zeiteintragId: z.id,
      mitarbeiterId: z.mitarbeiterId,
      datum: tagDesArbeitstags.get(z.id)!,
      beginn: z.beginn,
      ende: z.ende,
      arbeitsMinuten: arbeitsMs / 60_000,
      fahrtMinuten: summe(fahrten.map((f) => f.ms)) / 60_000,
      arbeitskostenCent,
      fahrkostenCent,
      kostenCent: summeOderNull([arbeitskostenCent, fahrkostenCent]),
      einnahmeCent: einnahmen.jeEintrag.get(z.id) ?? 0,
      herkunft: gilt?.herkunft ?? null,
      vorlaeufig: !z.freigegeben || fahrten.some((f) => !f.fahrt.freigegeben),
    });
  }
  for (const schluessel of einnahmen.jeZeile.keys()) {
    const [objektId, zusatzauftragId] = schluessel.split("|");
    zeileFuer(objektId, zusatzauftragId || null);
  }
  // Ein aktives Pauschal-Objekt erscheint auch ohne Einsatz.
  for (const objekt of eingabe.objekte) {
    if (objekt.abrechnungsart === "pauschale" && !objekt.archiviert) zeileFuer(objekt.id, null);
  }

  for (const [schluessel, zeile] of zeilen) {
    const za = zusatzauftragVon.get(zeile.zusatzauftragId ?? "");
    const festbetragOffen = za?.abrechnungsart === "festbetrag" && !za.erledigt;
    Object.assign(
      zeile,
      zeilenBewertung(zeile.eintraege, einnahmen.jeZeile.get(schluessel) ?? 0, festbetragOffen),
    );
    zeile.tage = eindeutig(zeile.eintraege.map((e) => e.datum)).map((datum) => {
      const amTag = zeile.eintraege.filter((e) => e.datum === datum);
      const einnahmenCent = summe(amTag.map((e) => e.einnahmeCent));
      return { datum, eintraege: amTag, summe: zeilenBewertung(amTag, einnahmenCent, false) };
    });
    zeile.einnahmenOhneZeiteintragCent =
      zeile.einnahmenCent - summe(zeile.eintraege.map((e) => e.einnahmeCent));
  }

  const kunden = eingabe.kunden.flatMap((kunde) => {
    const objekte = eingabe.objekte
      .filter((o) => o.kundeId === kunde.id)
      .flatMap((objekt) => {
        const zusatzauftraege = eingabe.zusatzauftraege.flatMap((za) => {
          const zeile = zeilen.get(zeilenSchluessel(objekt.id, za.id));
          return zeile ? [zeile] : [];
        });
        const regulaer = zeilen.get(zeilenSchluessel(objekt.id, null));
        if (!regulaer && zusatzauftraege.length === 0) return [];
        return [{ zeile: regulaer ?? zeileFuer(objekt.id, null), zusatzauftraege }];
      })
      .sort((a, b) => schwaecherZuerst(a.zeile, b.zeile));
    if (objekte.length === 0) return [];
    const alle = objekte.flatMap((o) => [o.zeile, ...o.zusatzauftraege]);
    return [{ kundeId: kunde.id, objekte, summe: summeDer(alle) }];
  });

  const ohneObjekt =
    fahrtenOhneObjekt.length === 0 ? null : bewertungOhneObjekt(fahrtenOhneObjekt, satz);
  return {
    kunden,
    fahrtenOhneObjekt: ohneObjekt,
    summe: summeDer([...kunden.map((k) => k.summe), ...(ohneObjekt ? [ohneObjekt] : [])]),
  };
}

// Teilt die Zeiteinträge in Arbeitstage, je Mitarbeiter nach Beginn
// sortiert. Ein Arbeitstag endet mit dem Vermerk „Arbeitstag endet hier“
// oder, auch bei alten Daten ohne Vermerk, nach mehr als 12 Stunden ohne
// Zeiteintrag.
export function arbeitstage<T extends ZeiteintragFuerKosten>(zeiteintraege: T[]): T[][] {
  const grenzeMs = ARBEITSTAG_ENDET_NACH_STUNDEN * 60 * 60 * 1000;
  const sortiert = [...zeiteintraege].sort(
    (a, b) =>
      a.mitarbeiterId.localeCompare(b.mitarbeiterId) || Date.parse(a.beginn) - Date.parse(b.beginn),
  );
  const tage: T[][] = [];
  let vorher: T | undefined;
  for (const z of sortiert) {
    const neuerTag =
      !vorher ||
      vorher.mitarbeiterId !== z.mitarbeiterId ||
      vorher.arbeitstagEndetHier ||
      Date.parse(z.beginn) - Date.parse(vorher.ende) > grenzeMs;
    if (neuerTag) tage.push([z]);
    else tage[tage.length - 1].push(z);
    vorher = z;
  }
  return tage;
}

type FahrtAnteil = { fahrt: ZeiteintragFuerKosten; ms: number };

// Verteilt die Fahrten eines Arbeitstags auf seine Einträge in Objekten:
// je Eintrags-Kennung die Anteile. null, wenn der Tag kein Objekt hat.
// Eine Fahrt geht je zur Hälfte an den letzten Eintrag in einem Objekt
// davor und den nächsten danach; Pausen ändern daran nichts. Ohne Objekt
// danach (Rückfahrt) geht sie gleichmäßig an alle Objekte bzw.
// Zusatzaufträge des Tags, an jeden mit seinem letzten Eintrag. Ohne
// Objekt davor (nachgetragene Anfahrt) geht sie ganz an das erste.
function fahrtenVerteilen(tag: ZeiteintragFuerKosten[]): Map<string, FahrtAnteil[]> | null {
  const inObjekten = tag.filter((z) => z.art === "taetigkeit");
  if (inObjekten.length === 0) return null;
  const letzteJeZeile = new Map<string, ZeiteintragFuerKosten>();
  for (const z of inObjekten)
    letzteJeZeile.set(zeilenSchluessel(z.objektId!, z.zusatzauftragId), z);

  const anteile = new Map<string, FahrtAnteil[]>();
  const gib = (an: ZeiteintragFuerKosten, fahrt: ZeiteintragFuerKosten, ms: number) =>
    anteile.set(an.id, [...(anteile.get(an.id) ?? []), { fahrt, ms }]);
  tag.forEach((fahrt, stelle) => {
    if (fahrt.art !== "fahrt") return;
    const ms = Date.parse(fahrt.ende) - Date.parse(fahrt.beginn);
    const davor = tag.slice(0, stelle).findLast((z) => z.art === "taetigkeit");
    const danach = tag.slice(stelle + 1).find((z) => z.art === "taetigkeit");
    if (davor && danach) {
      gib(davor, fahrt, ms / 2);
      gib(danach, fahrt, ms / 2);
    } else if (danach) {
      gib(danach, fahrt, ms);
    } else {
      for (const letzter of letzteJeZeile.values()) gib(letzter, fahrt, ms / letzteJeZeile.size);
    }
  });
  return anteile;
}

// Die Einnahmen je Zeile (Schlüssel aus Objekt und Zusatzauftrag) und
// ihre Verteilung auf die Zeiteinträge. Je Kunde und Monat rechnet der
// Rechenbaustein der Rechnungsvorbereitung mit heutigen Preisen, als wäre
// noch nichts abgerechnet und alles freigegeben. Pauschalen gibt es je
// Monat; ein archiviertes Pauschal-Objekt nur in Monaten mit Einsatz,
// denn nur dann erscheint es.
function einnahmenVerteilen(
  eingabe: Eingabe,
  letzterMonat: Map<string, Monat>,
): { jeZeile: Map<string, number>; jeEintrag: Map<string, number> } {
  const jeZeile = new Map<string, number>();
  const jeEintrag = new Map<string, number>();
  const addiere = (karte: Map<string, number>, schluessel: string, cent: number) =>
    karte.set(schluessel, (karte.get(schluessel) ?? 0) + cent);
  // Verteilt einen Betrag auf Stücke von Zeiteinträgen nach ihrer Dauer.
  const verteileAufEintraege = (betragCent: number, stuecke: { id: string; ms: number }[]) =>
    verteile(
      betragCent,
      stuecke.map((s) => s.ms),
    ).forEach((cent, i) => addiere(jeEintrag, stuecke[i].id, cent));
  const ganz = (z: Zeiteintrag) => ({ id: z.id, ms: Date.parse(z.ende) - Date.parse(z.beginn) });

  for (const kunde of eingabe.kunden) {
    const objekte = eingabe.objekte.filter((o) => o.kundeId === kunde.id);
    const objektIds = new Set(objekte.map((o) => o.id));
    const zusatzauftraege = eingabe.zusatzauftraege.filter((za) => objektIds.has(za.objektId));
    const taetigkeiten = eingabe.taetigkeiten.map((t) => ({
      ...t,
      kundenStundensatzCent:
        kunde.kundenStundensaetze.find((s) => s.taetigkeitId === t.id)?.stundensatzCent ?? null,
    }));

    for (const monat of eingabe.monate) {
      const festbetraege = zusatzauftraege.filter(
        (za) => za.abrechnungsart === "festbetrag" && letzterMonat.get(za.id) === monat,
      );
      const festbetragIds = new Set(festbetraege.map((za) => za.id));
      const zeiteintraege = eingabe.zeiteintraege.filter(
        (z) =>
          z.art === "taetigkeit" &&
          objektIds.has(z.objektId!) &&
          (z.zusatzauftragId !== null && festbetragIds.has(z.zusatzauftragId)
            ? true
            : berlinerMonat(z.beginn) === monat),
      );
      const ergebnis = rechnungsvorbereitung({
        kunde: { rundungsregel: kunde.rundungsregel, abrechnungszeitraum: "monatlich" },
        ersterMonat: monat,
        objekte,
        taetigkeiten,
        objektStundensaetze: eingabe.objektStundensaetze,
        // Ein Festbetrag zählt hier schon vor der Erledigung (vorläufig).
        zusatzauftraege: [
          ...zusatzauftraege.filter((za) => za.abrechnungsart === "stunden"),
          ...festbetraege.map((za) => ({ ...za, erledigt: true })),
        ],
        zeiteintraege,
        abgerechnetePauschalMonate: [],
      });

      for (const p of ergebnis.positionen) {
        const zusatzauftragId = "zusatzauftragId" in p ? p.zusatzauftragId : null;
        const passend = zeiteintraege.filter(
          (z) => z.objektId === p.objektId && z.zusatzauftragId === zusatzauftragId,
        );
        const archiviert = objekte.find((o) => o.id === p.objektId)?.archiviert;
        if (p.art === "pauschale" && archiviert && passend.length === 0) continue;
        addiere(jeZeile, zeilenSchluessel(p.objektId, zusatzauftragId), p.betragCent);
        if (p.art === "pauschale" || p.art === "zusatzauftrag-festbetrag") {
          verteileAufEintraege(p.betragCent, passend.map(ganz));
          continue;
        }
        // Stunden: erst nach den gerundeten Minuten je Tag auf die Tage,
        // dann innerhalb eines Tags nach echten Minuten auf die Einträge.
        const tage = ergebnis.stundennachweis.filter(
          (t) =>
            t.objektId === p.objektId &&
            t.taetigkeitId === p.taetigkeitId &&
            t.zusatzauftragId === zusatzauftragId,
        );
        verteile(
          p.betragCent,
          tage.map((t) => t.minuten),
        ).forEach((cent, i) =>
          verteileAufEintraege(
            cent,
            passend
              .filter((z) => z.taetigkeitId === p.taetigkeitId)
              .flatMap((z) =>
                aufBerlinerTageVerteilt(Date.parse(z.beginn), Date.parse(z.ende))
                  .filter((stueck) => stueck.datum === tage[i].datum)
                  .map((stueck) => ({ id: z.id, ms: stueck.ms })),
              ),
          ),
        );
      }
    }
  }
  return { jeZeile, jeEintrag };
}

// Verteilt einen Betrag in Cent nach Gewichten so, dass die Teile genau
// den Betrag ergeben: Jeder bekommt seinen abgerundeten Anteil, die
// übrigen Cent die mit den größten Resten. Ohne Gewicht bleibt der Betrag
// unverteilt.
function verteile(betragCent: number, gewichte: number[]): number[] {
  const gesamt = summe(gewichte);
  if (gesamt === 0) return gewichte.map(() => 0);
  const genau = gewichte.map((g) => (betragCent * g) / gesamt);
  const teile = genau.map(Math.floor);
  const rest = betragCent - summe(teile);
  genau
    .map((wert, i) => ({ i, rest: wert - teile[i] }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
    .slice(0, rest)
    .forEach(({ i }) => (teile[i] += 1));
  return teile;
}

function zeilenBewertung(
  eintraege: BewerteterEintrag[],
  einnahmenCent: number,
  festbetragOffen: boolean,
): Bewertung {
  const arbeitskostenCent = summeOderNull(eintraege.map((e) => e.arbeitskostenCent));
  const fahrkostenCent = summeOderNull(eintraege.map((e) => e.fahrkostenCent));
  return mitDeckungsbeitrag({
    einnahmenCent,
    arbeitsMinuten: Math.round(summe(eintraege.map((e) => e.arbeitsMinuten))),
    arbeitskostenCent,
    fahrtMinuten: Math.round(summe(eintraege.map((e) => e.fahrtMinuten))),
    fahrkostenCent,
    vorlaeufig: festbetragOffen || eintraege.some((e) => e.vorlaeufig),
    kostenFehlenFuer: eindeutig(
      eintraege
        .filter((e) => e.arbeitskostenCent === null || e.fahrkostenCent === null)
        .map((e) => e.mitarbeiterId),
    ),
  });
}

function bewertungOhneObjekt(
  fahrten: ZeiteintragFuerKosten[],
  satz: (z: ZeiteintragFuerKosten) => { centJeStunde: number } | null,
): Bewertung {
  const kosten = fahrten.map((f) => {
    const gilt = satz(f);
    const ms = Date.parse(f.ende) - Date.parse(f.beginn);
    return gilt === null ? null : kostenCent(ms, gilt.centJeStunde);
  });
  return mitDeckungsbeitrag({
    einnahmenCent: 0,
    arbeitsMinuten: 0,
    arbeitskostenCent: 0,
    fahrtMinuten: alsMinuten(summe(fahrten.map((f) => Date.parse(f.ende) - Date.parse(f.beginn)))),
    fahrkostenCent: summeOderNull(kosten),
    vorlaeufig: fahrten.some((f) => !f.freigegeben),
    kostenFehlenFuer: eindeutig(
      fahrten.filter((_, i) => kosten[i] === null).map((f) => f.mitarbeiterId),
    ),
  });
}

function summeDer(bewertungen: Bewertung[]): Bewertung {
  return mitDeckungsbeitrag({
    einnahmenCent: summe(bewertungen.map((b) => b.einnahmenCent)),
    arbeitsMinuten: summe(bewertungen.map((b) => b.arbeitsMinuten)),
    arbeitskostenCent: summeOderNull(bewertungen.map((b) => b.arbeitskostenCent)),
    fahrtMinuten: summe(bewertungen.map((b) => b.fahrtMinuten)),
    fahrkostenCent: summeOderNull(bewertungen.map((b) => b.fahrkostenCent)),
    vorlaeufig: bewertungen.some((b) => b.vorlaeufig),
    kostenFehlenFuer: eindeutig(bewertungen.flatMap((b) => b.kostenFehlenFuer)),
  });
}

function mitDeckungsbeitrag(
  b: Omit<Bewertung, "kostenCent" | "deckungsbeitragCent" | "deckungsbeitragAnteil">,
): Bewertung {
  const kosten = summeOderNull([b.arbeitskostenCent, b.fahrkostenCent]);
  const deckungsbeitragCent = kosten === null ? null : b.einnahmenCent - kosten;
  return {
    ...b,
    // Fehlt ein Teil der Kosten, bleiben alle leer, nie 0 €.
    arbeitskostenCent: kosten === null ? null : b.arbeitskostenCent,
    fahrkostenCent: kosten === null ? null : b.fahrkostenCent,
    kostenCent: kosten,
    deckungsbeitragCent,
    deckungsbeitragAnteil:
      deckungsbeitragCent === null || b.einnahmenCent === 0
        ? null
        : deckungsbeitragCent / b.einnahmenCent,
  };
}

function leereBewertung(): Bewertung {
  return mitDeckungsbeitrag({
    einnahmenCent: 0,
    arbeitsMinuten: 0,
    arbeitskostenCent: 0,
    fahrtMinuten: 0,
    fahrkostenCent: 0,
    vorlaeufig: false,
    kostenFehlenFuer: [],
  });
}

// Ohne Wert (keine Einnahmen oder fehlende Kosten) ganz oben, damit es
// auffällt; sonst aufsteigend.
function schwaecherZuerst(a: Bewertung, b: Bewertung): number {
  if (a.deckungsbeitragAnteil === null || b.deckungsbeitragAnteil === null) {
    return Number(b.deckungsbeitragAnteil === null) - Number(a.deckungsbeitragAnteil === null);
  }
  return a.deckungsbeitragAnteil - b.deckungsbeitragAnteil;
}

function zeilenSchluessel(objektId: string, zusatzauftragId: string | null): string {
  return `${objektId}|${zusatzauftragId ?? ""}`;
}

function berlinerMonat(zeitpunkt: string): Monat {
  return berlinerDatum(Date.parse(zeitpunkt)).slice(0, 7);
}

function kostenCent(ms: number, centJeStunde: number): number {
  return Math.round((ms * centJeStunde) / 3_600_000);
}

function alsMinuten(ms: number): number {
  return Math.round(ms / 60_000);
}

function summe(werte: number[]): number {
  return werte.reduce((s, w) => s + w, 0);
}

function summeOderNull(werte: (number | null)[]): number | null {
  return werte.some((w) => w === null) ? null : summe(werte as number[]);
}

function eindeutig(werte: string[]): string[] {
  return [...new Set(werte)];
}
