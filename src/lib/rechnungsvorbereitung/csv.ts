// Die Rechnungsvorbereitung als CSV-Datei, die deutsches Excel direkt
// richtig öffnet: UTF-8 mit BOM (sonst zeigt Excel Umlaute falsch),
// Semikolon als Trennzeichen und Beträge als Kommazahl ohne Euro-Zeichen,
// damit Excel mit ihnen rechnen kann.
import { euroAlsEingabe } from "@/lib/geld";
import { texte } from "@/texte";
import { stundenAlsText, type Zeilen } from "./zeilen";

export function rechnungsCsv({ zeilen, summeCent }: Zeilen): string {
  const t = texte.rechnungsvorbereitung;
  const kopf = [
    t.spaltePosition,
    t.spalteObjekt,
    t.spalteZusatzauftrag,
    t.spalteTaetigkeit,
    t.spalteMonat,
    t.spalteStunden,
    t.spalteMinuten,
    t.spalteStundensatz,
    t.spalteBetrag,
  ];
  const zeilenAlsText = zeilen.map((z) => [
    text(z.position),
    text(z.objekt),
    text(z.zusatzauftrag),
    text(z.taetigkeit),
    text(z.monat),
    z.minuten === null ? "" : stundenAlsText(z.minuten),
    z.minuten === null ? "" : String(z.minuten),
    z.stundensatzCent === null ? "" : euroAlsEingabe(z.stundensatzCent),
    euroAlsEingabe(z.betragCent),
  ]);
  const summe = [t.summe, "", "", "", "", "", "", "", euroAlsEingabe(summeCent)];
  return "﻿" + [kopf, ...zeilenAlsText, summe].map((z) => z.join(";") + "\r\n").join("");
}

// Ein Text als Zelle. Was mit =, +, - oder @ beginnt, hielte Excel für eine
// Formel; ein vorangestelltes Hochkomma macht es zu Text. Trennzeichen,
// Anführungszeichen und Zeilenumbrüche stehen in Anführungszeichen.
function text(wert: string): string {
  const sicher = /^[=+\-@\t\r]/.test(wert) ? `'${wert}` : wert;
  return /[;"\r\n]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
}
