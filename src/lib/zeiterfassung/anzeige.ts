// Bereitet die eigenen Zeiteinträge für die Anzeige am Handy auf. Tage
// und Uhrzeiten gelten in Berlin, egal wo der Server läuft.
import { aufBerlinerTageVerteilt, berlinerDatum, berlinerMitternacht } from "@/lib/berliner-zeit";
import { stundenAlsText } from "@/lib/rechnungsvorbereitung/zeilen";
import { texte } from "@/texte";

// Die Arten eines Zeiteintrags, wie in der Datenbank (Typ zeiteintrag_art).
export type ZeiteintragArt = "taetigkeit" | "fahrt";

// Die Art in Worten.
export function artAlsText(art: ZeiteintragArt): string {
  return art === "fahrt" ? texte.erfassung.fahrt : texte.erfassung.taetigkeit;
}

// Ein Zeiteintrag eines Mitarbeiters, wie ihn die Datenbank-Funktionen
// meine_zeiteintraege und zeiteintraege_von liefern.
export type MeinZeiteintrag = {
  id: string;
  art: ZeiteintragArt;
  // Zeitpunkte als ISO-Text mit Zeitzone; ende ist leer, solange er läuft.
  beginn: string;
  ende: string | null;
  // Nachträglich eingetragen oder geändert (setzt die Datenbank).
  nachtrag: boolean;
  // Vom Büro freigegeben; dann für Mitarbeiter und Vorarbeiter gesperrt.
  freigegeben: boolean;
  objekt_bezeichnung: string | null;
  taetigkeit_name: string | null;
  // Leer bei regulärer Arbeit und bei Fahrten.
  zusatzauftrag_beschreibung: string | null;
  // Wer den Eintrag angelegt hat: der Mitarbeiter selbst, ein Vorarbeiter
  // oder das Büro.
  angelegt_von: string;
  angelegt_von_name: string | null;
};

export type AngezeigterEintrag = MeinZeiteintrag & {
  von: string;
  bis: string;
  dauer: string;
};

export type Tag = { datum: string; titel: string; eintraege: AngezeigterEintrag[] };

const uhrzeit = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
});

const tagesTitel = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

// Eine Dauer in ms als "Stunden:Minuten h", auf ganze Minuten gerundet.
function dauerAlsText(ms: number): string {
  const minuten = Math.round(ms / 60_000);
  return `${Math.floor(minuten / 60)}:${String(minuten % 60).padStart(2, "0")} h`;
}

// Die beendeten Einträge je Kalendertag (nach Beginn), der neueste Tag
// zuerst, innerhalb eines Tages in zeitlicher Reihenfolge.
export function nachTagen(eintraege: MeinZeiteintrag[]): Tag[] {
  const tage = new Map<string, Tag>();
  const sortiert = eintraege
    .filter((e): e is MeinZeiteintrag & { ende: string } => e.ende !== null)
    .sort((a, b) => Date.parse(a.beginn) - Date.parse(b.beginn));

  for (const e of sortiert) {
    const beginn = Date.parse(e.beginn);
    const ende = Date.parse(e.ende);
    const datum = berlinerDatum(beginn);
    const tag = tage.get(datum) ?? { datum, titel: tagesTitel.format(beginn), eintraege: [] };
    tag.eintraege.push({
      ...e,
      von: uhrzeit.format(beginn),
      bis: uhrzeit.format(ende),
      dauer: dauerAlsText(ende - beginn),
    });
    tage.set(datum, tag);
  }

  return [...tage.values()].sort((a, b) => b.datum.localeCompare(a.datum));
}

// Seit wann ein Eintrag läuft: heute nur die Uhrzeit, an einem früheren
// Tag mit Tag davor, damit ein vergessener Stopp auffällt.
export function laeuftSeit(beginn: string, jetzt: number): string {
  const zeitpunkt = Date.parse(beginn);
  const um = uhrzeit.format(zeitpunkt);
  if (berlinerDatum(zeitpunkt) === berlinerDatum(jetzt)) return um;
  return `${tagesTitel.format(zeitpunkt)}, ${um}`;
}

// Nach wie vielen Stunden ein laufender Eintrag als unvollständig gilt.
// Dieselbe Grenze steht in der Datenbank (privat.zeiteintrag_unvollstaendig).
export const UNVOLLSTAENDIG_NACH_STUNDEN = 12;

