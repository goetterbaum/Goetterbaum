// Die Objektübersicht der Kostenanalyse als Zeilen mit Namen statt
// Kennungen, in der Reihenfolge des Rechenbausteins. Seite und CSV-Export
// zeigen genau diese Zeilen; alle Zahlen kommen unverändert aus dem
// Baustein.
import { csvInhalt, csvText as text } from "@/lib/csv";
import { euroAlsEingabe } from "@/lib/geld";
import type { Bewertung, Kostenanalyse } from "@/lib/kostenanalyse";
import { stundenAlsText } from "@/lib/rechnungsvorbereitung/zeilen";
import { texte } from "@/texte";
import type { Namen } from "./verwaltung";

export type UebersichtsZeile = {
  art: "objekt" | "zusatzauftrag" | "kundensumme" | "fahrten-ohne-objekt" | "gesamtsumme";
  kunde: string;
  // Objekt, „↳ Beschreibung“ des Zusatzauftrags oder Name der Summe.
  bezeichnung: string;
  // Für die Details; null bei Summen.
  objektId: string | null;
  zusatzauftragId: string | null;
  bewertung: Bewertung;
  // „vorläufig“ und „Kosten fehlen für: …“, sonst leer.
  hinweis: string;
};

export function uebersichtsZeilen(ergebnis: Kostenanalyse, namen: Namen): UebersichtsZeile[] {
  const t = texte.kostenanalyse;
  const mit = (zeile: Omit<UebersichtsZeile, "hinweis">): UebersichtsZeile => ({
    ...zeile,
    hinweis: hinweis(zeile.bewertung, namen),
  });
  const zeilen = ergebnis.kunden.flatMap((k) => {
    const kunde = name(namen.kunden, k.kundeId);
    return [
      ...k.objekte.flatMap(({ zeile, zusatzauftraege }) => [
        mit({
          art: "objekt",
          kunde,
          bezeichnung: name(namen.objekte, zeile.objektId),
          objektId: zeile.objektId,
          zusatzauftragId: null,
          bewertung: zeile,
        }),
        ...zusatzauftraege.map((za) =>
          mit({
            art: "zusatzauftrag",
            kunde,
            bezeichnung: t.zusatzauftrag(name(namen.zusatzauftraege, za.zusatzauftragId!)),
            objektId: za.objektId,
            zusatzauftragId: za.zusatzauftragId,
            bewertung: za,
          }),
        ),
      ]),
      mit({
        art: "kundensumme",
        kunde,
        bezeichnung: t.kundensumme(kunde),
        objektId: null,
        zusatzauftragId: null,
        bewertung: k.summe,
      }),
    ];
  });
  const summen = { kunde: "", objektId: null, zusatzauftragId: null };
  if (ergebnis.fahrtenOhneObjekt) {
    zeilen.push(
      mit({
        ...summen,
        art: "fahrten-ohne-objekt",
        bezeichnung: t.fahrtenOhneObjekt,
        bewertung: ergebnis.fahrtenOhneObjekt,
      }),
    );
  }
  zeilen.push(
    mit({ ...summen, art: "gesamtsumme", bezeichnung: t.gesamtsumme, bewertung: ergebnis.summe }),
  );
  return zeilen;
}

export function hinweis(bewertung: Bewertung, namen: Namen): string {
  const t = texte.kostenanalyse;
  const fehlen = bewertung.kostenFehlenFuer.map((id) => name(namen.mitarbeiter, id));
  return [
    bewertung.vorlaeufig ? t.vorlaeufig : "",
    fehlen.length > 0 ? t.kostenFehlen(fehlen.join(", ")) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const PROZENT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// Der Deckungsbeitrag in Prozent, z. B. „13,3“, oder „–“ ohne Wert.
export function prozentAlsText(anteil: number | null): string {
  return anteil === null ? texte.kostenanalyse.ohneWert : PROZENT.format(anteil * 100);
}

// Die Objektübersicht als CSV-Datei mit denselben Spalten wie die Seite,
// dazu der Kunde. Beträge als Kommazahl ohne Euro-Zeichen, damit Excel mit
// ihnen rechnen kann; fehlende Kosten bleiben leer.
export function kostenCsv(zeilen: UebersichtsZeile[]): string {
  const t = texte.kostenanalyse;
  const euro = (cent: number | null) => (cent === null ? "" : euroAlsEingabe(cent));
  const kopf = [
    t.spalteKunde,
    t.spalteObjekt,
    t.spalteEinnahmen,
    t.spalteArbeitsstunden,
    t.spalteArbeitskosten,
    t.spalteFahrzeit,
    t.spalteFahrkosten,
    t.spalteDeckungsbeitrag,
    t.spalteDeckungsbeitragProzent,
    t.spalteHinweis,
  ];
  return csvInhalt([
    kopf,
    ...zeilen.map(({ kunde, bezeichnung, bewertung: b, hinweis }) => [
      text(kunde),
      text(bezeichnung),
      euro(b.einnahmenCent),
      stundenAlsText(b.arbeitsMinuten),
      euro(b.arbeitskostenCent),
      stundenAlsText(b.fahrtMinuten),
      euro(b.fahrkostenCent),
      euro(b.deckungsbeitragCent),
      prozentAlsText(b.deckungsbeitragAnteil),
      text(hinweis),
    ]),
  ]);
}

// Der Name zu einer Kennung, „unbekannt“ statt einer leeren Zelle.
export function name(liste: Map<string, string>, id: string): string {
  return liste.get(id) ?? texte.kostenanalyse.unbekannt;
}
