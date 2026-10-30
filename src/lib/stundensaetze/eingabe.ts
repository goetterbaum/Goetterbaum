import { euroInCent, HOECHSTER_BETRAG_CENT } from "@/lib/geld";
import { istId } from "@/lib/id";
import { texte } from "@/texte";

// Liest einen Stundensatz, wie ihn das Büro eintippt, z. B. „32,50“.
// Liefert ihn in Cent oder null, wenn er kein gültiger Betrag über 0 € ist.
export function stundensatzInCent(eingabe: string): number | null {
  const cent = euroInCent(eingabe);
  if (!cent || cent > HOECHSTER_BETRAG_CENT) return null;
  return cent;
}

// Ein abweichender Stundensatz eines Kunden oder Objekts für eine
// Tätigkeit, wie er in kunden_stundensatz bzw. objekt_stundensatz steht
// (ohne Kunde bzw. Objekt, das kommt aus der Seite).
export type StundensatzDaten = {
  taetigkeit_id: string;
  stundensatz_cent: number;
};

export type EingabeErgebnis = { ok: true; daten: StundensatzDaten } | { ok: false; fehler: string };

// Prüft die Angaben aus dem Formular beim Kunden oder Objekt. Ob die
// Tätigkeit zur Firma gehört, prüfen die Server-Aktion und die Datenbank.
export function pruefeStundensatzEingabe(formData: FormData): EingabeErgebnis {
  const taetigkeit_id = String(formData.get("taetigkeit_id") ?? "").trim();
  if (!istId(taetigkeit_id)) {
    return { ok: false, fehler: texte.stundensaetze.fehlerTaetigkeit };
  }
  const stundensatz_cent = stundensatzInCent(String(formData.get("stundensatz") ?? ""));
  if (!stundensatz_cent) {
    return { ok: false, fehler: texte.stundensaetze.fehlerStundensatz };
  }
  return { ok: true, daten: { taetigkeit_id, stundensatz_cent } };
}
