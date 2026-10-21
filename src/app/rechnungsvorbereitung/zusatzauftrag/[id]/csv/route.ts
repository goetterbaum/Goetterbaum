import type { NextRequest } from "next/server";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { rechnungsCsv } from "@/lib/rechnungsvorbereitung/csv";
import { ladeRechnungsvorbereitungFuerZusatzauftrag } from "@/lib/rechnungsvorbereitung/verwaltung";
import { rechnungsZeilen } from "@/lib/rechnungsvorbereitung/zeilen";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";

// Die Rechnungsvorbereitung für einen einzelnen Zusatzauftrag als
// CSV-Datei, mit denselben Positionen wie die Seite. Nur fürs Büro; die
// Daten schützen zusätzlich die Zugriffsregeln der Datenbank.
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/rechnungsvorbereitung/zusatzauftrag/[id]/csv">,
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

  const csv = rechnungsCsv(rechnungsZeilen(geladen.ergebnis, geladen.namen));
  const dateiname = texte.rechnungsvorbereitung
    .csvDateinameEinzeln(geladen.kunde.name, geladen.zusatzauftrag.beschreibung)
    // Zeichen, die in Dateinamen stören, werden ersetzt.
    .replace(/[\/:*?"<>|\r\n]/g, "_");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Ältere Programme lesen nur den einfachen Namen, die anderen den
      // vollständigen mit Umlauten.
      "Content-Disposition": `attachment; filename="Rechnungsvorbereitung.csv"; filename*=UTF-8''${encodeURIComponent(dateiname)}`,
      "Cache-Control": "no-store",
    },
  });
}
