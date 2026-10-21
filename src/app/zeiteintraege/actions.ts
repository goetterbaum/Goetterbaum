"use server";

import { refresh } from "next/cache";
import { alsBuero } from "@/lib/als-buero";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { gewaehlterZusatzauftrag } from "@/lib/zeiterfassung/eingabe";
import { ladeZeiteintragZumAendern } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";

// Fehlercodes von Postgres
const PRUEFREGEL_VERLETZT = "23514";
const FREMDSCHLUESSEL_VERLETZT = "23503";

// Ändert oder entfernt beim Prüfen den Zusatzauftrag eines Zeiteintrags,
// auch eines freigegebenen. Nur das Büro, und nur solange er nicht
// abgerechnet ist; die Datenbank sperrt abgerechnete ohnehin. Dass nur ein
// offener Zusatzauftrag desselben Objekts neu zugeordnet wird, prüft die
// Datenbank, und sie schreibt die Änderung ins Änderungsprotokoll.
export async function zusatzauftragZuordnen(
  id: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const bisher = await ladeZeiteintragZumAendern(supabase, id);
  if (!bisher || bisher.art !== "taetigkeit") return FEHLER(texte.zeiteintraege.nichtGefunden);
  if (bisher.abgerechnet) return FEHLER(texte.abrechnung.gesperrt);

  const zusatzauftrag_id = gewaehlterZusatzauftrag(formData);
  if (zusatzauftrag_id === false) return FEHLER(texte.erfassung.fehlerZusatzauftrag);

  const { data, error } = await supabase
    .from("zeiteintrag")
    .update({ zusatzauftrag_id })
    .eq("id", id)
    .is("abgerechnet_in", null)
    .select("id");
  if (error) {
    refresh();
    if (error.code === PRUEFREGEL_VERLETZT || error.code === FREMDSCHLUESSEL_VERLETZT) {
      return FEHLER(texte.erfassung.fehlerNichtZurAuswahl);
    }
    console.error("Zusatzauftrag zuordnen fehlgeschlagen", error);
    return FEHLER(texte.zeiteintraege.fehlerZusatzauftragNichtGespeichert);
  }

  refresh();
  if (data.length === 0) return FEHLER(texte.abrechnung.gesperrt);
  return OK(texte.zeiteintraege.zusatzauftragGespeichert);
}
