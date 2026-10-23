import type { NextRequest } from "next/server";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { csvDatei, rechnungsCsv } from "@/lib/rechnungsvorbereitung/csv";
import { ladeRechnungsvorbereitungAusAdresse } from "@/lib/rechnungsvorbereitung/verwaltung";
import { rechnungsZeilen } from "@/lib/rechnungsvorbereitung/zeilen";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";

// Die Rechnungsvorbereitung zu Kunde und Monat aus der Adresszeile als
// CSV-Datei, mit denselben Positionen wie die Seite. Nur fürs Büro; die
// Daten schützen zusätzlich die Zugriffsregeln der Datenbank.
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
    rechnungsCsv(rechnungsZeilen(geladen.ergebnis, geladen.namen)),
    texte.rechnungsvorbereitung.csvDateiname(geladen.kunde.name, geladen.zeitraum.ersterMonat),
  );
}
