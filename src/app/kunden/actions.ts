"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { alsBuero } from "@/lib/als-buero";
import { istId } from "@/lib/id";
import { pruefeKundenEingabe } from "@/lib/kunden/eingabe";
import { ladeKunde } from "@/lib/kunden/verwaltung";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { pruefeStundensatzEingabe } from "@/lib/stundensaetze/eingabe";
import { ladeTaetigkeit } from "@/lib/taetigkeiten/verwaltung";
import { texte } from "@/texte";

export async function kundeAnlegen(
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase, ich } = await alsBuero();
  const eingabe = pruefeKundenEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { data, error } = await supabase
    .from("kunde")
    .insert({ firma_id: ich.firma_id, ...eingabe.daten })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    console.error("Kunde anlegen fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  redirect(`/kunden/${data.id}`);
}

export async function kundeSpeichern(
  id: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  // Über den eigenen Zugang geladen: Kunden fremder Firmen findet die
  // Datenbank gar nicht erst.
  const bestand = await ladeKunde(supabase, id);
  if (!bestand) return FEHLER(texte.kunden.nichtGefunden);

  const eingabe = pruefeKundenEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { error } = await supabase.from("kunde").update(eingabe.daten).eq("id", id);
  if (error) {
    console.error("Kunde speichern fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK(texte.stammdaten.gespeichert);
}

// Archiviert einen Kunden samt seinen Objekten (das übernimmt die
// Datenbank) oder aktiviert ihn wieder, ohne seine Objekte.
export async function kundeArchivieren(id: string, archiviert: boolean): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const bestand = await ladeKunde(supabase, id);
  if (!bestand) return FEHLER(texte.kunden.nichtGefunden);

  const { error } = await supabase.from("kunde").update({ archiviert }).eq("id", id);
  if (error) {
    console.error("Kunde archivieren fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK();
}

// Es gibt schon einen abweichenden Satz für diesen Kunden und diese
// Tätigkeit (Primärschlüssel, siehe Migration).
const SATZ_GIBT_ES_SCHON = "23505";

// Legt den abweichenden Stundensatz des Kunden für eine Tätigkeit fest
// oder ändert ihn.
export async function stundensatzFestlegen(
  kundeId: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase, ich } = await alsBuero();
  const kunde = await ladeKunde(supabase, kundeId);
  if (!kunde) return FEHLER(texte.kunden.nichtGefunden);

  const eingabe = pruefeStundensatzEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);
  const { taetigkeit_id, stundensatz_cent } = eingabe.daten;
  const taetigkeit = await ladeTaetigkeit(supabase, taetigkeit_id);
  if (!taetigkeit) return FEHLER(texte.stundensaetze.fehlerTaetigkeit);
  if (taetigkeit.archiviert) {
    return FEHLER(texte.stundensaetze.fehlerTaetigkeitArchiviert);
  }

  // Erst ändern, und nur wenn es noch keinen Satz gab, neu anlegen. Ein
  // "upsert" ginge nicht: Das Büro darf Kunde und Tätigkeit eines
  // vorhandenen Satzes nicht ändern.
  const aendern = () =>
    supabase
      .from("kunden_stundensatz")
      .update({ stundensatz_cent })
      .eq("kunde_id", kunde.id)
      .eq("taetigkeit_id", taetigkeit_id)
      .select("taetigkeit_id");
  const geaendert = await aendern();
  let error = geaendert.error;
  if (!error && geaendert.data?.length === 0) {
    ({ error } = await supabase.from("kunden_stundensatz").insert({
      firma_id: ich.firma_id,
      kunde_id: kunde.id,
      taetigkeit_id,
      stundensatz_cent,
    }));
    // Hat jemand den Satz gerade gleichzeitig angelegt (z. B. doppelter
    // Klick), gibt es ihn jetzt: dann einfach ändern.
    if (error?.code === SATZ_GIBT_ES_SCHON) ({ error } = await aendern());
  }
  if (error) {
    console.error("Stundensatz festlegen fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK(texte.stundensaetze.festgelegt);
}

// Entfernt den abweichenden Stundensatz; danach gilt wieder der Standard.
export async function stundensatzEntfernen(
  kundeId: string,
  taetigkeitId: string,
): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const kunde = await ladeKunde(supabase, kundeId);
  if (!kunde) return FEHLER(texte.kunden.nichtGefunden);
  if (!istId(taetigkeitId)) return FEHLER(texte.stundensaetze.fehlerTaetigkeit);

  const { error } = await supabase
    .from("kunden_stundensatz")
    .delete()
    .eq("kunde_id", kunde.id)
    .eq("taetigkeit_id", taetigkeitId);
  if (error) {
    console.error("Stundensatz entfernen fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK();
}
