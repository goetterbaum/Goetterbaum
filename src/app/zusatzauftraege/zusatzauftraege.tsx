import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { euroAlsText } from "@/lib/geld";
import type { Objekt } from "@/lib/objekte/verwaltung";
import {
  ladeZusatzauftraegeDesObjekts,
  type Zusatzauftrag,
} from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";
import { zusatzauftragAnlegen } from "./actions";
import { ZusatzauftragFormular } from "./zusatzauftrag-formular";

// Die Abrechnung eines Zusatzauftrags in Worten, z. B. „Festbetrag 890,00 €“
// oder „Nach Stunden, 52,50 € je Stunde“.
export function zusatzauftragAbrechnungAlsText(
  zusatzauftrag: Pick<Zusatzauftrag, "abrechnungsart" | "festbetrag_cent" | "stundensatz_cent">,
): string {
  if (zusatzauftrag.abrechnungsart === "festbetrag" && zusatzauftrag.festbetrag_cent) {
    return texte.zusatzauftraege.festbetragText(euroAlsText(zusatzauftrag.festbetrag_cent));
  }
  if (zusatzauftrag.abrechnungsart === "stunden" && zusatzauftrag.stundensatz_cent) {
    return texte.zusatzauftraege.stundenMitSatzText(euroAlsText(zusatzauftrag.stundensatz_cent));
  }
  return texte.zusatzauftragAbrechnungsarten[zusatzauftrag.abrechnungsart];
}

export function zusatzauftragStatus(
  zusatzauftrag: Pick<Zusatzauftrag, "erledigt" | "abgerechnet_in">,
): string {
  const t = texte.zusatzauftraege;
  if (zusatzauftrag.abgerechnet_in) return t.erledigtUndAbgerechnet;
  return zusatzauftrag.erledigt ? t.erledigt : t.offen;
}

// Die Zusatzaufträge eines Objekts mit Abrechnung und Status, darunter das
// Formular für einen neuen (nicht bei archivierten Objekten).
export async function Zusatzauftraege({
  supabase,
  objekt,
}: {
  supabase: SupabaseClient;
  objekt: Pick<Objekt, "id" | "archiviert">;
}) {
  const t = texte.zusatzauftraege;
  const zusatzauftraege = await ladeZusatzauftraegeDesObjekts(supabase, objekt.id);

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
              <th />
            </tr>
          </thead>
          <tbody>
            {zusatzauftraege.map((z) => (
              <tr key={z.id}>
                <td>{z.beschreibung}</td>
                <td>{zusatzauftragAbrechnungAlsText(z)}</td>
                <td>{zusatzauftragStatus(z)}</td>
                <td>
                  <Link
                    href={`/zusatzauftraege/${z.id}`}
                    aria-label={t.bearbeitenVon(z.beschreibung)}
                  >
                    {t.bearbeiten}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {objekt.archiviert ? (
        <p>{t.objektArchiviert}</p>
      ) : (
        <ZusatzauftragFormular
          aktion={zusatzauftragAnlegen.bind(null, objekt.id)}
          leeren
          titel={t.neuTitel}
          knopf={texte.stammdaten.anlegen}
          knopfLaeuft={texte.stammdaten.anlegenLaeuft}
        />
      )}
    </section>
  );
}
