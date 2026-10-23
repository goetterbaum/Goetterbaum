import type { NextRequest } from "next/server";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { csvDatei } from "@/lib/csv";
import { stundennachweisCsv } from "@/lib/rechnungsvorbereitung/stundennachweis";
import { ladeRechnungsvorbereitungAusAdresse } from "@/lib/rechnungsvorbereitung/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";

// Der Stundennachweis zur Rechnungsvorbereitung von Kunde und Monat aus
// der Adresszeile, als CSV-Datei. Entsteht nur, wenn das Büro ihn
// ausdrücklich herunterlädt. Nur fürs Büro; die Daten schützen zusätzlich
// die Zugriffsregeln der Datenbank.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich || ich.rolle !== "buero") {
    return new Response(texte.rechnungsvorbereitung.keineBerechtigung, { status: 403 });
  }

  const parameter = Object.fromEntries(request.nextUrl.searchParams);
  const geladen = await ladeRechnungsvorbereitungAusAdresse(supabase, ich.firma_id, parameter);
  if (!geladen) {
    return new Response(texte.rechnungsvorbereitung.kundeNichtGefunden, { status: 404 });
  }

  return csvDatei(
    stundennachweisCsv(geladen.ergebnis.stundennachweis, geladen.namen),
    texte.stundennachweis.dateiname(geladen.kunde.name, geladen.zeitraum.ersterMonat),
    "Stundennachweis.csv",
  );
}
