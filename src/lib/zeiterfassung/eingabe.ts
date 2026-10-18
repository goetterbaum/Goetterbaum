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

// Liest den gewählten Zusatzauftrag (Feld "zusatzauftrag"); leer heißt:
// keiner. Ob er offen ist und zum Objekt gehört, prüft die Datenbank.
export function zusatzauftragAusFormular(
  formData: FormData,
): { ok: true; zusatzauftrag_id: string | null } | { ok: false; fehler: string } {
  const wert = String(formData.get("zusatzauftrag") ?? "").trim();
  if (!wert) return { ok: true, zusatzauftrag_id: null };
  if (!istId(wert)) return { ok: false, fehler: texte.zusatzauftraege.fehlerNichtZurAuswahl };
  return { ok: true, zusatzauftrag_id: wert };
}

// Prüft die Angaben aus dem Start-Formular. Ob Objekt, Tätigkeit und
// Zusatzauftrag zur Auswahl stehen und zur eigenen Firma gehören, prüft die
// Datenbank.
export function pruefeStartEingabe(formData: FormData): StartErgebnis {
  const feld = (name: string) => String(formData.get(name) ?? "").trim();
  const objekt_id = feld("objekt");
  const taetigkeit_id = feld("taetigkeit");

  if (!istId(objekt_id)) return { ok: false, fehler: texte.erfassung.fehlerObjekt };
  if (!istId(taetigkeit_id)) return { ok: false, fehler: texte.erfassung.fehlerTaetigkeit };
  const zusatzauftrag = zusatzauftragAusFormular(formData);
  if (!zusatzauftrag.ok) return zusatzauftrag;

  return {
    ok: true,
    daten: {
      art: "taetigkeit",
      objekt_id,
      taetigkeit_id,
      zusatzauftrag_id: zusatzauftrag.zusatzauftrag_id,
    },
  };
}
