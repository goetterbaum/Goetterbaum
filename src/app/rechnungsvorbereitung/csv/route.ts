import type { NextRequest } from "next/server";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { rechnungsCsv } from "@/lib/rechnungsvorbereitung/csv";
import {
  ladeEinzelabrechnung,
  ladeRechnungsvorbereitungAusAdresse,
} from "@/lib/rechnungsvorbereitung/verwaltung";
import { rechnungsZeilen } from "@/lib/rechnungsvorbereitung/zeilen";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";

// Die Rechnungsvorbereitung zu Kunde und Monat aus der Adresszeile (oder
// die Einzelabrechnung eines Zusatzauftrags, ?zusatzauftrag=…) als
// CSV-Datei, mit denselben Positionen wie die Seite. Nur fürs Büro; die
// Daten schützen zusätzlich die Zugriffsregeln der Datenbank.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich || ich.rolle !== "buero") {
    return new Response(texte.rechnungsvorbereitung.keineBerechtigung, { status: 403 });
  }

  const t = texte.rechnungsvorbereitung;
  const parameter = Object.fromEntries(request.nextUrl.searchParams);
  let csv: string;
  let dateiname: string;
  if (parameter.zusatzauftrag !== undefined) {
    const einzel = await ladeEinzelabrechnung(supabase, ich.firma_id, parameter.zusatzauftrag);
    if (!einzel) return new Response(t.fehlerEinzelnNichtGefunden, { status: 404 });
    csv = rechnungsCsv(rechnungsZeilen(einzel.ergebnis, einzel.namen));
    dateiname = t.csvDateinameZusatzauftrag(einzel.kunde.name, einzel.zusatzauftrag.beschreibung);
  } else {
    const geladen = await ladeRechnungsvorbereitungAusAdresse(supabase, ich.firma_id, parameter);
    if (!geladen) return new Response(t.kundeNichtGefunden, { status: 404 });
    csv = rechnungsCsv(rechnungsZeilen(geladen.ergebnis, geladen.namen));
    dateiname = t.csvDateiname(geladen.kunde.name, geladen.zeitraum.ersterMonat);
  }
  // Zeichen, die in Dateinamen stören, werden ersetzt.
  dateiname = dateiname.replace(/[\/:*?"<>|\r\n]/g, "_");
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
