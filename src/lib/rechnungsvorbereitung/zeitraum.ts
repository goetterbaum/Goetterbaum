// Welchen Abrechnungszeitraum das Büro in der Rechnungsvorbereitung sieht.
// Ein Kunde wird monatlich oder je Kalenderquartal abgerechnet; Tage
// gelten in Berlin.
import type { Abrechnungszeitraum } from "@/lib/abrechnung";
import { berlinerDatum, berlinerMitternacht } from "@/lib/berliner-zeit";
import type { Monat } from "@/lib/rechnungsvorbereitung";
import { texte } from "@/texte";

// ersterMonat geht so an den Rechenbaustein; monate sind alle Monate des
// Zeitraums für die Spalte „Zeitraum“; ab und bisVor sind die Zeitpunkte
// als ISO-Text (Mitternacht am Ersten des ersten Monats bzw. des Monats
// nach dem Zeitraum).
export type GewaehlterZeitraum = {
  ersterMonat: Monat;
  bezeichnung: string;
  monate: Monate;
  ab: string;
  bisVor: string;
};

const MONATSNAMEN = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// Die Datenbank speichert einen Monat als Datum seines ersten Tages
// ("JJJJ-MM-01").
export function ersterTag(monat: Monat): string {
  return `${monat}-01`;
}

export function monatVon(ersterTag: string): Monat {
  return ersterTag.slice(0, 7);
}

// Ein Monat ("JJJJ-MM") als Text, z. B. „März 2026“.
export function monatAlsText(monat: Monat): string {
  return MONATSNAMEN.format(Date.parse(`${monat}-01T00:00:00Z`));
}

// Die Monate von `von` bis einschließlich `bis`.
export type Monate = { von: Monat; bis: Monat };

// Monate als Text: ein einzelner Monat ausgeschrieben („Oktober 2026“),
// mehrere kurz („Okt.–Dez. 2026“), über den Jahreswechsel mit beiden
// Jahren („Nov. 2026–Feb. 2027“).
export function monateAlsText({ von, bis }: Monate): string {
  if (von === bis) return monatAlsText(von);
  const t = texte.rechnungsvorbereitung;
  const kurz = (monat: Monat) => t.monateKurz[Number(monat.slice(5, 7)) - 1];
  const [vonJahr, bisJahr] = [von.slice(0, 4), bis.slice(0, 4)];
  return vonJahr === bisJahr
    ? `${t.monateVonBis(kurz(von), kurz(bis))} ${bisJahr}`
    : t.monateVonBis(`${kurz(von)} ${vonJahr}`, `${kurz(bis)} ${bisJahr}`);
}

// Die Monate, in denen Zeit beginnt (Zeitpunkte als ISO-Text), oder null
// ohne Zeit. Wie in der regulären Rechnungsvorbereitung zählt der Beginn.
export function monateDerZeit(beginne: string[]): Monate | null {
  if (beginne.length === 0) return null;
  const monate = beginne.map((beginn) => berlinerDatum(Date.parse(beginn)).slice(0, 7)).sort();
  return { von: monate[0], bis: monate[monate.length - 1] };
}

// Der Monat, der `anzahl` Monate nach dem Monat `nummer` (1–12) von `jahr`
// liegt; die Nummer darf über ihre Grenzen hinausgehen.
function monat(jahr: number, nummer: number, anzahl = 0): Monat {
  return new Date(Date.UTC(jahr, nummer - 1 + anzahl, 1)).toISOString().slice(0, 7);
}

// Liest den Monat aus der Adresszeile ("JJJJ-MM"). Ohne gültige Angabe
// gilt der letzte abgeschlossene Zeitraum: Abgerechnet wird meist zu
// Beginn des nächsten. Quartalsweise zählt immer das ganze Kalenderquartal
// des gewählten Monats.
export function gewaehlterZeitraum(
  wert: string | string[] | undefined,
  abrechnungszeitraum: Abrechnungszeitraum,
  jetzt: number,
): GewaehlterZeitraum {
  const quartalsweise = abrechnungszeitraum === "quartalsweise";
  const [hJahr, hMonat] = berlinerDatum(jetzt).split("-").map(Number);
  const gewaehlt = typeof wert === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(wert.trim()) : null;
  let [jahr, nummer] = gewaehlt
    ? [Number(gewaehlt[1]), Number(gewaehlt[2])]
    : [hJahr, hMonat - (quartalsweise ? 3 : 1)];
  if (nummer < 1) [jahr, nummer] = [jahr - 1, nummer + 12];
  if (quartalsweise) nummer -= (nummer - 1) % 3;

  const ersterMonat = monat(jahr, nummer);
  return {
    ersterMonat,
    bezeichnung: quartalsweise ? `${(nummer + 2) / 3}. Quartal ${jahr}` : monatAlsText(ersterMonat),
    monate: { von: ersterMonat, bis: monat(jahr, nummer, quartalsweise ? 2 : 0) },
    ab: new Date(berlinerMitternacht(`${ersterMonat}-01`)).toISOString(),
    bisVor: new Date(
      berlinerMitternacht(`${monat(jahr, nummer, quartalsweise ? 3 : 1)}-01`),
    ).toISOString(),
  };
}
