import { istId } from "@/lib/id";
import { texte } from "@/texte";

// Die Angaben beim Start eines Zeiteintrags für eine Tätigkeit in einem
// Objekt, wie sie in die Tabelle zeiteintrag gehen. Beginn und Ende setzt
// die Datenbank selbst.
export type StartDaten = {
  art: "taetigkeit";
  objekt_id: string;
  taetigkeit_id: string;
  // Leer bei regulärer Arbeit.
  zusatzauftrag_id: string | null;
};

export type StartErgebnis = { ok: true; daten: StartDaten } | { ok: false; fehler: string };

// Der freiwillig gewählte Zusatzauftrag (Feld "zusatzauftrag"): null ohne
// Auswahl, die Kennung oder false, wenn der Wert keine Kennung ist. Ob er
// offen ist und zum Objekt gehört, prüft die Datenbank.
export function gewaehlterZusatzauftrag(formData: FormData): string | null | false {
  const wert = String(formData.get("zusatzauftrag") ?? "").trim();
  if (!wert) return null;
  return istId(wert) ? wert : false;
}

// Prüft die Angaben aus dem Start-Formular. Ob Objekt und Tätigkeit aktiv
// sind und zur eigenen Firma gehören, prüft die Datenbank.
export function pruefeStartEingabe(formData: FormData): StartErgebnis {
  const feld = (name: string) => String(formData.get(name) ?? "").trim();
  const objekt_id = feld("objekt");
  const taetigkeit_id = feld("taetigkeit");
  const zusatzauftrag_id = gewaehlterZusatzauftrag(formData);

  if (!istId(objekt_id)) return { ok: false, fehler: texte.erfassung.fehlerObjekt };
  if (!istId(taetigkeit_id)) return { ok: false, fehler: texte.erfassung.fehlerTaetigkeit };
  if (zusatzauftrag_id === false) {
    return { ok: false, fehler: texte.erfassung.fehlerZusatzauftrag };
  }

  return { ok: true, daten: { art: "taetigkeit", objekt_id, taetigkeit_id, zusatzauftrag_id } };
}
