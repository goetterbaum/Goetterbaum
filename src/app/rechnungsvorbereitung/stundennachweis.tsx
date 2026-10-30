import { datumAlsText } from "@/lib/berliner-zeit";
import type { GerundeterTag } from "@/lib/rechnungsvorbereitung";
import { name, stundenAlsText, type Namen } from "@/lib/rechnungsvorbereitung/zeilen";
import { texte } from "@/texte";

// Der Stundennachweis als Tagesliste unter den Positionen, damit das Büro
// die Stunden prüfen kann, ohne eine Datei herunterzuladen. Die Tage kommen
// unverändert aus dem Rechenbaustein und ergeben zusammen genau die
// Stunden-Positionen; Mitarbeiter werden nie genannt. Darunter der Link zur
// Datei, die der Kunde nur auf Nachfrage bekommt. Ohne nach Stunden
// berechnete Tage gibt es beides nicht.
export function Stundennachweis({
  href,
  tage,
  namen,
}: {
  href: string;
  tage: GerundeterTag[];
  namen: Namen;
}) {
  if (tage.length === 0) return null;
  const t = texte.stundennachweis;
  const r = texte.rechnungsvorbereitung;
  return (
    <>
      <h3>{t.ueberschrift}</h3>
      <table>
        <thead>
          <tr>
            <th>{t.spalteDatum}</th>
            <th>{r.spalteObjekt}</th>
            <th>{r.spalteZusatzauftrag}</th>
            <th>{r.spalteTaetigkeit}</th>
            <th>{r.spalteStunden}</th>
          </tr>
        </thead>
        <tbody>
          {tage.map((tag, i) => (
            <tr key={i}>
              <td>{datumAlsText(tag.datum)}</td>
              <td>{name(namen.objekte, tag.objektId)}</td>
              <td>
                {tag.zusatzauftragId === null
                  ? ""
                  : name(namen.zusatzauftraege, tag.zusatzauftragId)}
              </td>
              <td>{name(namen.taetigkeiten, tag.taetigkeitId)}</td>
              <td>{r.stunden(stundenAlsText(tag.minuten))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {t.hinweis} {/* Ein normaler Link: Die Datei kommt vom Server, nicht als Seite. */}
        <a href={href} download>
          {t.herunterladen}
        </a>
      </p>
    </>
  );
}
