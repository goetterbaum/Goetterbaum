// Rechenbaustein Abrechnung: berechnet aus den Daten eines Kunden die
// Rechnungsvorbereitung für einen Abrechnungszeitraum. Ein reiner
// Baustein ohne Datenbank und Oberfläche; er ist die einzige Stelle, an
// der Geld berechnet wird. Alle Beträge in Cent als ganze Zahlen.
import type { Rundungsregel } from "./abrechnung";
import { aufBerlinerTageVerteilt, berlinerMitternacht } from "./berliner-zeit";
import { geltenderStundensatz } from "./stundensaetze/regeln";

// Ein Monat als "JJJJ-MM", z. B. "2026-07".
export type Monat = string;

export type Kunde = {
  // Die bereits aufgelöste Rundungsregel (Kunde oder Firmen-Standard).
  rundungsregel: Rundungsregel;
  abrechnungszeitraum: "monatlich" | "quartalsweise";
};

export type Objekt = {
  id: string;
  abrechnungsart: "pauschale" | "stunden";
  pauschaleCent: number | null;
};

export type Taetigkeit = {
  id: string;
  standardStundensatzCent: number;
  kundenStundensatzCent: number | null;
};

// Ein abweichender Stundensatz eines Objekts für eine Tätigkeit; er hat
// Vorrang vor dem des Kunden.
export type ObjektStundensatz = {
  objektId: string;
  taetigkeitId: string;
  stundensatzCent: number;
};

export type Zusatzauftrag = {
  id: string;
  objektId: string;
  abrechnungsart: "stunden" | "festbetrag";
  festbetragCent: number | null;
  erledigt: boolean;
};

export type Zeiteintrag = {
  id: string;
  mitarbeiterId: string;
  art: "taetigkeit" | "fahrt";
  objektId: string | null;
  taetigkeitId: string | null;
  zusatzauftragId: string | null;
  // Zeitpunkte als ISO-Text mit Zeitzone, wie sie aus der Datenbank kommen.
  beginn: string;
  ende: string;
};

export type Eingabe = {
  kunde: Kunde;
  // Erster Monat des Abrechnungszeitraums; quartalsweise umfasst er drei.
  ersterMonat: Monat;
  objekte: Objekt[];
  // Alle Tätigkeiten, die in den Zeiteinträgen vorkommen (auch archivierte).
  taetigkeiten: Taetigkeit[];
  objektStundensaetze: ObjektStundensatz[];
  // Nur noch nicht abgerechnete Zusatzaufträge der Objekte.
  zusatzauftraege: Zusatzauftrag[];
  // Freigegebene, noch nicht abgerechnete Zeiteinträge des Kunden.
  zeiteintraege: Zeiteintrag[];
  abgerechnetePauschalMonate: { objektId: string; monat: Monat }[];
};

// Ein Zeiteintrag für eine Tätigkeit in einem Objekt (keine Fahrt).
type ObjektEintrag = Zeiteintrag & { objektId: string; taetigkeitId: string };

// Nach Stunden berechnete Arbeit einer Tätigkeit.
export type Stunden = {
  taetigkeitId: string;
  // Gerundete Minuten; Stunden = minuten / 60.
  minuten: number;
  stundensatzCent: number;
  betragCent: number;
};

export type Position =
  | { art: "pauschale"; objektId: string; monat: Monat; betragCent: number }
  | ({ art: "stunden"; objektId: string } & Stunden)
  | ({ art: "zusatzauftrag-stunden"; zusatzauftragId: string; objektId: string } & Stunden)
  | {
      art: "zusatzauftrag-festbetrag";
      zusatzauftragId: string;
      objektId: string;
      betragCent: number;
    };

// Die Arbeit eines Kalendertags (Europe/Berlin) an einem Objekt für eine
// Tätigkeit, nach der Rundungsregel gerundet. Zugleich eine Zeile des
// Stundennachweises; Mitarbeiter werden nur gezählt, nicht genannt.
export type GerundeterTag = {
  datum: string;
  objektId: string;
  taetigkeitId: string;
  zusatzauftragId: string | null;
  minuten: number;
  personen: number;
};

