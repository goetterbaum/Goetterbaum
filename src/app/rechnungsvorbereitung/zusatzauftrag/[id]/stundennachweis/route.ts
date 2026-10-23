import type { NextRequest } from "next/server";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { csvDatei } from "@/lib/csv";
import { stundennachweisCsv } from "@/lib/rechnungsvorbereitung/stundennachweis";
import { ladeRechnungsvorbereitungFuerZusatzauftrag } from "@/lib/rechnungsvorbereitung/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";

// Der Stundennachweis zur Rechnungsvorbereitung eines einzelnen
// Zusatzauftrags als CSV-Datei. Entsteht nur, wenn das Büro ihn
// ausdrücklich herunterlädt. Nur fürs Büro; die Daten schützen zusätzlich
// die Zugriffsregeln der Datenbank.
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/rechnungsvorbereitung/zusatzauftrag/[id]/stundennachweis">,
) {
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich || ich.rolle !== "buero") {
    return new Response(texte.rechnungsvorbereitung.keineBerechtigung, { status: 403 });
  }

  const { id } = await params;
  const geladen = await ladeRechnungsvorbereitungFuerZusatzauftrag(supabase, ich.firma_id, id);
  if (!geladen) {
    return new Response(texte.zusatzauftraege.nichtGefunden, { status: 404 });
  }

  return csvDatei(
    stundennachweisCsv(geladen.ergebnis.stundennachweis, geladen.namen),
    texte.stundennachweis.dateiname(geladen.kunde.name, geladen.zusatzauftrag.beschreibung),
    "Stundennachweis.csv",
  );
}
