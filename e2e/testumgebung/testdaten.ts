import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Alles, was ein Testlauf auf Supabase-Staging anlegt. Jeder Lauf bekommt
// eigene Firmen und Zugänge, damit sich parallele Läufe nicht stören.

export type Rolle = "mitarbeiter" | "vorarbeiter" | "buero";

export type TestZugang = {
  // Kennung des Mitarbeiters (nicht des Logins)
  id: string;
  name: string;
  email: string;
  passwort: string;
};

export type TestFirma = {
  id: string;
  name: string;
  buero: TestZugang;
};

export type Testdaten = {
  firmaA: TestFirma & {
    deaktiviert: TestZugang;
    mitarbeiter: TestZugang;
    vorarbeiter: TestZugang;
  };
  firmaB: TestFirma;
};

// Erkennungszeichen aller Test-Firmen. Damit räumt das Aufräumen auch
// Reste abgebrochener Läufe auf.
export const TEST_FIRMA_PRAEFIX = "E2E-Test";

const UMGEBUNGSVARIABLE = "E2E_TESTDATEN";

// Testadressen von Resend: Mails dorthin nimmt Resend an, stellt sie aber
// nirgends zu. So verschicken die Tests nie echte Mails, auch wenn die App
// Einladungen oder "Passwort vergessen"-Links versendet.
export function testEmail() {
  const lauf = process.env.GITHUB_RUN_ID ?? "lokal";
  return `delivered+e2e-${lauf}-${randomUUID().slice(0, 8)}@resend.dev`;
}

function zugangMit(schluessel: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, schluessel, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Zugang mit dem geheimen Dienstschlüssel. Nur Test-Setup und Tests nutzen
// ihn hier, um Testdaten anzulegen und zu prüfen.
export function dienstZugang(): SupabaseClient | null {
  const geheim = process.env.SUPABASE_SECRET_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !geheim) return null;
  return zugangMit(geheim);
}

// Zugang mit dem öffentlichen Schlüssel, so wie ihn jeder Browser hat.
export function oeffentlicherZugang(): SupabaseClient {
  const oeffentlich = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !oeffentlich) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY fehlen.");
  }
  return zugangMit(oeffentlich);
}