export type Rechnungsvorbereitung = {
  positionen: Position[];
  summeCent: number;
  // Die Zeiteinträge, die mit dieser Abrechnung als abgerechnet gelten.
  zeiteintragIds: string[];
  stundennachweis: GerundeterTag[];
};

export function rechnungsvorbereitung(eingabe: Eingabe): Rechnungsvorbereitung {
  // Die Stelle in der Eingabeliste bestimmt die Reihenfolge der Ausgabe;
  // -1 heißt: nicht in der Eingabe.
  const objektStelle = (id: string) => eingabe.objekte.findIndex((o) => o.id === id);
  const taetigkeitStelle = (id: string) => eingabe.taetigkeiten.findIndex((t) => t.id === id);
  const zusatzauftragStelle = (id: string | null) =>
    eingabe.zusatzauftraege.findIndex((za) => za.id === id);

  const anzahlMonate = eingabe.kunde.abrechnungszeitraum === "quartalsweise" ? 3 : 1;
  const monate = Array.from({ length: anzahlMonate }, (_, i) =>
    spaeterMonat(eingabe.ersterMonat, i),
  );
  const zeitraumEnde = berlinerMitternacht(`${spaeterMonat(eingabe.ersterMonat, anzahlMonate)}-01`);

  const positionen: Position[] = [];
  for (const objekt of eingabe.objekte) {
    if (objekt.abrechnungsart !== "pauschale") continue;
    for (const monat of monate) {
      const schonAbgerechnet = eingabe.abgerechnetePauschalMonate.some(
        (a) => a.objektId === objekt.id && a.monat === monat,
      );
      if (schonAbgerechnet) continue;
      positionen.push({
        art: "pauschale",
        objektId: objekt.id,
        monat,
        betragCent: objekt.pauschaleCent ?? 0,
      });
    }
  }

  // Abgerechnet wird alle noch offene Zeit bis zum Ende des Zeitraums, auch
  // spät freigegebene aus früheren Zeiträumen. Zeit für einen Zusatzauftrag
  // mit Festbetrag gehört ganz zu dessen Betrag und wird mit ihm
  // abgerechnet, sobald er erledigt ist. Fahrten und Zeit in fremden
  // Objekten gehören nie dazu.
  const umfassteZeiteintraege = eingabe.zeiteintraege.filter((z): z is ObjektEintrag => {
    if (z.art === "fahrt" || z.objektId === null || z.taetigkeitId === null) return false;
    if (objektStelle(z.objektId) < 0 || taetigkeitStelle(z.taetigkeitId) < 0) return false;
    const imZeitraum = Date.parse(z.beginn) < zeitraumEnde;
    if (z.zusatzauftragId === null) return imZeitraum;
    const za = eingabe.zusatzauftraege[zusatzauftragStelle(z.zusatzauftragId)];
    if (za === undefined) return false;
    return za.abrechnungsart === "festbetrag" ? za.erledigt : imZeitraum;
  });

  // Nach Stunden berechnet werden die reguläre Zeit in Stunden-Objekten und
  // die Zeit für Zusatzaufträge nach Stunden. Nur diese Tage zeigt auch der
  // Stundennachweis.
  const berechneteTage = gerundeteTage(umfassteZeiteintraege, eingabe.kunde.rundungsregel)
    .filter((t) =>
      t.zusatzauftragId === null
        ? eingabe.objekte[objektStelle(t.objektId)].abrechnungsart === "stunden"
        : eingabe.zusatzauftraege[zusatzauftragStelle(t.zusatzauftragId)].abrechnungsart ===
          "stunden",
    )
    .sort(
      (a, b) =>
        a.datum.localeCompare(b.datum) ||
        objektStelle(a.objektId) - objektStelle(b.objektId) ||
        zusatzauftragStelle(a.zusatzauftragId) - zusatzauftragStelle(b.zusatzauftragId) ||
        taetigkeitStelle(a.taetigkeitId) - taetigkeitStelle(b.taetigkeitId),
    );

  for (const objekt of eingabe.objekte) {
    const regulaer = berechneteTage.filter(
      (tag) => tag.objektId === objekt.id && tag.zusatzauftragId === null,
    );
    for (const stunden of stundenJeTaetigkeit(regulaer, objekt.id, eingabe)) {
      positionen.push({ art: "stunden", objektId: objekt.id, ...stunden });
    }
  }
  for (const zusatzauftrag of eingabe.zusatzauftraege) {
    const { id: zusatzauftragId, objektId } = zusatzauftrag;
    if (objektStelle(objektId) < 0) continue;
    if (zusatzauftrag.abrechnungsart === "festbetrag") {
      if (!zusatzauftrag.erledigt) continue;
      const betragCent = zusatzauftrag.festbetragCent ?? 0;
      positionen.push({ art: "zusatzauftrag-festbetrag", zusatzauftragId, objektId, betragCent });
      continue;
    }
    const fuerAuftrag = berechneteTage.filter((tag) => tag.zusatzauftragId === zusatzauftragId);
    for (const stunden of stundenJeTaetigkeit(fuerAuftrag, objektId, eingabe)) {
      positionen.push({ art: "zusatzauftrag-stunden", zusatzauftragId, objektId, ...stunden });
    }
  }

  const summeCent = positionen.reduce((summe, p) => summe + p.betragCent, 0);
  return {
    positionen,
    summeCent,
    zeiteintragIds: umfassteZeiteintraege.map((z) => z.id),
    stundennachweis: berechneteTage,
  };
}

