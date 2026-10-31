import Link from "next/link";
import { Suspense } from "react";
import { geltendeArbeitgeberkosten } from "@/lib/arbeitgeberkosten/regeln";
import { alsVerlauf, ladeArbeitgeberkosten } from "@/lib/arbeitgeberkosten/verwaltung";
import { heuteInBerlin } from "@/lib/berliner-zeit";
import { euroAlsText } from "@/lib/geld";
import { zugangsStatus } from "@/lib/mitarbeiter/regeln";
import { ladeMitarbeiter } from "@/lib/mitarbeiter/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../../page.module.css";
import { aktivSetzen, einladen, speichern } from "../actions";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { ArbeitgeberkostenVerlauf } from "@/app/arbeitgeberkosten/verlauf";
import { MitarbeiterFormular } from "../mitarbeiter-formular";
import { NurFuerBuero } from "@/app/nur-fuer-buero";

export default function MitarbeiterBearbeiten({ params }: PageProps<"/mitarbeiter/[id]">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.mitarbeiter.titel}</h1>
        <Suspense fallback={<p>{texte.mitarbeiter.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.mitarbeiter.keineBerechtigung}>
            {() => <Bearbeiten id={params.then((p) => p.id)} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Bearbeiten({ id: idVersprechen }: { id: Promise<string> }) {
  const id = await idVersprechen;
  const mitarbeiter = await ladeMitarbeiter(await createClient(), id);

  if (!mitarbeiter) {
    return (
      <>
        <p>{texte.mitarbeiter.nichtGefunden}</p>
        <ZurUebersicht />
      </>
    );
  }

  const einladbar = mitarbeiter.aktiv && mitarbeiter.email;

  return (
    <>
      <h2>{mitarbeiter.name}</h2>
      <p>
        {texte.mitarbeiter.zugang}: <strong>{zugangsStatus(mitarbeiter)}</strong>
      </p>

      <MitarbeiterFormular
        aktion={speichern.bind(null, mitarbeiter.id)}
        vorgabe={mitarbeiter}
        knopf={texte.mitarbeiter.speichern}
        knopfLaeuft={texte.mitarbeiter.speichernLaeuft}
      />

      {einladbar && (
        <AktionsKnopf
          aktion={einladen.bind(null, mitarbeiter.id)}
          knopf={
            mitarbeiter.hatZugang
              ? texte.mitarbeiter.einladung.erneutSenden
              : texte.mitarbeiter.einladung.senden
          }
          knopfLaeuft={texte.mitarbeiter.einladung.laeuft}
        />
      )}

      <Arbeitgeberkosten mitarbeiterId={mitarbeiter.id} />

      <p>{texte.mitarbeiter.deaktiviertHinweis}</p>
      {/* Neuer Knopf nach jedem Wechsel, damit keine alte Meldung stehen
          bleibt. */}
      <AktionsKnopf
        key={String(mitarbeiter.aktiv)}
        aktion={aktivSetzen.bind(null, mitarbeiter.id, !mitarbeiter.aktiv)}
        knopf={mitarbeiter.aktiv ? texte.mitarbeiter.deaktivieren : texte.mitarbeiter.aktivieren}
        knopfLaeuft={texte.mitarbeiter.speichernLaeuft}
      />

      <ZurUebersicht />
    </>
  );
}

// Der eigene Wert der Arbeitgeberkosten mit Verlauf und was heute gilt.
async function Arbeitgeberkosten({ mitarbeiterId }: { mitarbeiterId: string }) {
  const supabase = await createClient();
  const ziel = { mitarbeiterId };
  const [eigene, standard] = await Promise.all([
    ladeArbeitgeberkosten(supabase, ziel),
    ladeArbeitgeberkosten(supabase, { mitarbeiterId: null }),
  ]);
  const t = texte.arbeitgeberkosten;
  const heute = geltendeArbeitgeberkosten(
    heuteInBerlin(),
    alsVerlauf(eigene),
    alsVerlauf(standard),
  );

  return (
    <>
      <h2>{t.titel}</h2>
      <p>{t.hinweisMitarbeiter}</p>
      <p>
        {heute
          ? t.heute(euroAlsText(heute.centJeStunde), t.herkunft[heute.herkunft])
          : t.heuteKeiner}
      </p>
      <ArbeitgeberkostenVerlauf ziel={ziel} werte={eigene} />
    </>
  );
}

function ZurUebersicht() {
  return (
    <p>
      <Link href="/mitarbeiter">{texte.mitarbeiter.zurUebersicht}</Link>
    </p>
  );
}
