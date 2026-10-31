import { KnopfMitRueckfrage } from "@/app/knopf-mit-rueckfrage";
import type { ArbeitgeberkostenWert, Ziel } from "@/lib/arbeitgeberkosten/verwaltung";
import { datumAlsText } from "@/lib/berliner-zeit";
import { euroAlsEingabe, euroAlsText } from "@/lib/geld";
import { texte } from "@/texte";
import {
  arbeitgeberkostenAendern,
  arbeitgeberkostenHinzufuegen,
  arbeitgeberkostenLoeschen,
} from "./actions";
import { ArbeitgeberkostenFormular } from "./arbeitgeberkosten-formular";

// Der Verlauf der Arbeitgeberkosten (Standard der Firma oder eigener Wert
// eines Mitarbeiters): je Wert „gültig ab“ und Betrag mit Ändern und
// Löschen, darunter ein neuer Wert. Alte Werte bleiben stehen, damit
// frühere Monate richtig gerechnet werden.
export function ArbeitgeberkostenVerlauf({
  ziel,
  werte,
}: {
  ziel: Ziel;
  werte: ArbeitgeberkostenWert[];
}) {
  const t = texte.arbeitgeberkosten;

  return (
    <>
      {werte.length === 0 ? (
        <p>{t.keine}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.spalteGueltigAb}</th>
              <th>{t.spalteBetrag}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {werte.map((wert) => {
              const datum = datumAlsText(wert.gueltig_ab);
              return (
                <tr key={wert.id}>
                  <td>{datum}</td>
                  <td>{euroAlsText(wert.kosten_je_stunde_cent)}</td>
                  <td>
                    <ArbeitgeberkostenFormular
                      aktion={arbeitgeberkostenAendern.bind(null, ziel, wert.id)}
                      vorgabe={{
                        gueltigAb: wert.gueltig_ab,
                        betrag: euroAlsEingabe(wert.kosten_je_stunde_cent),
                      }}
                      beschriftung={{ gueltigAb: t.gueltigAbAm(datum), betrag: t.betragAm(datum) }}
                      knopf={t.aendern}
                      knopfLaeuft={t.aendernLaeuft}
                    />
                    <KnopfMitRueckfrage
                      aktion={arbeitgeberkostenLoeschen.bind(null, ziel, wert.id)}
                      knopf={t.loeschen}
                      rueckfrage={t.loeschenRueckfrage(datum)}
                      bestaetigen={t.loeschenBestaetigen}
                      abbrechen={t.abbrechen}
                      knopfLaeuft={t.loeschenLaeuft}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <h3>{t.hinzufuegenTitel}</h3>
      <ArbeitgeberkostenFormular
        aktion={arbeitgeberkostenHinzufuegen.bind(null, ziel)}
        beschriftung={{ gueltigAb: t.gueltigAb, betrag: t.betrag }}
        sichtbar
        knopf={t.hinzufuegen}
        knopfLaeuft={t.hinzufuegenLaeuft}
      />
    </>
  );
}