export type EingabeFuerZusatzauftrag = {
  // Die bereits aufgelöste Rundungsregel (Kunde oder Firmen-Standard).
  rundungsregel: Rundungsregel;
  zusatzauftrag: Zusatzauftrag;
  // Alle Tätigkeiten, die in den Zeiteinträgen vorkommen (auch archivierte).
  taetigkeiten: Taetigkeit[];
  // Die Stundensätze des Objekts, zu dem der Zusatzauftrag gehört.
  objektStundensaetze: ObjektStundensatz[];
  // Freigegebene, noch nicht abgerechnete Zeiteinträge des Zusatzauftrags
  // aus allen Monaten.
  zeiteintraege: Zeiteintrag[];
};

// Die Rechnungsvorbereitung für einen einzelnen Zusatzauftrag, den das
// Büro sofort nach der Erledigung abrechnet, ohne das Ende des
// Abrechnungszeitraums abzuwarten. Sie umfasst seine ganze noch offene
// Zeit, egal aus welchem Monat; nach Stunden wird sie berechnet wie in der
// regulären Rechnungsvorbereitung, beim Festbetrag gehört sie zu dessen
// Betrag. Ein offener Zusatzauftrag ergibt nichts.
export function rechnungsvorbereitungFuerZusatzauftrag(
  eingabe: EingabeFuerZusatzauftrag,
): Rechnungsvorbereitung {
  const { zusatzauftrag, taetigkeiten } = eingabe;
  const { id: zusatzauftragId, objektId } = zusatzauftrag;
  if (!zusatzauftrag.erledigt) {
    return { positionen: [], summeCent: 0, zeiteintragIds: [], stundennachweis: [] };
  }
  const taetigkeitStelle = (id: string) => taetigkeiten.findIndex((t) => t.id === id);

  const umfassteZeiteintraege = eingabe.zeiteintraege.filter(
    (z): z is ObjektEintrag =>
      z.art === "taetigkeit" &&
      z.zusatzauftragId === zusatzauftragId &&
      z.objektId === objektId &&
      z.taetigkeitId !== null &&
      taetigkeitStelle(z.taetigkeitId) >= 0,
  );
  const zeiteintragIds = umfassteZeiteintraege.map((z) => z.id);

  if (zusatzauftrag.abrechnungsart === "festbetrag") {
    const betragCent = zusatzauftrag.festbetragCent ?? 0;
    return {
      positionen: [{ art: "zusatzauftrag-festbetrag", zusatzauftragId, objektId, betragCent }],
      summeCent: betragCent,
      zeiteintragIds,
      stundennachweis: [],
    };
  }

  const tage = gerundeteTage(umfassteZeiteintraege, eingabe.rundungsregel).sort(
    (a, b) =>
      a.datum.localeCompare(b.datum) ||
      taetigkeitStelle(a.taetigkeitId) - taetigkeitStelle(b.taetigkeitId),
  );
  const positionen: Position[] = stundenJeTaetigkeit(tage, objektId, eingabe).map((stunden) => ({
    art: "zusatzauftrag-stunden",
    zusatzauftragId,
    objektId,
    ...stunden,
  }));
  return {
    positionen,
    summeCent: positionen.reduce((summe, p) => summe + p.betragCent, 0),
    zeiteintragIds,
    stundennachweis: tage,
  };
}

