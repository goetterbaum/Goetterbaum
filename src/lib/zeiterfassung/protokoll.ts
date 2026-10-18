// Bereitet das Änderungsprotokoll eines Zeiteintrags für das Büro auf:
// wer, wann, was vorher und was nachher. Zeiten gelten in Berlin.
import { texte } from "@/texte";
import { artAlsText, type ZeiteintragArt } from "./anzeige";

// Ein Zeiteintrag, so wie die Datenbank ihn ins Protokoll schreibt (die
// ganze Zeile). Hier zählen nur diese Angaben.
type Stand = {
  art: ZeiteintragArt;
  objekt_id: string | null;
  taetigkeit_id: string | null;
  // Fehlt in Ständen von vor #17.
  zusatzauftrag_id?: string | null;
  beginn: string;
  ende: string | null;
  nachtrag: boolean;
  // Fehlt in Ständen, die vor Einführung der Freigabe protokolliert wurden.
  freigegeben_am?: string | null;
  // Die Abrechnung, die ihn umfasst; fehlt in Ständen von vor #16.
  abgerechnet_in?: string | null;
};

// Eine Zeile, wie sie die Datenbank-Funktion protokoll_zum_zeiteintrag
// liefert. Ohne Name stammt die Änderung nicht von einem Nutzer der App,
// sondern z. B. vom Dienstschlüssel.
export type ProtokollZeile = {
  id: number;
  aktion: "angelegt" | "geaendert";
  geaendert_am: string;
  geaendert_von_name: string | null;
  vorher: Stand | null;
  nachher: Stand;
};

// Namen der Objekte und Tätigkeiten je Kennung, auch archivierte, und
// Beschreibungen der Zusatzaufträge.
export type Namen = {
  objekte: Map<string, string>;
  taetigkeiten: Map<string, string>;
  zusatzauftraege: Map<string, string>;
};

export type Aenderung = { feld: string; vorher: string; nachher: string };

export type AngezeigteProtokollZeile = {
  id: number;
  wann: string;
  wer: string;
  aktion: string;
  aenderungen: Aenderung[];
};

const zeitpunkt = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const LEER = "–";

// Ein Zeitpunkt als Datum und Uhrzeit in Berlin, z. B. "19.10.2026, 09:12".
export function zeitAlsText(wert: string | null): string {
  return wert === null ? LEER : zeitpunkt.format(Date.parse(wert));
}

function nameAlsText(namen: Map<string, string>, id: string | null): string {
  if (id === null) return LEER;
  return namen.get(id) ?? texte.protokoll.unbekannt;
}

// Die angezeigten Felder, in dieser Reihenfolge, jeweils als Text.
function felder(stand: Stand, namen: Namen): [string, string][] {
  const t = texte.protokoll;
  return [
    [t.art, artAlsText(stand.art)],
    [t.objekt, nameAlsText(namen.objekte, stand.objekt_id)],
    [t.taetigkeit, nameAlsText(namen.taetigkeiten, stand.taetigkeit_id)],
    [t.zusatzauftrag, nameAlsText(namen.zusatzauftraege, stand.zusatzauftrag_id ?? null)],
    [t.beginn, zeitAlsText(stand.beginn)],
    [t.ende, zeitAlsText(stand.ende)],
    [t.nachtrag, stand.nachtrag ? t.ja : t.nein],
    [t.freigegeben, zeitAlsText(stand.freigegeben_am ?? null)],
    [t.abgerechnet, stand.abgerechnet_in ? t.ja : t.nein],
  ];
}

// Beim Anlegen alle Angaben, beim Ändern nur die geänderten.
export function protokollAnzeigen(
  zeilen: ProtokollZeile[],
  namen: Namen,
): AngezeigteProtokollZeile[] {
  return zeilen.map((zeile) => {
    const nachher = felder(zeile.nachher, namen);
    const vorher = zeile.vorher ? felder(zeile.vorher, namen) : null;
    const aenderungen = nachher
      .map(([feld, neu], i): Aenderung => ({ feld, vorher: vorher?.[i][1] ?? LEER, nachher: neu }))
      .filter((a, i) => !vorher || vorher[i][1] !== a.nachher);

    return {
      id: zeile.id,
      wann: zeitAlsText(zeile.geaendert_am),
      wer: zeile.geaendert_von_name ?? texte.protokoll.system,
      aktion: texte.protokoll.aktionen[zeile.aktion],
      aenderungen,
    };
  });
}
