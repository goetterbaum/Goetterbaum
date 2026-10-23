// CSV-Dateien, die deutsches Excel direkt richtig öffnet: UTF-8 mit BOM
// (sonst zeigt Excel Umlaute falsch), Semikolon als Trennzeichen und
// Windows-Zeilenenden.

// Die Zeilen als Inhalt einer CSV-Datei. Texte müssen schon mit csvText
// aufbereitet sein.
export function csvInhalt(zeilen: string[][]): string {
  return "﻿" + zeilen.map((z) => z.join(";") + "\r\n").join("");
}

// Ein Text als Zelle. Was mit =, +, - oder @ beginnt, hielte Excel für eine
// Formel; ein vorangestelltes Hochkomma macht es zu Text. Trennzeichen,
// Anführungszeichen und Zeilenumbrüche stehen in Anführungszeichen.
export function csvText(wert: string): string {
  const sicher = /^[=+\-@\t\r]/.test(wert) ? `'${wert}` : wert;
  return /[;"\r\n]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
}

// Die CSV-Datei als Antwort zum Herunterladen. einfacherName ist der Name
// ohne Umlaute für ältere Programme.
export function csvDatei(csv: string, dateiname: string, einfacherName: string): Response {
  // Zeichen, die in Dateinamen stören, werden ersetzt.
  const sicher = dateiname.replace(/[\/:*?"<>|\r\n]/g, "_");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Ältere Programme lesen nur den einfachen Namen, die anderen den
      // vollständigen mit Umlauten.
      "Content-Disposition": `attachment; filename="${einfacherName}"; filename*=UTF-8''${encodeURIComponent(sicher)}`,
      "Cache-Control": "no-store",
    },
  });
}
