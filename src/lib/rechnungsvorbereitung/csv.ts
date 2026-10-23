// Die Rechnungsvorbereitung als CSV-Datei. Beträge stehen als Kommazahl
// ohne Euro-Zeichen darin, damit Excel mit ihnen rechnen kann.
import { csvDatei as datei, csvInhalt, csvText as text } from "@/lib/csv";
import { euroAlsEingabe } from "@/lib/geld";
import { texte } from "@/texte";
import { stundenAlsText, type Zeilen } from "./zeilen";

export function rechnungsCsv({ zeilen, summeCent }: Zeilen): string {
  const t = texte.rechnungsvorbereitung;
  const kopf = [
    t.spaltePosition,
    t.spalteObjekt,
    t.spalteZusatzauftrag,
    t.spalteTaetigkeit,
    t.spalteMonat,
    t.spalteStunden,
    t.spalteMinuten,
    t.spalteStundensatz,
    t.spalteBetrag,
  ];
  const zeilenAlsText = zeilen.map((z) => [
    text(z.position),
    text(z.objekt),
    text(z.zusatzauftrag),
    text(z.taetigkeit),
    text(z.monat),
    z.minuten === null ? "" : stundenAlsText(z.minuten),
    z.minuten === null ? "" : String(z.minuten),
    z.stundensatzCent === null ? "" : euroAlsEingabe(z.stundensatzCent),
    euroAlsEingabe(z.betragCent),
  ]);
  const summe = [t.summe, ...kopf.slice(2).map(() => ""), euroAlsEingabe(summeCent)];
  return csvInhalt([kopf, ...zeilenAlsText, summe]);
}

// Eine CSV-Datei der Rechnungsvorbereitung als Antwort zum Herunterladen.
export function csvDatei(csv: string, dateiname: string): Response {
  return datei(csv, dateiname, "Rechnungsvorbereitung.csv");
}
