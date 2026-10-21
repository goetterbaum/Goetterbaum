import { euroAlsText } from "@/lib/geld";
import { stundenAlsText, type Zeilen } from "@/lib/rechnungsvorbereitung/zeilen";
import { texte } from "@/texte";

// Die Positionen einer Rechnungsvorbereitung mit Summe. Alle Beträge
// kommen aus dem Rechenbaustein; hier wird nur angezeigt.
export function Positionen({ zeilen, summeCent }: Zeilen) {
  const t = texte.rechnungsvorbereitung;
  return (
    <table>
      <thead>
        <tr>
          <th>{t.spaltePosition}</th>
          <th>{t.spalteObjekt}</th>
          <th>{t.spalteZusatzauftrag}</th>
          <th>{t.spalteTaetigkeit}</th>
          <th>{t.spalteMonat}</th>
          <th>{t.spalteStunden}</th>
          <th>{t.spalteStundensatz}</th>
          <th>{t.spalteBetrag}</th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z, i) => (
          <tr key={i}>
            <td>{z.position}</td>
            <td>{z.objekt}</td>
            <td>{z.zusatzauftrag}</td>
            <td>{z.taetigkeit}</td>
            <td>{z.monat}</td>
            <td>{z.minuten === null ? "" : t.stunden(stundenAlsText(z.minuten))}</td>
            <td>{z.stundensatzCent === null ? "" : euroAlsText(z.stundensatzCent)}</td>
            <td>{euroAlsText(z.betragCent)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th colSpan={7}>{t.summe}</th>
          <td>{euroAlsText(summeCent)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
