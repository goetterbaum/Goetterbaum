import { KnopfMitRueckfrage } from "@/app/knopf-mit-rueckfrage";
import { euroAlsText } from "@/lib/geld";
import { ladeAbrechnungen, type BisherigeAbrechnung } from "@/lib/rechnungsvorbereitung/verwaltung";
import { gewaehlterZeitraum, monatVon } from "@/lib/rechnungsvorbereitung/zeitraum";
import { createClient } from "@/lib/supabase/server";
import { zeitAlsText } from "@/lib/zeiterfassung/protokoll";
import { texte } from "@/texte";
import { abrechnungZuruecknehmen } from "./actions";

// Die bisherigen Abrechnungen des Kunden, auch die einzeln abgerechneter
// Zusatzaufträge; gültige lassen sich nach einer Rückfrage zurücknehmen.
export async function Abrechnungen({ kundeId }: { kundeId: string }) {
  const t = texte.rechnungsvorbereitung;
  const abrechnungen = await ladeAbrechnungen(await createClient(), kundeId);
  return (
    <>
      <h2>{t.bisherigeAbrechnungen}</h2>
      {abrechnungen.length === 0 ? (
        <p>{t.keineAbrechnungen}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.spalteZeitraum}</th>
              <th>{t.spalteBetrag}</th>
              <th>{t.spalteAbgerechnet}</th>
              <th>{t.spalteStatus}</th>
            </tr>
          </thead>
          <tbody>
            {abrechnungen.map((a) => (
              <tr key={a.id}>
                <td>{umfangAlsText(a)}</td>
                <td>{euroAlsText(a.summe_cent)}</td>
                <td>{t.amVon(zeitAlsText(a.abgerechnet_am), a.abgerechnet_von_name)}</td>
                <td>
                  {a.zurueckgenommen_am !== null ? (
                    t.zurueckgenommenAmVon(
                      zeitAlsText(a.zurueckgenommen_am),
                      a.zurueckgenommen_von_name ?? texte.protokoll.unbekannt,
                    )
                  ) : (
                    <>
                      {t.gueltig}
                      <KnopfMitRueckfrage
                        aktion={abrechnungZuruecknehmen.bind(null, a.id)}
                        knopf={t.zuruecknehmen}
                        rueckfrage={t.rueckfrage}
                        bestaetigen={t.jaZuruecknehmen}
                        abbrechen={t.abbrechen}
                        knopfLaeuft={t.zuruecknehmenLaeuft}
                      />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// Der Zeitraum, z. B. „März 2026“, oder der einzeln abgerechnete
// Zusatzauftrag.
function umfangAlsText(a: BisherigeAbrechnung): string {
  if (a.erster_monat === null) {
    return texte.rechnungsvorbereitung.einzelnAbgerechnet(a.zusatzauftrag_beschreibung);
  }
  return gewaehlterZeitraum(monatVon(a.erster_monat), a.abrechnungszeitraum, 0).bezeichnung;
}
