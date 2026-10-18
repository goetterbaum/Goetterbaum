import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { euroAlsText } from "@/lib/geld";
import {
  ladeZusatzauftraegeDesObjekts,
  zusatzauftragStatus,
  type Zusatzauftrag,
} from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";
import { zusatzauftragAnlegen } from "./actions";
import { ZusatzauftragFormular } from "./zusatzauftrag-formular";

export function abrechnungDesZusatzauftrags(
  za: Pick<Zusatzauftrag, "abrechnungsart" | "festbetrag_cent">,
): string {
  if (za.abrechnungsart === "stunden") return texte.zusatzauftraege.nachStunden;
  return texte.zusatzauftraege.festbetragAlsText(euroAlsText(za.festbetrag_cent ?? 0));
}

// Die Zusatzaufträge eines Objekts mit Status und darunter das Formular für
// einen neuen (nicht bei archivierten Objekten).
export async function Zusatzauftraege({
  supabase,
  objektId,
  objektArchiviert,
}: {
  supabase: SupabaseClient;
  objektId: string;
  objektArchiviert: boolean;
}) {
  const t = texte.zusatzauftraege;
  const zusatzauftraege = await ladeZusatzauftraegeDesObjekts(supabase, objektId);

  return (
    <section aria-label={t.titel}>
      <h2>{t.titel}</h2>
      <p>{t.hinweis}</p>
      {zusatzauftraege.length === 0 ? (
        <p>{t.keine}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.spalteBeschreibung}</th>
              <th>{t.spalteAbrechnung}</th>
              <th>{t.spalteStatus}</th>
            </tr>
          </thead>
          <tbody>
            {zusatzauftraege.map((za) => (
              <tr key={za.id}>
                <td>
                  <Link href={`/zusatzauftraege/${za.id}`}>{za.beschreibung}</Link>
                </td>
                <td>{abrechnungDesZusatzauftrags(za)}</td>
                <td>{t.status[zusatzauftragStatus(za)]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {objektArchiviert ? (
        <p>{t.objektArchiviert}</p>
      ) : (
        <ZusatzauftragFormular
          aktion={zusatzauftragAnlegen.bind(null, objektId)}
          titel={t.neuTitel}
          knopf={texte.stammdaten.anlegen}
          knopfLaeuft={texte.stammdaten.anlegenLaeuft}
        />
      )}
    </section>
  );
}
