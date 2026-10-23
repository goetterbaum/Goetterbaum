// Der Arbeitszeitnachweis eines Mitarbeiters für einen Zeitraum: alle
// seine beendeten Zeiteinträge einschließlich Fahrten, je Kalendertag in
// Berlin mit Tagessumme. Ein Zeiteintrag über Mitternacht wird an der
// Tagesgrenze geteilt, damit jeder Tag nur seine eigene Zeit zählt.
import { aufBerlinerTageVerteilt, berlinerUhrzeit, datumAlsText } from "@/lib/berliner-zeit";
import { csvInhalt, csvText as text } from "@/lib/csv";
import { stundenAlsText } from "@/lib/rechnungsvorbereitung/zeilen";
import type { ZeiteintragArt } from "@/lib/zeiterfassung/anzeige";
import { texte } from "@/texte";

// Ein beendeter Zeiteintrag mit Namen. Zeitpunkte als ISO-Text mit
// Zeitzone; Objekt und Tätigkeit fehlen bei Fahrten, der Zusatzauftrag bei
// regulärer Arbeit.
export type EintragFuerNachweis = {
  art: ZeiteintragArt;
  beginn: string;
  ende: string;
  objekt: string | null;
  taetigkeit: string | null;
  zusatzauftrag: string | null;
  nachtrag: boolean;
};

// Der Teil eines Zeiteintrags an einem Tag. von und bis als "HH:MM" in
// Berlin; endet er um Mitternacht, ist bis "24:00". minuten: die Dauer auf
// ganze Minuten gerundet.
export type NachweisZeile = Omit<EintragFuerNachweis, "beginn" | "ende"> & {
  von: string;
  bis: string;
  minuten: number;
};

export type NachweisTag = { datum: string; zeilen: NachweisZeile[]; minuten: number };

export type Arbeitszeitnachweis = { tage: NachweisTag[]; minuten: number };

// von und bis sind die Tage des Zeitraums ("JJJJ-MM-TT"), beide
// eingeschlossen. Die Tagessumme ist die Summe der angezeigten Minuten,
// damit der Nachweis beim Nachrechnen aufgeht.
export function arbeitszeitnachweis(
  eintraege: EintragFuerNachweis[],
  von: string,
  bis: string,
): Arbeitszeitnachweis {
  const tage = new Map<string, NachweisTag>();
  const sortiert = [...eintraege].sort((a, b) => Date.parse(a.beginn) - Date.parse(b.beginn));
  for (const { beginn, ende, ...eintrag } of sortiert) {
    let anfang = Date.parse(beginn);
    const schluss = Date.parse(ende);
    for (const { datum, ms } of aufBerlinerTageVerteilt(anfang, schluss)) {
      const bisZeitpunkt = anfang + ms;
      const zeile: NachweisZeile = {
        ...eintrag,
        von: berlinerUhrzeit(anfang),
        bis: bisZeitpunkt < schluss ? "24:00" : berlinerUhrzeit(bisZeitpunkt),
        minuten: Math.round(ms / 60_000),
      };
      anfang = bisZeitpunkt;
      if (datum < von || datum > bis) continue;
      const tag = tage.get(datum) ?? { datum, zeilen: [], minuten: 0 };
      tag.zeilen.push(zeile);
      tag.minuten += zeile.minuten;
      tage.set(datum, tag);
    }
  }
  const alle = [...tage.values()].sort((a, b) => a.datum.localeCompare(b.datum));
  return { tage: alle, minuten: alle.reduce((summe, tag) => summe + tag.minuten, 0) };
}

export function arbeitszeitnachweisCsv({ tage, minuten }: Arbeitszeitnachweis): string {
  const t = texte.arbeitszeitnachweis;
  const kopf = [
    t.spalteDatum,
    t.spalteVon,
    t.spalteBis,
    t.spalteArt,
    t.spalteObjekt,
    t.spalteTaetigkeit,
    t.spalteZusatzauftrag,
    t.spalteNachtrag,
    t.spalteStunden,
    t.spalteMinuten,
  ];
  const dauer = (m: number) => [stundenAlsText(m), String(m)];
  const zeilen = tage.flatMap((tag) => {
    const datum = datumAlsText(tag.datum);
    return [
      ...tag.zeilen.map((z) => [
        datum,
        z.von,
        z.bis,
        z.art === "fahrt" ? texte.erfassung.fahrt : texte.erfassung.taetigkeit,
        text(z.objekt ?? ""),
        text(z.taetigkeit ?? ""),
        text(z.zusatzauftrag ?? ""),
        z.nachtrag ? texte.nachtrag.markierung : "",
        ...dauer(z.minuten),
      ]),
      [datum, "", "", t.tagessumme, "", "", "", "", ...dauer(tag.minuten)],
    ];
  });
  const summe = [t.summe, "", "", "", "", "", "", "", ...dauer(minuten)];
  return csvInhalt([kopf, ...zeilen, summe]);
}
