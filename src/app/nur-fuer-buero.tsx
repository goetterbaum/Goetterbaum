import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  angemeldeterMitarbeiter,
  type AngemeldeterMitarbeiter,
} from "@/lib/angemeldeter-mitarbeiter";

// Zeigt den Inhalt nur Büro-Nutzern. Das ist Bedienkomfort; geschützt
// sind die Daten durch die Zugriffsregeln der Datenbank und die Prüfung
// in jeder Aktion.
// keineBerechtigung ist der Hinweis für alle anderen Rollen.
export async function NurFuerBuero({
  keineBerechtigung,
  children,
}: {
  keineBerechtigung: string;
  children: (ich: AngemeldeterMitarbeiter) => ReactNode;
}) {
  const ich = await angemeldeterMitarbeiter();
  if (!ich) redirect("/anmelden");

  if (ich.rolle !== "buero") {
    return <p>{keineBerechtigung}</p>;
  }

  return children(ich);
}
