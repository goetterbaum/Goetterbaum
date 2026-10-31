import Link from "next/link";
import { EndeFormular } from "@/app/nachtrag/ende-formular";
import { berlinerDatum } from "@/lib/berliner-zeit";
import { createClient } from "@/lib/supabase/server";
import {
  ANGEZEIGTE_TAGE,
  angelegtVon,
  laeuftSeit,
  nachTagen,
  UNVOLLSTAENDIG_NACH_STUNDEN,
  wasUndWo,
  type MeinZeiteintrag,
} from "@/lib/zeiterfassung/anzeige";
import { knoepfe, zustandDerErfassung, type Knoepfe } from "@/lib/zeiterfassung/live-erfassung";
import { ladeAuswahl, ladeZeiteintraegeVon } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";
import styles from "./erfassung.module.css";
import { endeNachtragen } from "./actions";
import { ArbeitstagBeendenKnopf, FertigHierKnopf, PauseKnopf } from "./laufend-knoepfe";
import { StartFormular } from "./start-formular";

// Die Live-Erfassung eines Mitarbeiters: der laufende Zeiteintrag mit den
// Knöpfen, die sein Zustand erlaubt (siehe live-erfassung.ts), und das
// Start-Formular, wenn nichts oder eine Fahrt läuft. Nach einer Pause
// zusätzlich „Fahrt starten“ und „Arbeitstag beenden“. Darunter seine
// Einträge der letzten Tage. eigene: der angemeldete Nutzer erfasst für
// sich selbst, sonst als Vorarbeiter oder Büro für einen anderen.
export async function Erfassung({
  mitarbeiterId,
  eigene,
}: {
  mitarbeiterId: string;
  eigene: boolean;
}) {
  const supabase = await createClient();
  const { eintraege, jetzt } = await ladeZeiteintraegeVon(supabase, mitarbeiterId);
  const laufender = eintraege.find((e) => e.ende === null);
  const erlaubt = knoepfe(zustandDerErfassung(eintraege, jetzt));
  // Die Auswahl braucht nur das Start-Formular.
  const auswahl = erlaubt.startFormular ? await ladeAuswahl(supabase) : null;

  return (
    <section className={styles.erfassung}>
      {laufender && (
        <Laufend
          eintrag={laufender}
          mitarbeiterId={mitarbeiterId}
          jetzt={jetzt}
          knoepfe={erlaubt}
        />
      )}
      {auswahl && (
        <StartFormular fuer={mitarbeiterId} fahrtStarten={erlaubt.fahrtStarten} {...auswahl} />
      )}
      {/* Nach einer Pause; während eines laufenden Eintrags steht er dort. */}
      {!laufender && erlaubt.arbeitstagBeenden && (
        <ArbeitstagBeendenKnopf fuer={mitarbeiterId} fahrtSeit={null} />
      )}
      <Eintraege eintraege={eintraege} mitarbeiterId={mitarbeiterId} eigene={eigene} />
    </section>
  );
}

function Laufend({
  eintrag,
  mitarbeiterId,
  jetzt,
  knoepfe,
}: {
  eintrag: MeinZeiteintrag;
  mitarbeiterId: string;
  jetzt: number;
  knoepfe: Knoepfe;
}) {
  const anleger = angelegtVon(eintrag, mitarbeiterId);
  // Ist er unvollständig, würde jeder Knopf "jetzt" als Ende speichern,
  // also mehr als 12 Stunden. Deshalb nur das Formular für das richtige
  // Ende.
  const unvollstaendig = knoepfe.endeNachtragen;
  return (
    <div
      className={`${styles.laufend} ${unvollstaendig ? styles.unvollstaendig : ""}`}
      role="status"
    >
      {unvollstaendig && (
        <>
          <h2>{texte.erfassung.unvollstaendig}</h2>
          <p>{texte.erfassung.unvollstaendigHinweis(UNVOLLSTAENDIG_NACH_STUNDEN)}</p>
        </>
      )}
      <p className={styles.seit}>{texte.erfassung.laeuftSeit(laeuftSeit(eintrag.beginn, jetzt))}</p>
      <p className={styles.beschreibung}>{wasUndWo(eintrag)}</p>
      {anleger && <p>{anleger}</p>}
      {unvollstaendig && (
        <EndeFormular
          aktion={endeNachtragen.bind(null, eintrag.id)}
          datum={berlinerDatum(Date.parse(eintrag.beginn))}
        />
      )}
      {knoepfe.fertigHier && <FertigHierKnopf fuer={mitarbeiterId} />}
      {knoepfe.pause && <PauseKnopf fuer={mitarbeiterId} />}
      {knoepfe.arbeitstagBeenden && (
        <ArbeitstagBeendenKnopf
          fuer={mitarbeiterId}
          fahrtSeit={eintrag.art === "fahrt" ? eintrag.beginn : null}
        />
      )}
    </div>
  );
}

function Eintraege({
  eintraege,
  mitarbeiterId,
  eigene,
}: {
  eintraege: MeinZeiteintrag[];
  mitarbeiterId: string;
  eigene: boolean;
}) {
  const tage = nachTagen(eintraege);
  return (
    <div className={styles.liste}>
      <h2>{eigene ? texte.erfassung.meineEintraege : texte.fuerAndere.zeiteintraege}</h2>
      <p>
        <Link href={eigene ? "/nachtrag" : `/nachtrag?fuer=${mitarbeiterId}`}>
          {texte.nachtrag.nachtragen}
        </Link>
      </p>
      {tage.length === 0 && <p>{texte.erfassung.keineEintraege(ANGEZEIGTE_TAGE)}</p>}
      {tage.map((tag) => (
        <section key={tag.datum} aria-label={tag.titel}>
          <h3>{tag.titel}</h3>
          <ul>
            {tag.eintraege.map((e) => {
              const anleger = angelegtVon(e, mitarbeiterId);
              return (
                <li key={e.id}>
                  <span>
                    {texte.erfassung.vonBis(e.von, e.bis)} · {e.dauer}
                  </span>
                  {e.nachtrag && (
                    <span className={styles.markierung}>{texte.nachtrag.markierung}</span>
                  )}
                  {e.freigegeben && (
                    <span className={`${styles.markierung} ${styles.freigegeben}`}>
                      {texte.freigabe.markierung}
                    </span>
                  )}
                  <br />
                  {wasUndWo(e)}
                  {anleger && (
                    <>
                      <br />
                      {anleger}
                    </>
                  )}
                  {/* Freigegebene ändert nur noch das Büro, über die Übersicht. */}
                  {!e.freigegeben && (
                    <>
                      <br />
                      <Link href={`/nachtrag/${e.id}`}>{texte.nachtrag.aendern}</Link>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
