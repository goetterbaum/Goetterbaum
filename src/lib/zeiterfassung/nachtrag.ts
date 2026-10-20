import { berlinerZeitpunkt } from "@/lib/berliner-zeit";
import { istId } from "@/lib/id";
import { texte } from "@/texte";
import type { ZeiteintragArt } from "./anzeige";
import { gewaehlterZusatzauftrag } from "./eingabe";

// Die Angaben eines Nachtrags, wie sie in die Tabelle zeiteintrag gehen.
// Dass er als Nachtrag markiert wird, erledigt die Datenbank selbst.
export type NachtragDaten = {
  art: ZeiteintragArt;
  objekt_id: string | null;
  taetigkeit_id: string | null;
  // Leer bei regulärer Arbeit und bei Fahrten.
  zusatzauftrag_id: string | null;
  // Zeitpunkte als ISO-Text
  beginn: string;
  ende: string;
};

export type NachtragErgebnis = { ok: true; daten: NachtragDaten } | { ok: false; fehler: string };

const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

export function istDatum(wert: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wert)) return false;
  // Ein Tag wie der 30.02. würde sonst still zum 02.03.
  return new Date(`${wert}T00:00:00Z`).toISOString().slice(0, 10) === wert;
}

// Der gespeicherte Zeitpunkt, wenn er in derselben Minute liegt wie der
// eingegebene, sonst der eingegebene.
function gleicheMinuteWie(eingegeben: number, gespeichert: string | undefined): number {
  if (gespeichert === undefined) return eingegeben;
  const genau = Date.parse(gespeichert);
  return Math.floor(genau / 60_000) * 60_000 === eingegeben ? genau : eingegeben;
}

// Prüft die Angaben aus dem Nachtrag-Formular: Art, bei einer Tätigkeit
// Objekt, Tätigkeit und den freiwilligen Zusatzauftrag, dazu Datum und
// von–bis in Berliner Zeit an diesem Tag. jetzt ist der aktuelle
// Zeitpunkt (ms seit 1970). Beim Ändern ist bisher der gespeicherte
// Eintrag: Bleibt eine Uhrzeit im Formular gleich, bleibt auch der
// gespeicherte, sekundengenaue Zeitpunkt. Sonst würde jede Änderung eines
// Live-Eintrags dessen Zeiten auf Minuten kürzen und ihn zum Nachtrag
// machen. Ob Objekt, Tätigkeit und Zusatzauftrag zur Auswahl stehen und ob
// sich der Eintrag mit einem anderen überschneidet, prüft die Datenbank.
export function pruefeNachtragEingabe(
  formData: FormData,
  jetzt: number,
  bisher?: { beginn: string; ende: string },
): NachtragErgebnis {
  const feld = (name: string) => String(formData.get(name) ?? "").trim();
  const t = texte.nachtrag;
  const art = feld("art");

  let objekt_id: string | null = null;
  let taetigkeit_id: string | null = null;
  let zusatzauftrag_id: string | null = null;
  if (art === "taetigkeit") {
    objekt_id = feld("objekt");
    taetigkeit_id = feld("taetigkeit");
    if (!istId(objekt_id)) return { ok: false, fehler: texte.erfassung.fehlerObjekt };
    if (!istId(taetigkeit_id)) return { ok: false, fehler: texte.erfassung.fehlerTaetigkeit };
    const zusatzauftrag = gewaehlterZusatzauftrag(formData);
    if (zusatzauftrag === false) return { ok: false, fehler: texte.erfassung.fehlerZusatzauftrag };
    zusatzauftrag_id = zusatzauftrag;
  } else if (art !== "fahrt") {
    return { ok: false, fehler: t.fehlerArt };
  }

  const datum = feld("datum");
  const von = feld("von");
  const bis = feld("bis");
  if (!istDatum(datum)) return { ok: false, fehler: t.fehlerDatum };
  if (!UHRZEIT.test(von) || !UHRZEIT.test(bis)) return { ok: false, fehler: t.fehlerUhrzeit };

  const beginn = gleicheMinuteWie(berlinerZeitpunkt(datum, von), bisher?.beginn);
  const ende = gleicheMinuteWie(berlinerZeitpunkt(datum, bis), bisher?.ende);
  if (ende <= beginn) return { ok: false, fehler: t.fehlerEndeVorBeginn };
  if (ende > jetzt) return { ok: false, fehler: t.fehlerZukunft };

  return {
    ok: true,
    daten: {
      art,
      objekt_id,
      taetigkeit_id,
      zusatzauftrag_id,
      beginn: new Date(beginn).toISOString(),
      ende: new Date(ende).toISOString(),
    },
  };
}

export type EndeErgebnis = { ok: true; ende: string } | { ok: false; fehler: string };

// Prüft das nachgetragene Ende eines unvollständigen Eintrags: Datum und
// Uhrzeit in Berlin. Anders als beim Nachtrag darf das Ende an einem
// späteren Tag liegen als der Beginn, denn der Eintrag lief schon über
// Mitternacht. beginn ist der gespeicherte Beginn, jetzt der aktuelle
// Zeitpunkt (ms seit 1970).
export function pruefeEndeEingabe(formData: FormData, jetzt: number, beginn: string): EndeErgebnis {
  const feld = (name: string) => String(formData.get(name) ?? "").trim();
  const t = texte.nachtrag;
  const datum = feld("datum");
  const bis = feld("bis");
  if (!istDatum(datum)) return { ok: false, fehler: t.fehlerDatum };
  if (!UHRZEIT.test(bis)) return { ok: false, fehler: t.fehlerUhrzeitEnde };

  const ende = berlinerZeitpunkt(datum, bis);
  if (ende <= Date.parse(beginn)) return { ok: false, fehler: t.fehlerEndeNachBeginn };
  if (ende > jetzt) return { ok: false, fehler: t.fehlerZukunft };
  return { ok: true, ende: new Date(ende).toISOString() };
}
