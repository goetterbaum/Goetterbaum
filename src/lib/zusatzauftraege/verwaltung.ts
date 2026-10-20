import type { SupabaseClient } from "@supabase/supabase-js";
import { istId } from "@/lib/id";
import type { ZusatzauftragDaten } from "./eingabe";

export type Zusatzauftrag = ZusatzauftragDaten & {
  id: string;
  objekt_id: string;
  erledigt: boolean;
};

export type ZusatzauftragMitObjekt = Zusatzauftrag & {
  objekt: { bezeichnung: string; archiviert: boolean };
};

const SPALTEN = "id, objekt_id, beschreibung, abrechnungsart, festbetrag_cent, erledigt";

// Alle Zusatzaufträge eines Objekts, die offenen zuerst. Welche der Nutzer
// sehen darf, entscheiden die Zugriffsregeln der Datenbank (nur das Büro
// der eigenen Firma).
export async function ladeZusatzauftraegeDesObjekts(
  supabase: SupabaseClient,
  objektId: string,
): Promise<Zusatzauftrag[]> {
  const { data, error } = await supabase
    .from("zusatzauftrag")
    .select(SPALTEN)
    .eq("objekt_id", objektId)
    .order("erledigt")
    .order("angelegt_am")
    .returns<Zusatzauftrag[]>();
  if (error) throw error;
  return data;
}

// Ein Zusatzauftrag mit seinem Objekt, oder null, wenn es ihn nicht gibt
// oder der Nutzer ihn nicht sehen darf.
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