// Ein Eintrag, der länger als 12 Stunden läuft, ist unvollständig: Der
// Stopp wurde wohl vergessen. Das ergibt sich aus der Laufzeit und wird
// nicht gespeichert; beendet wird er nie von selbst.
export function istUnvollstaendig(
  eintrag: Pick<MeinZeiteintrag, "beginn" | "ende">,
  jetzt: number,
): boolean {
  if (eintrag.ende !== null) return false;
  return jetzt - Date.parse(eintrag.beginn) > UNVOLLSTAENDIG_NACH_STUNDEN * 60 * 60 * 1000;
}

// Wie viele Kalendertage die Liste der eigenen Einträge zeigt (heute
// eingeschlossen).
export const ANGEZEIGTE_TAGE = 7;

// Ab wann die eigenen Einträge angezeigt werden: Mitternacht in Berlin am
// ersten der angezeigten Tage, als ISO-Text.
export function angezeigtAb(jetzt: number): string {
  const [jahr, monat, tag] = berlinerDatum(jetzt).split("-").map(Number);
  const ersterTag = new Date(Date.UTC(jahr, monat - 1, tag - (ANGEZEIGTE_TAGE - 1)));
  return new Date(berlinerMitternacht(ersterTag.toISOString().slice(0, 10))).toISOString();
}

// Tag und von – bis eines Eintrags in einer Zeile, z. B. für die Freigabe.
// Ein laufender Eintrag hat statt des Endes ohneEnde („läuft“ oder
// „unvollständig“).
export function tagUndZeit(beginn: string, ende: string | null, ohneEnde: string): string {
  const von = Date.parse(beginn);
  const bis = ende === null ? ohneEnde : uhrzeit.format(Date.parse(ende));
  return `${tagesTitel.format(von)}, ${texte.erfassung.vonBis(uhrzeit.format(von), bis)}`;
}

const datumMitJahr = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export type Spalten = { datum: string; arbeitszeit: string; dauer: string };

// Ein Eintrag für die Spalten Datum, Arbeitszeit und Dauer in der
// Übersicht im Büro. Ein laufender Eintrag hat statt des Endes ohneEnde
// („läuft“ oder „unvollständig“) und keine Dauer.
export function spalten(beginn: string, ende: string | null, ohneEnde: string): Spalten {
  const von = Date.parse(beginn);
  const datum = datumMitJahr.format(von);
  if (ende === null) {
    return { datum, arbeitszeit: texte.erfassung.vonBis(uhrzeit.format(von), ohneEnde), dauer: "" };
  }
  const bis = Date.parse(ende);
  const arbeitszeit = texte.erfassung.vonBis(uhrzeit.format(von), uhrzeit.format(bis));
  // An wie vielen Kalendertagen in Berlin nach dem Beginn noch gearbeitet
  // wurde. Ein Ende um genau 00:00 zählt nicht als weiterer Tag.
  const folgetage = aufBerlinerTageVerteilt(von, bis).length - 1;
  return {
    datum,
    arbeitszeit:
      folgetage > 0 ? `${arbeitszeit} ${texte.zeiteintraege.folgetage(folgetage)}` : arbeitszeit,
    dauer: texte.zeiteintraege.stunden(stundenAlsText(Math.round((bis - von) / 60_000))),
  };
}

// Was und wo in einer Zeile: die Fahrt oder Objekt und Tätigkeit, dazu
// gegebenenfalls der Zusatzauftrag.
export function wasUndWo(
  eintrag: Pick<
    MeinZeiteintrag,
    "art" | "objekt_bezeichnung" | "taetigkeit_name" | "zusatzauftrag_beschreibung"
  >,
): string {
  if (eintrag.art === "fahrt") return texte.erfassung.fahrt;
  const was = `${eintrag.objekt_bezeichnung} · ${eintrag.taetigkeit_name}`;
  if (eintrag.zusatzauftrag_beschreibung === null) return was;
  return `${was} · ${texte.erfassung.zusatzauftragText(eintrag.zusatzauftrag_beschreibung)}`;
}

// Wer den Eintrag für den Mitarbeiter angelegt hat, oder null, wenn er es
// selbst war. Am Handy soll nicht unter jedem Eintrag der eigene Name
// stehen.
export function angelegtVon(
  eintrag: Pick<MeinZeiteintrag, "angelegt_von" | "angelegt_von_name">,
  mitarbeiterId: string,
): string | null {
  if (eintrag.angelegt_von === mitarbeiterId) return null;
  return texte.erfassung.angelegtVon(eintrag.angelegt_von_name ?? texte.protokoll.unbekannt);
}
