import Link from "next/link";
import { Suspense } from "react";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { freigabeZuruecknehmen } from "@/app/freigabe/actions";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { createClient } from "@/lib/supabase/server";
import { istUnvollstaendig, tagUndZeit, wasUndWo } from "@/lib/zeiterfassung/anzeige";
import { zeitAlsText } from "@/lib/zeiterfassung/protokoll";
import { ladeZeiteintragMitProtokoll } from "@/lib/zeiterfassung/verwaltung";
import { ladeZuordenbareZusatzauftraege } from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";
import styles from "../../page.module.css";
import { zuordnungAendern } from "../actions";
import { ZuordnungFormular } from "../zuordnung-formular";

export default function ZeiteintragProtokoll({ params }: PageProps<"/zeiteintraege/[id]">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.zeiteintraege.protokollTitel}</h1>
        <Suspense fallback={<p>{texte.zeiteintraege.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.zeiteintraege.keineBerechtigung}>
            {() => <Protokoll id={params.then((p) => p.id)} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

// Der Zeiteintrag mit seinem Zusatzauftrag (änderbar, solange er nicht
// abgerechnet ist), ob und von wem er freigegeben ist (mit Rücknahme,
// solange er nicht abgerechnet ist), und darunter jede Änderung: wann,
// wer, was vorher und was nachher.
async function Protokoll({ id: idVersprechen }: { id: Promise<string> }) {
  const t = texte.zeiteintraege;
  const supabase = await createClient();
  const geladen = await ladeZeiteintragMitProtokoll(supabase, await idVersprechen);

  if (!geladen) {
    return (
      <>
        <p>{t.nichtGefunden}</p>
        <ZurUebersicht />
      </>
    );
  }

  const { eintrag, abgerechnet, protokoll, jetzt } = geladen;
  const unvollstaendig = istUnvollstaendig(eintrag, jetzt);
  return (
    <>
      <h2>
        {eintrag.mitarbeiter_name} ·{" "}
        {tagUndZeit(eintrag.beginn, eintrag.ende, unvollstaendig ? t.unvollstaendig : t.laeuft)}
      </h2>
      {unvollstaendig && (
        <p>
          <Link href={`/nachtrag/${eintrag.id}?aus=pruefliste`}>
            {texte.nachtrag.endeNachtragen}
          </Link>
        </p>
      )}
      <p>
        {wasUndWo(eintrag)}
        {eintrag.nachtrag && ` · ${texte.nachtrag.markierung}`}
      </p>
      <p>{texte.erfassung.angelegtVon(eintrag.angelegt_von_name ?? texte.protokoll.unbekannt)}</p>
      {eintrag.objekt_id !== null && !abgerechnet && (
        <ZuordnungFormular
          // Neu aufbauen, wenn sich die Zuordnung geändert hat.
          key={eintrag.zusatzauftrag_id ?? ""}
          aktion={zuordnungAendern.bind(null, eintrag.id)}
          zusatzauftraege={await ladeZuordenbareZusatzauftraege(supabase, eintrag.objekt_id)}
          bisher={eintrag.zusatzauftrag_id}
        />
      )}
      {eintrag.freigegeben_am !== null && (
        <>
          <p>
            {texte.freigabe.freigegebenAmVon(
              zeitAlsText(eintrag.freigegeben_am),
              eintrag.freigegeben_von_name ?? texte.protokoll.unbekannt,
            )}
          </p>
          {abgerechnet ? (
            <p>{texte.abrechnung.abgerechnet}</p>
          ) : (
            <AktionsKnopf
              aktion={freigabeZuruecknehmen.bind(null, eintrag.id)}
              knopf={texte.freigabe.zuruecknehmen}
              knopfLaeuft={texte.freigabe.zuruecknehmenLaeuft}
            />
          )}
        </>
      )}
      {protokoll.length === 0 ? (
        <p>{t.keinProtokoll}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.spalteWann}</th>
              <th>{t.spalteWer}</th>
              <th>{t.spalteAktion}</th>
              <th>{t.spalteAenderung}</th>
            </tr>
          </thead>
          <tbody>
            {protokoll.map((zeile) => (
              <tr key={zeile.id}>
                <td>{zeile.wann}</td>
                <td>{zeile.wer}</td>
                <td>{zeile.aktion}</td>
                <td>
                  <ul>
                    {zeile.aenderungen.map((a) => (
                      <li key={a.feld}>{t.aenderung(a.feld, a.vorher, a.nachher)}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ZurUebersicht />
    </>
  );
}

function ZurUebersicht() {
  return (
    <p>
      <Link href="/zeiteintraege">{texte.zeiteintraege.zurUebersicht}</Link>
    </p>
  );
}
