"use server";

import { refresh } from "next/cache";
import { alsBuero } from "@/lib/als-buero";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { zusatzauftragAusFormular } from "@/lib/zeiterfassung/eingabe";
import { ladeZeiteintragZumAendern } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";

// Ordnet einen nicht abgerechneten Zeiteintrag beim Prüfen einem anderen
// Zusatzauftrag seines Objekts zu oder entfernt die Zuordnung (leerer
// Wert). Das Büro darf dabei auch erledigte Zusatzaufträge wählen; ob der
// Zusatzauftrag zum Objekt gehört und noch nicht abgerechnet ist, prüft die
// Datenbank. Die Änderung steht im Änderungsprotokoll des Eintrags.
export async function zuordnungAendern(
  id: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const eintrag = await ladeZeiteintragZumAendern(supabase, id);
  if (!eintrag || eintrag.art !== "taetigkeit") return FEHLER(texte.zeiteintraege.nichtGefunden);
  if (eintrag.abgerechnet) return FEHLER(texte.abrechnung.gesperrt);

  const zusatzauftrag = zusatzauftragAusFormular(formData);
  if (!zusatzauftrag.ok) return FEHLER(zusatzauftrag.fehler);

  const { data, error } = await supabase
    .from("zeiteintrag")
    .update({ zusatzauftrag_id: zusatzauftrag.zusatzauftrag_id })
    .eq("id", id)
    .select("id");
  refresh();
  if (error) {
    // Abgerechnet, fremdes Objekt oder Zusatzauftrag inzwischen abgerechnet.
    console.error("Zuordnung ändern fehlgeschlagen", error);
    return FEHLER(texte.zusatzauftraege.fehlerNichtZurAuswahl);
  }
  if (data.length === 0) return FEHLER(texte.zeiteintraege.nichtGefunden);
  return OK(texte.zusatzauftraege.zuordnungGespeichert);
}
