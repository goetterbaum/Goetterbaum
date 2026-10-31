// Kalendertage in der Zeitzone Europe/Berlin, die für Tagesgrenzen der
// Firma gilt (Rundung je Tag, Arbeitszeitnachweis). Nutzt nur die in
// Node und Browser eingebaute Zeitzonen-Unterstützung (Intl).

const berlinerUhr = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Die Uhrzeit in Berlin zu einem Zeitpunkt (ms seit 1970), als Zahlen.
function berlinerZeit(zeitpunkt: number) {
  const teile = Object.fromEntries(
    berlinerUhr.formatToParts(zeitpunkt).map((t) => [t.type, Number(t.value)]),
  );
  return teile as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

// Ein Datum (UTC-Mitternacht) als "JJJJ-MM-TT".
function alsDatum(jahr: number, monat: number, tag: number): string {
  return new Date(Date.UTC(jahr, monat - 1, tag)).toISOString().slice(0, 10);
}

// Kalendertag in Berlin als "JJJJ-MM-TT".
export function berlinerDatum(zeitpunkt: number): string {
  const { year, month, day } = berlinerZeit(zeitpunkt);
  return alsDatum(year, month, day);
}

// Wie weit Berlin zu einem Zeitpunkt der UTC-Zeit voraus ist, in ms.
function berlinerVersatz(zeitpunkt: number): number {
  const t = berlinerZeit(zeitpunkt);
  const alsUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  return alsUtc - Math.floor(zeitpunkt / 1000) * 1000;
}

// Der Zeitpunkt zur Uhrzeit "HH:MM" am Tag "JJJJ-MM-TT" in Berlin. Eine
// Uhrzeit, die es wegen der Zeitumstellung zweimal gibt, gilt beim zweiten
// Mal (Winterzeit).
export function berlinerZeitpunkt(datum: string, uhrzeit: string): number {
  const alsUtc = Date.parse(`${datum}T${uhrzeit}:00Z`);
  return alsUtc - berlinerVersatz(alsUtc - berlinerVersatz(alsUtc));
}

// Der Zeitpunkt, zu dem in Berlin der Tag "JJJJ-MM-TT" beginnt. Der
// Wechsel zwischen Sommer- und Winterzeit liegt nie auf Mitternacht.
export function berlinerMitternacht(datum: string): number {
  return berlinerZeitpunkt(datum, "00:00");
}

// Die Uhrzeit in Berlin als "HH:MM".
export function berlinerUhrzeit(zeitpunkt: number): string {
  const { hour, minute } = berlinerZeit(zeitpunkt);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Teilt die Zeit von beginn bis ende an den Mitternachtsgrenzen in
// Berlin auf: je Kalendertag die Dauer in ms.
export function aufBerlinerTageVerteilt(
  beginn: number,
  ende: number,
): { datum: string; ms: number }[] {
  const stuecke: { datum: string; ms: number }[] = [];
  let von = beginn;
  while (von < ende) {
    const datum = berlinerDatum(von);
    const [jahr, monat, tag] = datum.split("-").map(Number);
    const bis = Math.min(ende, berlinerMitternacht(alsDatum(jahr, monat, tag + 1)));
    stuecke.push({ datum, ms: bis - von });
    von = bis;
  }
  return stuecke;
}

// Ein Kalendertag "JJJJ-MM-TT" als deutsches Datum "TT.MM.JJJJ".
export function datumAlsText(datum: string): string {
  const [jahr, monat, tag] = datum.split("-");
  return `${tag}.${monat}.${jahr}`;
}

// Der Tag "JJJJ-MM-TT", der `tage` Tage vor (negativ) oder nach `datum`
// liegt.
export function tagVerschoben(datum: string, tage: number): string {
  const [jahr, monat, tag] = datum.split("-").map(Number);
  return alsDatum(jahr, monat, tag + tage);
}

// Der heutige Tag in Berlin als "JJJJ-MM-TT".
export function heuteInBerlin(): string {
  return berlinerDatum(Date.now());
}
