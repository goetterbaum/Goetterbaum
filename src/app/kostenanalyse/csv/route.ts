import type { NextRequest } from "next/server";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { csvDatei } from "@/lib/csv";
import { ladeKostenanalyse } from "@/lib/kostenanalyse/verwaltung";
import { kostenCsv, uebersichtsZeilen } from "@/lib/kostenanalyse/zeilen";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";

// Die Objektübersicht der Kostenanalyse zum Zeitraum aus der Adresszeile
// als CSV-Datei, mit denselben Zeilen wie die Seite. Nur fürs Büro; die
// Daten schützen zusätzlich die Zugriffsregeln der Datenbank.
export async function GET(request: NextRequest) {
  const t = texte.kostenanalyse;
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich || ich.rolle !== "buero") {
    return new Response(t.keineBerechtigung, { status: 403 });
  }

  const parameter = Object.fromEntries(request.nextUrl.searchParams);
  const { zeitraum, ergebnis, namen } = await ladeKostenanalyse(supabase, ich.firma_id, parameter);
  return csvDatei(
    kostenCsv(uebersichtsZeilen(ergebnis, namen)),
    t.csvDateiname(zeitraum.bezeichnung),
    "Kostenanalyse.csv",
  );
}
