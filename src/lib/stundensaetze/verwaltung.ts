import type { SupabaseClient } from "@supabase/supabase-js";
import type { StundensatzDaten } from "./eingabe";

// Die abweichenden Stundensätze eines Kunden. Welche der Nutzer sehen
// darf, entscheiden die Zugriffsregeln der Datenbank (nur das Büro der
// eigenen Firma).
export async function ladeKundenStundensaetze(
  supabase: SupabaseClient,
  kundeId: string,
): Promise<StundensatzDaten[]> {
  const { data, error } = await supabase
    .from("kunden_stundensatz")
    .select("taetigkeit_id, stundensatz_cent")
    .eq("kunde_id", kundeId)
    .returns<StundensatzDaten[]>();
  if (error) throw error;
  return data;
}

export type ObjektStundensatzDaten = StundensatzDaten & { objekt_id: string };

// Die abweichenden Stundensätze der Objekte. Auch hier entscheiden die
// Zugriffsregeln der Datenbank, was der Nutzer sieht (nur das Büro der
// eigenen Firma).
export async function ladeObjektStundensaetze(
  supabase: SupabaseClient,
  objektIds: string[],
): Promise<ObjektStundensatzDaten[]> {
  if (objektIds.length === 0) return [];
  const { data, error } = await supabase
    .from("objekt_stundensatz")
    .select("objekt_id, taetigkeit_id, stundensatz_cent")
    .in("objekt_id", objektIds)
    .returns<ObjektStundensatzDaten[]>();
  if (error) throw error;
  return data;
}