// Legt einen Mitarbeiter mit fertigem Login (Passwort gesetzt) an, ohne
// dass eine Mail verschickt wird.
export async function legeZugangAn(
  supabase: SupabaseClient,
  firmaId: string,
  { name, rolle = "buero", aktiv = true }: { name: string; rolle?: Rolle; aktiv?: boolean },
): Promise<TestZugang> {
  const email = testEmail();
  const passwort = randomBytes(18).toString("base64url");

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: passwort,
    email_confirm: true,
  });
  if (error) throw error;

  const { data: mitarbeiter, error: fehler } = await supabase
    .from("mitarbeiter")
    .insert({
      firma_id: firmaId,
      name,
      email,
      rolle,
      aktiv,
      auth_user_id: data.user.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (fehler) {
    // Sonst bliebe ein Login ohne Mitarbeiter zurück, den das Aufräumen
    // nicht mehr findet.
    await supabase.auth.admin.deleteUser(data.user.id);
    throw fehler;
  }

  return { id: mitarbeiter.id, name, email, passwort };
}

export function speichereTestdaten(daten: Testdaten) {
  process.env[UMGEBUNGSVARIABLE] = JSON.stringify(daten);
}

export function ladeTestdaten(): Testdaten | null {
  const roh = process.env[UMGEBUNGSVARIABLE];
  return roh ? (JSON.parse(roh) as Testdaten) : null;
}

const TEST_ADRESSE = { strasse: "Ringstraße 1", plz: "50667", ort: "Köln" };

// Legt einen Kunden mit einem Pauschal-Objekt an, ohne über die App zu
// gehen.
export async function legeKundeMitObjektAn(supabase: SupabaseClient, firmaId: string) {
  const { data: kunde, error } = await supabase
    .from("kunde")
    .insert({
      firma_id: firmaId,
      name: `Kunde ${randomUUID().slice(0, 8)}`,
      ...TEST_ADRESSE,
      abrechnungszeitraum: "monatlich",
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;

  const { data: objekt, error: fehler } = await supabase
    .from("objekt")
    .insert({
      firma_id: firmaId,
      kunde_id: kunde.id,
      bezeichnung: `Objekt ${randomUUID().slice(0, 8)}`,
      ...TEST_ADRESSE,
      abrechnungsart: "pauschale",
      pauschale_cent: 50000,
    })
    .select("id, bezeichnung")
    .single<{ id: string; bezeichnung: string }>();
  if (fehler) throw fehler;

  return { kundeId: kunde.id, objektId: objekt.id, bezeichnung: objekt.bezeichnung };
}

// Legt eine Tätigkeit an, ohne über die App zu gehen.
export async function legeTaetigkeitAn(
  supabase: SupabaseClient,
  firmaId: string,
  { standardStundensatzCent = 3000 }: { standardStundensatzCent?: number } = {},
) {
  const { data, error } = await supabase
    .from("taetigkeit")
    .insert({
      firma_id: firmaId,
      name: `Tätigkeit ${randomUUID().slice(0, 8)}`,
      sparte: "reinigung",
      standard_stundensatz_cent: standardStundensatzCent,
    })
    .select("id, name")
    .single<{ id: string; name: string }>();
  if (error) throw error;
  return { taetigkeitId: data.id, name: data.name };
}

// Ein frischer Zugang nur für einen Test. Zeiterfassungs-Tests brauchen
// ihn, weil je Mitarbeiter nur ein Zeiteintrag laufen kann und die Tests
// parallel laufen. Er verschwindet mit der Firma beim Aufräumen.
export async function legeEigenenZugangAn(firmaId: string, rolle: Rolle = "mitarbeiter") {
  return legeZugangAn(dienstZugang()!, firmaId, {
    name: `Erfasser ${randomUUID().slice(0, 8)}`,
    rolle,
  });
}

// Legt einen Zeiteintrag mit beliebigen Zeiten an, ohne über die App zu
// gehen (z. B. für Einträge an früheren Tagen).
export async function legeZeiteintragAn(
  supabase: SupabaseClient,
  eintrag: {
    firmaId: string;
    mitarbeiterId: string;
    objektId?: string;
    taetigkeitId?: string;
    zusatzauftragId?: string;
    beginn: string;
    ende: string | null;
  },
) {
  const fahrt = !eintrag.objektId;
  const { data, error } = await supabase
    .from("zeiteintrag")
    .insert({
      firma_id: eintrag.firmaId,
      mitarbeiter_id: eintrag.mitarbeiterId,
      angelegt_von: eintrag.mitarbeiterId,
      art: fahrt ? "fahrt" : "taetigkeit",
      objekt_id: eintrag.objektId ?? null,
      taetigkeit_id: eintrag.taetigkeitId ?? null,
      zusatzauftrag_id: eintrag.zusatzauftragId ?? null,
      beginn: eintrag.beginn,
      ende: eintrag.ende,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

// Legt einen Zusatzauftrag an, ohne über die App zu gehen. Ohne
// Festbetrag wird nach Stunden abgerechnet.
export async function legeZusatzauftragAn(
  supabase: SupabaseClient,
  firmaId: string,
  objektId: string,
  {
    festbetragCent = null,
    erledigt = false,
  }: { festbetragCent?: number | null; erledigt?: boolean } = {},
) {
  const { data, error } = await supabase
    .from("zusatzauftrag")
    .insert({
      firma_id: firmaId,
      objekt_id: objektId,
      beschreibung: `Zusatzauftrag ${randomUUID().slice(0, 8)}`,
      abrechnungsart: festbetragCent === null ? "stunden" : "festbetrag",
      festbetrag_cent: festbetragCent,
      erledigt,
    })
    .select("id, beschreibung")
    .single<{ id: string; beschreibung: string }>();
  if (error) throw error;
  return { zusatzauftragId: data.id, beschreibung: data.beschreibung };
}

// Eine eigene Firma mit Büro-Zugang nur für einen Test, z. B. wenn er
// Einstellungen der Firma ändert, auf die sich parallele Tests verlassen.
// Der Test entfernt sie am Ende mit entferneFirma; Reste abgebrochener
// Läufe räumt das Aufräumen über den Namen ab.
export async function legeEigeneFirmaAn(): Promise<TestFirma> {
  const supabase = dienstZugang()!;
  const { data, error } = await supabase
    .from("firma")
    .insert({ name: `${TEST_FIRMA_PRAEFIX} eigene ${randomUUID().slice(0, 8)}` })
    .select("id, name")
    .single<{ id: string; name: string }>();
  if (error) throw error;
  return { ...data, buero: await legeZugangAn(supabase, data.id, { name: "Erna Eigene" }) };
}

export async function entferneFirma(firmaId: string) {
  const supabase = dienstZugang()!;
  const { data, error } = await supabase
    .from("mitarbeiter")
    .select("auth_user_id")
    .eq("firma_id", firmaId)
    .not("auth_user_id", "is", null);
  if (error) throw error;
  for (const { auth_user_id } of data) {
    const { error } = await supabase.auth.admin.deleteUser(auth_user_id);
    if (error) throw error;
  }
  const { error: fehler } = await supabase.from("firma").delete().eq("id", firmaId);
  if (fehler) throw fehler;
}
