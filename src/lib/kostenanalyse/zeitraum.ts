// Der Zeitraum der Kostenanalyse: ein Monat oder ein ganzes Jahr, aus der
// Adresszeile (von, bis) wie bei den übrigen Auswertungen; für die
// Tagesansicht ein Tag (datum).
import { monatsZeitraum, vorausgewaehlterMonat, type Parameter } from "@/lib/auswertungen/zeitraum";
import { berlinerDatum } from "@/lib/berliner-zeit";
import type { Monat } from "@/lib/rechnungsvorbereitung";
import { monatAlsText } from "@/lib/rechnungsvorbereitung/zeitraum";
import { istDatum } from "@/lib/zeiterfassung/nachtrag";
import { texte } from "@/texte";

// von und bis sind der erste und der letzte Tag ("JJJJ-MM-TT").
export type KostenZeitraum = {
  monate: Monat[];
  ganzesJahr: boolean;
  von: string;
  bis: string;
  bezeichnung: string;
};

// Umfassen von und bis genau einen Monat oder ein Jahr, gilt dieser
// Zeitraum, sonst der vorausgewählte Monat der Auswertungen.
export function kostenZeitraum(parameter: Parameter, jetzt: number): KostenZeitraum {
  const tag = (name: string) => {
    const wert = parameter[name];
    return typeof wert === "string" && istDatum(wert.trim()) ? wert.trim() : null;
  };
  const [von, bis] = [tag("von"), tag("bis")];
  if (von !== null && bis !== null) {
    const jahr = von.slice(0, 4);
    if (von === `${jahr}-01-01` && bis === `${jahr}-12-31`) {
      return {
        monate: Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, "0")}`),
        ganzesJahr: true,
        von,
        bis,
        bezeichnung: texte.kostenanalyse.jahr(jahr),
      };
    }
    const monat = monatsZeitraum(von.slice(0, 7));
    if (monat.von === von && monat.bis === bis) return einMonat(von.slice(0, 7));
  }
  return einMonat(vorausgewaehlterMonat(jetzt));
}

// Der Tag der Tagesansicht ("JJJJ-MM-TT"): datum aus der Adresszeile,
// sonst heute in Berlin.
export function kostenTag(parameter: Parameter, jetzt: number): string {
  const wert = parameter.datum;
  const datum = typeof wert === "string" ? wert.trim() : "";
  return istDatum(datum) ? datum : berlinerDatum(jetzt);
}

// Der Tag, der `tage` Tage vor (negativ) oder nach `datum` liegt.
export function tagVerschoben(datum: string, tage: number): string {
  const [jahr, monat, tag] = datum.split("-").map(Number);
  return new Date(Date.UTC(jahr, monat - 1, tag + tage)).toISOString().slice(0, 10);
}

// Der Monat, in dem ein Tag liegt, als Zeitraum.
export function monatDerKosten(datum: string): KostenZeitraum {
  return einMonat(datum.slice(0, 7));
}

function einMonat(monat: Monat): KostenZeitraum {
  return {
    monate: [monat],
    ganzesJahr: false,
    ...monatsZeitraum(monat),
    bezeichnung: monatAlsText(monat),
  };
}