// Die Stunden je Tätigkeit aus den Tagen einer Position im Objekt, in der
// Reihenfolge der Tätigkeiten.
function stundenJeTaetigkeit(
  tage: GerundeterTag[],
  objektId: string,
  { taetigkeiten, objektStundensaetze }: Pick<Eingabe, "taetigkeiten" | "objektStundensaetze">,
): Stunden[] {
  return taetigkeiten.flatMap((taetigkeit) => {
    const minuten = tage
      .filter((tag) => tag.taetigkeitId === taetigkeit.id)
      .reduce((summe, tag) => summe + tag.minuten, 0);
    if (minuten === 0) return [];
    const objektSatz = objektStundensaetze.find(
      (s) => s.objektId === objektId && s.taetigkeitId === taetigkeit.id,
    );
    const { stundensatzCent } = geltenderStundensatz({
      standardCent: taetigkeit.standardStundensatzCent,
      kundeCent: taetigkeit.kundenStundensatzCent,
      objektCent: objektSatz?.stundensatzCent ?? null,
    });
    const betragCent = Math.round((minuten * stundensatzCent) / 60);
    return [{ taetigkeitId: taetigkeit.id, minuten, stundensatzCent, betragCent }];
  });
}

// Der Monat, der `anzahl` Monate nach `monat` liegt.
function spaeterMonat(monat: Monat, anzahl: number): Monat {
  const [jahr, nummer] = monat.split("-").map(Number);
  return new Date(Date.UTC(jahr, nummer - 1 + anzahl, 1)).toISOString().slice(0, 7);
}

// Fasst Zeiteinträge mit Objekt und Tätigkeit je Objekt, Tätigkeit,
// Zusatzauftrag und Kalendertag zusammen und rundet die Summe. Sekunden
// werden zuerst auf ganze Minuten gerundet.
function gerundeteTage(
  zeiteintraege: ObjektEintrag[],
  regel: Kunde["rundungsregel"],
): GerundeterTag[] {
  type Gruppe = Omit<GerundeterTag, "minuten" | "personen"> & {
    ms: number;
    mitarbeiter: Set<string>;
  };
  const gruppen = new Map<string, Gruppe>();
  for (const z of zeiteintraege) {
    for (const { datum, ms } of aufBerlinerTageVerteilt(Date.parse(z.beginn), Date.parse(z.ende))) {
      const schluessel = [z.objektId, z.taetigkeitId, z.zusatzauftragId, datum].join("|");
      const gruppe = gruppen.get(schluessel) ?? {
        datum,
        objektId: z.objektId,
        taetigkeitId: z.taetigkeitId,
        zusatzauftragId: z.zusatzauftragId,
        ms: 0,
        mitarbeiter: new Set<string>(),
      };
      gruppe.ms += ms;
      gruppe.mitarbeiter.add(z.mitarbeiterId);
      gruppen.set(schluessel, gruppe);
    }
  }
  return [...gruppen.values()].map(({ ms, mitarbeiter, ...tag }) => ({
    ...tag,
    minuten: runde(Math.round(ms / 60_000), regel),
    personen: mitarbeiter.size,
  }));
}

function runde(minuten: number, regel: Kunde["rundungsregel"]): number {
  if (regel === "minutengenau") return minuten;
  return Math.ceil(minuten / 15) * 15;
}
