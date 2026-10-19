// Rechenbaustein Abrechnung: berechnet aus den Daten eines Kunden die
// Rechnungsvorbereitung für einen Abrechnungszeitraum. Ein reiner
// Baustein ohne Datenbank und Oberfläche; er ist die einzige Stelle, an
// der Geld berechnet wird. Alle Beträge in Cent als ganze Zahlen.
import type { Rundungsregel } from "./abrechnung";
import { aufBerlinerTageVerteilt, berlinerMitternacht } from "./berliner-zeit";

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
  // Ein archiviertes Pauschal-Objekt bekommt keine Pauschale mehr; Zeit
  // für seine Zusatzaufträge wird noch abgerechnet.
  archiviert: boolean;
};

export type Taetigkeit = {
  id: string;
  standardStundensatzCent: number;
  kundenStundensatzCent: number | null;
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
    if (objekt.abrechnungsart !== "pauschale" || objekt.archiviert) continue;
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

  const stundenJeTaetigkeit = (gehoertDazu: (tag: GerundeterTag) => boolean) =>
    stundenAusTagen(berechneteTage.filter(gehoertDazu), eingabe.taetigkeiten);

  for (const objekt of eingabe.objekte) {
    const regulaer = (tag: GerundeterTag) =>
      tag.objektId === objekt.id && tag.zusatzauftragId === null;
    for (const stunden of stundenJeTaetigkeit(regulaer)) {
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
    const fuerAuftrag = (tag: GerundeterTag) => tag.zusatzauftragId === zusatzauftragId;
    for (const stunden of stundenJeTaetigkeit(fuerAuftrag)) {
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

export type ZusatzauftragsEingabe = {
  // Die bereits aufgelöste Rundungsregel (Kunde oder Firmen-Standard).
  rundungsregel: Rundungsregel;
  zusatzauftrag: Zusatzauftrag;
  // Alle Tätigkeiten, die in den Zeiteinträgen vorkommen (auch archivierte).
  taetigkeiten: Taetigkeit[];
  // Freigegebene, noch nicht abgerechnete Zeiteinträge des Zusatzauftrags.
  zeiteintraege: Zeiteintrag[];
};

// Die Einzelabrechnung eines erledigten Zusatzauftrags, ohne das Ende des
// Abrechnungszeitraums abzuwarten: mit Festbetrag dessen Betrag, nach
// Stunden all seine noch offene Zeit, egal in welchem Monat sie lag. Ein
// offener Zusatzauftrag ergibt nichts.
export function zusatzauftragsAbrechnung(eingabe: ZusatzauftragsEingabe): Rechnungsvorbereitung {
  const za = eingabe.zusatzauftrag;
  if (!za.erledigt)
    return { positionen: [], summeCent: 0, zeiteintragIds: [], stundennachweis: [] };
  const umfasst = eingabe.zeiteintraege.filter(
    (z): z is ObjektEintrag =>
      z.zusatzauftragId === za.id &&
      z.objektId === za.objektId &&
      z.taetigkeitId !== null &&
      eingabe.taetigkeiten.some((t) => t.id === z.taetigkeitId),
  );
  const zeiteintragIds = umfasst.map((z) => z.id);
  const kennung = { zusatzauftragId: za.id, objektId: za.objektId };

  if (za.abrechnungsart === "festbetrag") {
    const betragCent = za.festbetragCent ?? 0;
    return {
      positionen: [{ art: "zusatzauftrag-festbetrag", ...kennung, betragCent }],
      summeCent: betragCent,
      zeiteintragIds,
      stundennachweis: [],
    };
  }
  const tage = gerundeteTage(umfasst, eingabe.rundungsregel).sort(
    (a, b) =>
      a.datum.localeCompare(b.datum) ||
      eingabe.taetigkeiten.findIndex((t) => t.id === a.taetigkeitId) -
        eingabe.taetigkeiten.findIndex((t) => t.id === b.taetigkeitId),
  );
  const positionen: Position[] = stundenAusTagen(tage, eingabe.taetigkeiten).map((stunden) => ({
    art: "zusatzauftrag-stunden",
    ...kennung,
    ...stunden,
  }));
  return {
    positionen,
    summeCent: positionen.reduce((summe, p) => summe + p.betragCent, 0),
    zeiteintragIds,
    stundennachweis: tage,
  };
}

// Die Stunden je Tätigkeit aus gerundeten Tagen, in der Reihenfolge der
// Tätigkeiten; der kundenspezifische Stundensatz schlägt den Standard.
function stundenAusTagen(tage: GerundeterTag[], taetigkeiten: Taetigkeit[]): Stunden[] {
  return taetigkeiten.flatMap((taetigkeit) => {
    const minuten = tage
      .filter((tag) => tag.taetigkeitId === taetigkeit.id)
      .reduce((summe, tag) => summe + tag.minuten, 0);
    if (minuten === 0) return [];
    const stundensatzCent = taetigkeit.kundenStundensatzCent ?? taetigkeit.standardStundensatzCent;
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
