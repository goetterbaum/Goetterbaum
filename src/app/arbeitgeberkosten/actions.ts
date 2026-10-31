"use server";

import { refresh } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { pruefeArbeitgeberkostenEingabe } from "@/lib/arbeitgeberkosten/eingabe";
import { tabelleFuer, type Ziel } from "@/lib/arbeitgeberkosten/verwaltung";
import { alsBuero } from "@/lib/als-buero";
import { istId } from "@/lib/id";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { texte } from "@/texte";

// Fügt dem Verlauf (Standard der Firma oder eigener Wert eines
// Mitarbeiters) einen Wert hinzu. Dass der Mitarbeiter zur eigenen Firma
// gehört, prüft die Datenbank.
export async function arbeitgeberkostenHinzufuegen(
  ziel: Ziel,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase, ich } = await alsBuero();
  const eingabe = pruefeArbeitgeberkostenEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { error } = await supabase.from(tabelleFuer(ziel)).insert({
    firma_id: ich.firma_id,
    ...(ziel.mitarbeiterId !== null && { mitarbeiter_id: ziel.mitarbeiterId }),
    ...eingabe.daten,
  });
  if (error) return fehlschlag("Arbeitgeberkosten hinzufügen fehlgeschlagen", error);

  refresh();
  return OK(texte.arbeitgeberkosten.hinzugefuegt);
}

// Ändert „gültig ab“ und Betrag eines Werts, z. B. nach einem Tippfehler.
export async function arbeitgeberkostenAendern(
  ziel: Ziel,
  id: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  if (!istId(id)) return FEHLER(texte.arbeitgeberkosten.fehlerNichtGefunden);
  const eingabe = pruefeArbeitgeberkostenEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { data, error } = await supabase
    .from(tabelleFuer(ziel))
    .update(eingabe.daten)
    .eq("id", id)
    .select("id");
  if (error) return fehlschlag("Arbeitgeberkosten ändern fehlgeschlagen", error);
  if (data.length === 0) return FEHLER(texte.arbeitgeberkosten.fehlerNichtGefunden);

  refresh();
  return OK(texte.arbeitgeberkosten.geaendert);
}

export async function arbeitgeberkostenLoeschen(ziel: Ziel, id: string): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  if (!istId(id)) return FEHLER(texte.arbeitgeberkosten.fehlerNichtGefunden);

  const { data, error } = await supabase.from(tabelleFuer(ziel)).delete().eq("id", id).select("id");
  if (error) return fehlschlag("Arbeitgeberkosten löschen fehlgeschlagen", error);
  if (data.length === 0) return FEHLER(texte.arbeitgeberkosten.fehlerNichtGefunden);

  refresh();
  return OK();
}

function fehlschlag(was: string, error: PostgrestError): Rueckmeldung {
  // Höchstens ein Wert je „gültig ab“ (unique in der Datenbank).
  if (error.code === "23505") return FEHLER(texte.arbeitgeberkosten.fehlerDoppelt);
  console.error(was, error);
  return FEHLER(texte.stammdaten.fehlerUnbekannt);
}
