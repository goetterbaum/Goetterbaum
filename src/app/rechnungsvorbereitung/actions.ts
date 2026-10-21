"use server";

import { refresh } from "next/cache";
import { alsBuero } from "@/lib/als-buero";
import { istId } from "@/lib/id";
import { abrechnungsStand, abrechnungsUmfang } from "@/lib/rechnungsvorbereitung/abrechnung";
import {
  ladeRechnungsvorbereitungAusAdresse,
  ladeRechnungsvorbereitungFuerZusatzauftrag,
} from "@/lib/rechnungsvorbereitung/verwaltung";
import { ersterTag } from "@/lib/rechnungsvorbereitung/zeitraum";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { texte } from "@/texte";

// Markiert die Rechnungsvorbereitung zu Kunde und Monat als abgerechnet.
// Sie wird dafür neu berechnet; stand ist der Fingerabdruck dessen, was
// das Büro gesehen hat. Hat sich seitdem etwas geändert, wird nichts
// markiert. Was zum Kunden gehört und noch offen ist, prüft zusätzlich die
// Datenbank.
export async function alsAbgerechnetMarkieren(
  kundeId: string,
  monat: string,
  stand: string,
): Promise<Rueckmeldung> {
  const t = texte.rechnungsvorbereitung;
  const { supabase, ich } = await alsBuero();
  const geladen = await ladeRechnungsvorbereitungAusAdresse(supabase, ich.firma_id, {
    kunde: kundeId,
    monat,
  });
  if (!geladen) return FEHLER(t.kundeNichtGefunden);
  if (abrechnungsStand(geladen.ergebnis) !== stand) {
    refresh();
    return FEHLER(t.fehlerVeraendert);
  }
  const umfang = abrechnungsUmfang(geladen.ergebnis);
  if (!umfang) return FEHLER(t.keinePositionen);

  const { error } = await supabase.rpc("als_abgerechnet_markieren", {
    fuer_kunde: geladen.kunde.id,
    ab_monat: ersterTag(geladen.zeitraum.ersterMonat),
    eintraege: umfang.zeiteintragIds,
    monate: umfang.pauschalMonate,
    aufstellung: umfang.positionen,
    summe: umfang.summeCent,
    zusatzauftraege: umfang.zusatzauftragIds,
  });
  refresh();
  if (error) {
    console.error("Als abgerechnet markieren fehlgeschlagen", error);
    return FEHLER(t.fehlerMarkieren);
  }
  return OK(t.markiert);
}

// Rechnet einen erledigten Zusatzauftrag einzeln ab, mit seiner
// freigegebenen, noch offenen Zeit aus allen Monaten. Wie beim Markieren
// oben ist stand der Fingerabdruck dessen, was das Büro gesehen hat; dass
// der Zusatzauftrag erledigt und noch offen ist und keine Zeit fehlt,
// prüft zusätzlich die Datenbank.
export async function zusatzauftragEinzelnAbrechnen(
  zusatzauftragId: string,
  stand: string,
): Promise<Rueckmeldung> {
  const t = texte.rechnungsvorbereitung;
  const { supabase, ich } = await alsBuero();
  const geladen = await ladeRechnungsvorbereitungFuerZusatzauftrag(
    supabase,
    ich.firma_id,
    zusatzauftragId,
  );
  if (!geladen) return FEHLER(texte.zusatzauftraege.nichtGefunden);
  if (abrechnungsStand(geladen.ergebnis) !== stand) {
    refresh();
    return FEHLER(t.fehlerVeraendert);
  }
  const umfang = abrechnungsUmfang(geladen.ergebnis);
  if (!umfang) return FEHLER(t.einzelnNichtsAbzurechnen);

  const { error } = await supabase.rpc("zusatzauftrag_einzeln_abrechnen", {
    welcher: geladen.zusatzauftrag.id,
    eintraege: umfang.zeiteintragIds,
    aufstellung: umfang.positionen,
    summe: umfang.summeCent,
  });
  refresh();
  if (error) {
    console.error("Zusatzauftrag einzeln abrechnen fehlgeschlagen", error);
    return FEHLER(t.fehlerMarkieren);
  }
  return OK(t.markiert);
}

// Nimmt eine Abrechnung zurück. Ihre Zeiteinträge, Pauschal-Monate und
// Festbeträge sind danach wieder abrechenbar; jeder Zeiteintrag zeigt das
// im Änderungsprotokoll.
export async function abrechnungZuruecknehmen(id: string): Promise<Rueckmeldung> {
  const t = texte.rechnungsvorbereitung;
  const { supabase } = await alsBuero();
  if (!istId(id)) return FEHLER(t.fehlerZuruecknehmen);

  const { error } = await supabase.rpc("abrechnung_zuruecknehmen", { welche: id });
  refresh();
  if (error) {
    console.error("Abrechnung zurücknehmen fehlgeschlagen", error);
    return FEHLER(t.fehlerZuruecknehmen);
  }
  return OK(t.zurueckgenommen);
}
