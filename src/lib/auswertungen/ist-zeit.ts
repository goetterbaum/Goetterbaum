// Die tatsächlich erfasste Zeit in einem Pauschal-Objekt für einen
// Zeitraum, damit das Büro sieht, ob sich die Pauschale lohnt. Gezählt
// wird ohne Rundungsregel, nur auf ganze Minuten je Tätigkeit gerundet.
// Zeit für Zusatzaufträge ist nicht mit der Pauschale bezahlt und steht
// deshalb gesondert.
import { aufBerlinerTageVerteilt } from "@/lib/berliner-zeit";

// Ein beendeter Zeiteintrag in dem Objekt (Fahrten haben kein Objekt).
export type EintragFuerIstZeit = {
  // Der Name der Tätigkeit; er ist je Firma eindeutig.
  taetigkeit: string;
  zusatzauftragId: string | null;
  beginn: string;
  ende: string;
};

export type IstZeit = {
  // In der Reihenfolge, in der die Tätigkeiten zuerst vorkommen.
  jeTaetigkeit: { taetigkeit: string; minuten: number }[];
  minuten: number;
  zusatzauftraegeMinuten: number;
};

// von und bis sind die Tage des Zeitraums ("JJJJ-MM-TT"), beide
// eingeschlossen; Tage gelten in Berlin.
export function istZeit(eintraege: EintragFuerIstZeit[], von: string, bis: string): IstZeit {
  const imZeitraum = (z: EintragFuerIstZeit) =>
    aufBerlinerTageVerteilt(Date.parse(z.beginn), Date.parse(z.ende))
      .filter((stueck) => stueck.datum >= von && stueck.datum <= bis)
      .reduce((summe, stueck) => summe + stueck.ms, 0);

  const jeTaetigkeitMs = new Map<string, number>();
  let zusatzauftraegeMs = 0;
  for (const z of [...eintraege].sort((a, b) => Date.parse(a.beginn) - Date.parse(b.beginn))) {
    const ms = imZeitraum(z);
    if (ms === 0) continue;
    if (z.zusatzauftragId !== null) zusatzauftraegeMs += ms;
    else jeTaetigkeitMs.set(z.taetigkeit, (jeTaetigkeitMs.get(z.taetigkeit) ?? 0) + ms);
  }

  const jeTaetigkeit = [...jeTaetigkeitMs].map(([taetigkeit, ms]) => ({
    taetigkeit,
    minuten: Math.round(ms / 60_000),
  }));
  return {
    jeTaetigkeit,
    minuten: jeTaetigkeit.reduce((summe, t) => summe + t.minuten, 0),
    zusatzauftraegeMinuten: Math.round(zusatzauftraegeMs / 60_000),
  };
}
