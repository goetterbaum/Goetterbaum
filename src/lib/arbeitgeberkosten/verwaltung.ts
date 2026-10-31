import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArbeitgeberkostenDaten } from "./eingabe";
import type { Arbeitgeberkosten } from "./regeln";

export type ArbeitgeberkostenWert = ArbeitgeberkostenDaten & { id: string };

// Wem ein Wert gehört: der Firma als Standard (mitarbeiterId null) oder
// einem Mitarbeiter als eigener Wert.
export type Ziel = { mitarbeiterId: string | null };

export function tabelleFuer(ziel: Ziel) {
  return ziel.mitarbeiterId === null
    ? "arbeitgeberkosten_standard"
    : "arbeitgeberkosten_mitarbeiter";
}

// Der Verlauf, der späteste Wert zuerst. Was der Nutzer sehen darf,
// entscheiden die Zugriffsregeln der Datenbank (nur das Büro der eigenen
// Firma); für alle anderen ist er leer.
export async function ladeArbeitgeberkosten(
  supabase: SupabaseClient,
  ziel: Ziel,
): Promise<ArbeitgeberkostenWert[]> {
  let abfrage = supabase
    .from(tabelleFuer(ziel))
    .select("id, gueltig_ab, kosten_je_stunde_cent")
    .order("gueltig_ab", { ascending: false });
  if (ziel.mitarbeiterId !== null) abfrage = abfrage.eq("mitarbeiter_id", ziel.mitarbeiterId);
  const { data, error } = await abfrage.returns<ArbeitgeberkostenWert[]>();
  if (error) throw error;
  return data;
}

// Ein Verlauf so, wie ihn die Regel „welcher Wert gilt“ braucht.
export function alsVerlauf(werte: ArbeitgeberkostenWert[]): Arbeitgeberkosten[] {
  return werte.map((w) => ({ gueltigAb: w.gueltig_ab, centJeStunde: w.kosten_je_stunde_cent }));
}
