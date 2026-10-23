// Der Stundennachweis zu einer Rechnungsvorbereitung als CSV-Datei. Er
// entsteht nur, wenn ein Kunde danach fragt. Seine Zeilen sind die
// gerundeten Tage aus dem Rechenbaustein, genau die berechneten Stunden;
// Mitarbeiter werden nur gezählt, nie genannt.
import { datumAlsText } from "@/lib/berliner-zeit";
import { csvInhalt, csvText as text } from "@/lib/csv";
import type { GerundeterTag } from "@/lib/rechnungsvorbereitung";
import { texte } from "@/texte";
import { stundenAlsText, type Namen } from "./zeilen";

export function stundennachweisCsv(tage: GerundeterTag[], namen: Namen): string {
  const t = texte.rechnungsvorbereitung;
  const name = (liste: Map<string, string>, id: string) => liste.get(id) ?? t.unbekannt;
  const kopf = [
    texte.stundennachweis.spalteDatum,
    t.spalteObjekt,
    t.spalteZusatzauftrag,
    t.spalteTaetigkeit,
    t.spalteStunden,
    t.spalteMinuten,
    texte.stundennachweis.spaltePersonen,
  ];
  const zeilen = tage.map((tag) => [
    datumAlsText(tag.datum),
    text(name(namen.objekte, tag.objektId)),
    tag.zusatzauftragId === null ? "" : text(name(namen.zusatzauftraege, tag.zusatzauftragId)),
    text(name(namen.taetigkeiten, tag.taetigkeitId)),
    stundenAlsText(tag.minuten),
    String(tag.minuten),
    String(tag.personen),
  ]);
  const minuten = tage.reduce((summe, tag) => summe + tag.minuten, 0);
  const summe = [t.summe, "", "", "", stundenAlsText(minuten), String(minuten), ""];
  return csvInhalt([kopf, ...zeilen, summe]);
}
