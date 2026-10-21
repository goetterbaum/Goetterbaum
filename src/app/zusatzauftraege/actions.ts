"use server";

import { refresh } from "next/cache";
import { alsBuero } from "@/lib/als-buero";
import { ladeObjekt } from "@/lib/objekte/verwaltung";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { pruefeZusatzauftragEingabe } from "@/lib/zusatzauftraege/eingabe";
import { hatAbgerechneteZeit, ladeZusatzauftrag } from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";

// Legt zu einem Objekt einen offenen Zusatzauftrag an. Archivierte Objekte
// bekommen keine neuen, denn dort erfasst niemand mehr.
export async function zusatzauftragAnlegen(
  objektId: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase, ich } = await alsBuero();
  const objekt = await ladeObjekt(supabase, objektId);
  if (!objekt) return FEHLER(texte.objekte.nichtGefunden);
  if (objekt.archiviert) return FEHLER(texte.zusatzauftraege.objektArchiviert);

  const eingabe = pruefeZusatzauftragEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { error } = await supabase
    .from("zusatzauftrag")
    .insert({ firma_id: ich.firma_id, objekt_id: objekt.id, ...eingabe.daten });
  if (error) {
    console.error("Zusatzauftrag anlegen fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK(texte.zusatzauftraege.angelegt);
}

export async function zusatzauftragSpeichern(
  id: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const bestand = await ladeZusatzauftrag(supabase, id);
  if (!bestand) return FEHLER(texte.zusatzauftraege.nichtGefunden);
  if (bestand.abgerechnet_in) return FEHLER(texte.zusatzauftraege.abgerechnetHinweis);

  const eingabe = pruefeZusatzauftragEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);
  // Die Datenbank lehnt das ohnehin ab; hier nur mit verständlicher Meldung.
  if (
    eingabe.daten.abrechnungsart !== bestand.abrechnungsart &&
    (await hatAbgerechneteZeit(supabase, id))
  ) {
    return FEHLER(texte.zusatzauftraege.fehlerAbrechnungsartFest);
  }

  const { error } = await supabase.from("zusatzauftrag").update(eingabe.daten).eq("id", id);
  if (error) {
    console.error("Zusatzauftrag speichern fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK(texte.stammdaten.gespeichert);
}

// Markiert einen Zusatzauftrag als erledigt oder öffnet ihn wieder.
// Erledigte stehen beim Erfassen nicht mehr zur Auswahl.
export async function zusatzauftragErledigen(id: string, erledigt: boolean): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const bestand = await ladeZusatzauftrag(supabase, id);
  if (!bestand) return FEHLER(texte.zusatzauftraege.nichtGefunden);
  if (bestand.abgerechnet_in) return FEHLER(texte.zusatzauftraege.abgerechnetHinweis);

  const { error } = await supabase.from("zusatzauftrag").update({ erledigt }).eq("id", id);
  if (error) {
    console.error("Zusatzauftrag erledigen fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK();
}
