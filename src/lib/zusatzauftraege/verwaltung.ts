import type { SupabaseClient } from "@supabase/supabase-js";
import { istId } from "@/lib/id";
import type { ZusatzauftragDaten } from "./eingabe";

export type Zusatzauftrag = ZusatzauftragDaten & {
  id: string;
  objekt_id: string;
  erledigt: boolean;
  // Die Abrechnung, die ihn abschließt; dann ist er gesperrt.
  abgerechnet_in: string | null;
};

export type ZusatzauftragStatus = "offen" | "erledigt" | "abgerechnet";

export function zusatzauftragStatus(
  za: Pick<Zusatzauftrag, "erledigt" | "abgerechnet_in">,
): ZusatzauftragStatus {
  if (za.abgerechnet_in !== null) return "abgerechnet";
  return za.erledigt ? "erledigt" : "offen";
}

const SPALTEN =
  "id, objekt_id, beschreibung, abrechnungsart, festbetrag_cent, erledigt, abgerechnet_in";

// Alle Zusatzaufträge eines Objekts, die neuesten zuerst. Lesen darf sie nur
// das Büro der eigenen Firma (Zugriffsregeln der Datenbank).
export async function ladeZusatzauftraegeDesObjekts(
  supabase: SupabaseClient,
  objektId: string,
): Promise<Zusatzauftrag[]> {
  const { data, error } = await supabase
    .from("zusatzauftrag")
    .select(SPALTEN)
    .eq("objekt_id", objektId)
    .order("angelegt_am", { ascending: false })
    .order("id")
    .returns<Zusatzauftrag[]>();
  if (error) throw error;
  return data;
}

export type ZusatzauftragMitObjekt = Zusatzauftrag & {
  objekt: { bezeichnung: string; archiviert: boolean };
};

export async function ladeZusatzauftrag(
  supabase: SupabaseClient,
  id: string,
): Promise<ZusatzauftragMitObjekt | null> {
  if (!istId(id)) return null;
  const { data, error } = await supabase
    .from("zusatzauftrag")
    .select(`${SPALTEN}, objekt(bezeichnung, archiviert)`)
    .eq("id", id)
    .maybeSingle<ZusatzauftragMitObjekt>();
  if (error) throw error;
  return data;
}

// Was beim Start, Nachtrag und Prüfen zur Wahl steht. Preise liefert die
// Datenbank-Funktion bewusst nicht mit.
export type ZusatzauftragZurAuswahl = {
  id: string;
  objekt_id: string;
  beschreibung: string;
  erledigt: boolean;
};

// Die offenen Zusatzaufträge aktiver Objekte der eigenen Firma, für jeden
// Nutzer. dazu: ein weiterer, auch erledigter, z. B. der bisherige eines
// Eintrags, der geändert wird.
export async function ladeZusatzauftraegeZurAuswahl(
  supabase: SupabaseClient,
  dazu: string | null = null,
): Promise<ZusatzauftragZurAuswahl[]> {
  const { data, error } = await supabase.rpc("zusatzauftraege_zur_auswahl", { dazu });
  if (error) throw error;
  return data;
}

// Fürs Büro beim Prüfen: alle noch nicht abgerechneten Zusatzaufträge eines
// Objekts, offene und erledigte.
export async function ladeZuordenbareZusatzauftraege(
  supabase: SupabaseClient,
  objektId: string,
): Promise<ZusatzauftragZurAuswahl[]> {
  const { data, error } = await supabase
    .from("zusatzauftrag")
    .select("id, objekt_id, beschreibung, erledigt")
    .eq("objekt_id", objektId)
    .is("abgerechnet_in", null)
    .order("beschreibung")
    .returns<ZusatzauftragZurAuswahl[]>();
  if (error) throw error;
  return data;
}
