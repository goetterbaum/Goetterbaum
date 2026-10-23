import type { NextRequest } from "next/server";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { arbeitszeitnachweisCsv } from "@/lib/auswertungen/arbeitszeitnachweis";
import { ladeArbeitszeitnachweis } from "@/lib/auswertungen/verwaltung";
import { csvDatei } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";

// Der Arbeitszeitnachweis zu Mitarbeiter und Zeitraum aus der Adresszeile
// als CSV-Datei, mit denselben Zeilen wie die Seite. Nur fürs Büro; die
// Daten schützt zusätzlich die Datenbank.
export async function GET(request: NextRequest) {
  const t = texte.arbeitszeitnachweis;
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich || ich.rolle !== "buero") {
    return new Response(t.keineBerechtigung, { status: 403 });
  }

  const parameter = Object.fromEntries(request.nextUrl.searchParams);
  const geladen = await ladeArbeitszeitnachweis(supabase, parameter);
  if (!geladen) return new Response(t.mitarbeiterNichtGefunden, { status: 404 });

  const { mitarbeiter, zeitraum } = geladen;
  return csvDatei(
    arbeitszeitnachweisCsv(geladen.nachweis),
    t.csvDateiname(mitarbeiter.name, zeitraum.von, zeitraum.bis),
    "Arbeitszeitnachweis.csv",
  );
}
