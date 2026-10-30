import type { SupabaseClient } from "@supabase/supabase-js";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { euroAlsEingabe, euroAlsText } from "@/lib/geld";
import type { Objekt } from "@/lib/objekte/verwaltung";
import { geltenderStundensatz } from "@/lib/stundensaetze/regeln";
import { ladeKundenStundensaetze, ladeObjektStundensaetze } from "@/lib/stundensaetze/verwaltung";
import { ladeTaetigkeitenliste } from "@/lib/taetigkeiten/verwaltung";
import { texte } from "@/texte";
import { objektStundensatzEntfernen, objektStundensatzFestlegen } from "./actions";
import { ObjektStundensatzFormular } from "./objekt-stundensatz-formular";

// Die Stundensätze eines Objekts: für jede aktive Tätigkeit Standard, Satz
// des Kunden, Satz des Objekts und welcher davon gilt, dazu Festlegen und
// Entfernen. Archivierte Tätigkeiten erscheinen nur, wenn das Objekt für
// sie noch einen Satz hat; festlegen lässt er sich dann nicht mehr.
export async function ObjektStundensaetze({
  supabase,
  objekt,
}: {
  supabase: SupabaseClient;
  objekt: Objekt;
}) {
  const [taetigkeiten, kundenSaetze, objektSaetze] = await Promise.all([
    ladeTaetigkeitenliste(supabase),
    ladeKundenStundensaetze(supabase, objekt.kunde_id),
    ladeObjektStundensaetze(supabase, [objekt.id]),
  ]);
  const kundenSatzFuer = new Map(kundenSaetze.map((s) => [s.taetigkeit_id, s.stundensatz_cent]));
  const objektSatzFuer = new Map(objektSaetze.map((s) => [s.taetigkeit_id, s.stundensatz_cent]));
  const zeilen = taetigkeiten.filter((t) => !t.archiviert || objektSatzFuer.has(t.id));
  const text = texte.stundensaetze;

  return (
    <>
      <h2>{text.titel}</h2>
      <p>{texte.objektStundensaetze.hinweis}</p>
      {objekt.abrechnungsart === "pauschale" && <p>{texte.objektStundensaetze.hinweisPauschale}</p>}
      {zeilen.length === 0 ? (
        <p>{text.keineTaetigkeiten}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{text.spalteTaetigkeit}</th>
              <th>{text.spalteStandard}</th>
              <th>{texte.objektStundensaetze.spalteKunde}</th>
              <th>{texte.objektStundensaetze.spalteObjekt}</th>
              <th>{text.spalteGilt}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zeilen.map((taetigkeit) => {
              const kundeCent = kundenSatzFuer.get(taetigkeit.id) ?? null;
              const objektCent = objektSatzFuer.get(taetigkeit.id) ?? null;
              const gilt = geltenderStundensatz({
                standardCent: taetigkeit.standard_stundensatz_cent,
                kundeCent,
                objektCent,
              });
              return (
                <tr key={taetigkeit.id}>
                  <td>
                    {taetigkeit.name}
                    {taetigkeit.archiviert && ` (${texte.stammdaten.archiviert})`}
                  </td>
                  <td>{euroAlsText(taetigkeit.standard_stundensatz_cent)}</td>
                  <td>{kundeCent === null ? "–" : euroAlsText(kundeCent)}</td>
                  <td>{objektCent === null ? "–" : euroAlsText(objektCent)}</td>
                  <td>
                    {texte.objektStundensaetze.gilt(
                      euroAlsText(gilt.stundensatzCent),
                      gilt.herkunft,
                    )}
                  </td>
                  <td>
                    {!taetigkeit.archiviert && (
                      <ObjektStundensatzFormular
                        aktion={objektStundensatzFestlegen.bind(null, objekt.id)}
                        taetigkeit={{ id: taetigkeit.id, name: taetigkeit.name }}
                        vorgabe={euroAlsEingabe(gilt.stundensatzCent)}
                      />
                    )}
                    {objektCent !== null && (
                      <AktionsKnopf
                        aktion={objektStundensatzEntfernen.bind(null, objekt.id, taetigkeit.id)}
                        knopf={text.entfernen}
                        knopfLaeuft={text.entfernenLaeuft}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
