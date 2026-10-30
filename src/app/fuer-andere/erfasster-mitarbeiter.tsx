import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AngemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { darfFuerAndereErfassen } from "@/lib/rollen";
import {
  ladeMitarbeiterZumErfassen,
  type MitarbeiterZumErfassen,
} from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";

type ErfassterMitarbeiter = MitarbeiterZumErfassen & { aktiv: boolean };

// Der Mitarbeiter mit der Kennung id, für den der angemeldete Nutzer
// erfasst, oder ein Hinweis, warum das nicht geht: Für andere erfassen nur
// Vorarbeiter und Büro, und nur für aktive Mitarbeiter. Einen
// bestehenden Eintrag ändern (zumAendern) darf das Büro auch bei
// deaktivierten, um Fehler zu beheben. Das ist Bedienkomfort; geschützt
// sind die Daten durch die Zugriffsregeln der Datenbank und die Prüfung in
// jeder Aktion.
export async function erfassterMitarbeiter(
  supabase: SupabaseClient,
  ich: AngemeldeterMitarbeiter,
  id: string,
  { zumAendern = false }: { zumAendern?: boolean } = {},
): Promise<{ mitarbeiter: ErfassterMitarbeiter } | { hinweis: ReactNode }> {
  if (id === ich.id) return { mitarbeiter: { id: ich.id, name: ich.name, aktiv: true } };
  if (!darfFuerAndereErfassen(ich.rolle)) return { hinweis: <KeineBerechtigung /> };

  const mitarbeiter = await ladeMitarbeiterZumErfassen(
    supabase,
    id,
    zumAendern && ich.rolle === "buero",
  );
  if (!mitarbeiter) {
    return {
      hinweis: (
        <>
          <p>{texte.fuerAndere.nichtGefunden}</p>
          <p>
            <Link href="/fuer-andere">{texte.fuerAndere.zurAuswahl}</Link>
          </p>
        </>
      ),
    };
  }
  return { mitarbeiter };
}

export function KeineBerechtigung() {
  return (
    <>
      <p>{texte.fuerAndere.keineBerechtigung}</p>
    </>
  );
}

// Wohin es nach dem Nachtragen oder Ändern zurückgeht: zur eigenen
// Erfassung auf der Startseite, zu der des anderen Mitarbeiters oder, wenn
// er deaktiviert ist (nur Büro), zur Übersicht der Zeiteinträge.
export function erfassungVon(ich: AngemeldeterMitarbeiter, mitarbeiter: ErfassterMitarbeiter) {
  if (mitarbeiter.id === ich.id) return "/";
  return mitarbeiter.aktiv ? `/fuer-andere/${mitarbeiter.id}` : "/zeiteintraege";
}
