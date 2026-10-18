"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { alsBuero } from "@/lib/als-buero";
import { ladeObjekt } from "@/lib/objekte/verwaltung";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { pruefeZusatzauftragEingabe } from "@/lib/zusatzauftraege/eingabe";
import { ladeZusatzauftrag } from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";

// Fehlercode der Datenbank, wenn ein abgerechneter Zusatzauftrag geändert
// werden soll oder seine Abrechnungsart, obwohl schon Zeit für ihn
// abgerechnet ist (siehe Migration zu Zusatzaufträgen).
const PRUEFREGEL_VERLETZT = "23514";

function fehlerBeimSpeichern(error: PostgrestError, was: string): Rueckmeldung {
  if (error.code === PRUEFREGEL_VERLETZT) return FEHLER(texte.zusatzauftraege.fehlerGesperrt);
  console.error(`Zusatzauftrag ${was} fehlgeschlagen`, error);
  return FEHLER(texte.stammdaten.fehlerUnbekannt);
}

// Legt zu einem aktiven Objekt einen offenen Zusatzauftrag an.
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
  if (error) return fehlerBeimSpeichern(error, "anlegen");

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
  if (bestand.abgerechnet_in !== null) return FEHLER(texte.zusatzauftraege.abgerechnetHinweis);

  const eingabe = pruefeZusatzauftragEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { error } = await supabase.from("zusatzauftrag").update(eingabe.daten).eq("id", id);
  if (error) return fehlerBeimSpeichern(error, "speichern");

  refresh();
  return OK(texte.stammdaten.gespeichert);
}

// Markiert einen Zusatzauftrag als erledigt oder öffnet ihn wieder,
// solange er nicht abgerechnet ist.
export async function zusatzauftragErledigt(id: string, erledigt: boolean): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const bestand = await ladeZusatzauftrag(supabase, id);
  if (!bestand) return FEHLER(texte.zusatzauftraege.nichtGefunden);
  if (bestand.abgerechnet_in !== null) return FEHLER(texte.zusatzauftraege.abgerechnetHinweis);

  const { error } = await supabase.from("zusatzauftrag").update({ erledigt }).eq("id", id);
  if (error) return fehlerBeimSpeichern(error, "als erledigt markieren");

  refresh();
  return OK();
}
