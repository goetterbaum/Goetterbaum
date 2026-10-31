# Götterbaum

Management-Software für einen Gebäudereinigungs- und Gartenpflegebetrieb. Sie bildet die betrieblichen Abläufe ab, zuerst die objektbezogene Zeiterfassung als Grundlage für die Abrechnung.

## Betrieb und Personen

**Firma**:
Das Unternehmen, das die Software nutzt und Rechnungen stellt. Heute gibt es genau eine; perspektivisch sollen weitere, fremde Firmen die Software nutzen können.
_Avoid_: Mandant, Unternehmen, Betrieb

**Mitarbeiter**:
Eine Person, die für die Firma vor Ort arbeitet und Zeit erfasst.
_Avoid_: Angestellter, Kraft, User

**Vorarbeiter**:
Ein Mitarbeiter, der vor Ort eine Gruppe leitet und zusätzlich für jeden aktiven Mitarbeiter der Firma Zeit erfassen darf. Feste Gruppen gibt es in der Software nicht.
_Avoid_: Teamleiter, Kolonnenführer

**Büro**:
Die Rolle der Personen, die alles sehen, Stammdaten pflegen, Zeiteinträge freigeben und die Abrechnung vorbereiten. Umfasst vorerst auch die Geschäftsführung.
_Avoid_: Admin, Verwaltung, Chef

**Sparte**:
Der Geschäftsbereich einer Tätigkeit: Reinigung oder Garten. Ergibt sich immer aus der Tätigkeit, nicht aus dem Objekt.
_Avoid_: Bereich, Abteilung, Geschäftsfeld

## Kunden und Orte

**Kunde**:
Wer die Rechnung bekommt, z. B. eine Hausverwaltung oder ein Eigentümer.
_Avoid_: Auftraggeber, Klient

**Objekt**:
Ein bestimmter Arbeitsort mit Adresse, der zu genau einem Kunden gehört. Ein Kunde kann beliebig viele Objekte haben.
_Avoid_: Einsatzort, Liegenschaft, Standort

## Zeiterfassung

**Zeiteintrag**:
Ein ununterbrochener Zeitblock (von–bis) eines Mitarbeiters: entweder eine Tätigkeit in einem Objekt oder eine Fahrt. Pausen liegen zwischen zwei Zeiteinträgen. Zeiteinträge sind zugleich Arbeitszeitnachweis und Grundlage der Abrechnung.
_Avoid_: Buchung, Stempelung, Zeitbuchung

**Fahrt**:
Ein Zeiteintrag ohne Objekt für den Weg zwischen Arbeitsorten oder die Rückfahrt nach dem letzten Objekt. Zählt zur Arbeitszeit, wird aber nie einem Kunden berechnet.
_Avoid_: Fahrtzeit, Anfahrt, Wegezeit

**Arbeitstag**:
Die Arbeit eines Mitarbeiters vom ersten Zeiteintrag in einem Objekt bis „Arbeitstag beenden“, einschließlich der Fahrten und Pausen dazwischen. Die Anfahrt zum ersten Objekt gehört nicht dazu. Er zählt zum Kalendertag seines Beginns und gilt nach mehr als 12 Stunden ohne Zeiteintrag als beendet.
_Avoid_: Schicht, Dienst

**Pause**:
Eine Unterbrechung innerhalb eines Arbeitstags. Sie ist kein Zeiteintrag und zählt nicht zur Arbeitszeit.

**Arbeitszeitnachweis**:
Die gesetzlich vorgeschriebene Aufzeichnung der Arbeitszeit eines Mitarbeiters, gebildet aus seinen Zeiteinträgen einschließlich Fahrten.
_Avoid_: Stundenzettel, Arbeitszeitkonto

**Freigabe**:
Die Bestätigung eines Zeiteintrags durch das Büro. Danach kann der Mitarbeiter ihn nicht mehr ändern, und er fließt in die Abrechnung ein.
_Avoid_: Genehmigung, Abnahme

**Tätigkeit**:
Die Art der ausgeführten Arbeit aus einer von der Firma gepflegten festen Liste, z. B. Unterhaltsreinigung, Glasreinigung, Rasenmähen.
_Avoid_: Leistung, Aufgabe, Service

**Live-Erfassung**:
Ein Zeiteintrag, der vor Ort per Start und Stopp entsteht. Der Normalfall.

**Unvollständiger Zeiteintrag**:
Ein Zeiteintrag, der seit mehr als 12 Stunden läuft, weil der Stopp vergessen wurde. Ergibt sich aus der Laufzeit und wird nicht gespeichert. Er wird nie automatisch beendet, sondern durch Angabe des richtigen Endes korrigiert und ist danach ein Nachtrag. Das Büro sieht alle auf der Prüfliste.
_Avoid_: offener Eintrag, hängender Eintrag

**Nachtrag**:
Ein Zeiteintrag, der nachträglich eingetragen oder geändert wurde und deshalb sichtbar als solcher markiert ist.
_Avoid_: Korrektur, manuelle Buchung

## Abrechnung

**Abrechnungsart**:
Ob die regelmäßige Arbeit in einem Objekt per Pauschale oder per Stundenabrechnung berechnet wird. Legt das Büro je Objekt fest.

**Pauschale**:
Ein fester Monatsbetrag für die regelmäßige Arbeit in einem Objekt, unabhängig von der tatsächlich erfassten Zeit.
_Avoid_: Festpreis, Flatrate

**Stundenabrechnung**:
Abrechnung nach erfasster Zeit mal Stundensatz.
_Avoid_: Regieabrechnung, Aufwandsabrechnung

**Stundensatz**:
Der Preis pro Stunde einer Tätigkeit. Gilt standardmäßig für alle Kunden und kann für einzelne Kunden, darunter für einzelne Objekte, abweichen. Ein Zusatzauftrag nach Stunden kann einen eigenen Satz für alle seine Tätigkeiten haben. Es gilt der speziellste: Zusatzauftrag, dann Objekt, dann Kunde, dann Standard.
_Avoid_: Stundenpreis, Verrechnungssatz

**Rundungsregel**:
Wie erfasste Minuten für die Stundenabrechnung gerundet werden, z. B. minutengenau oder auf angefangene 15 Minuten. Die Firma legt einen Standard fest, der je Kunde abweichen kann. Gerundet wird die Summe je Objekt, Tätigkeit (bzw. Zusatzauftrag) und Kalendertag.
_Avoid_: Taktung, Abrechnungstakt

**Stundennachweis**:
Eine Einzelaufstellung der berechneten Stunden (Datum, Objekt, Tätigkeit, Dauer, Anzahl Personen) für einen Kunden. Der Kunde bekommt ihn nur auf Nachfrage; das Büro sieht ihn in der Rechnungsvorbereitung immer unter den Positionen. Er nennt keine Mitarbeiternamen.
_Avoid_: Leistungsnachweis, Regiebericht

**Zusatzauftrag**:
Eine vom Büro angelegte Arbeit in einem Objekt mit eigener Abrechnungsart (Stunden oder Festbetrag), abweichend von der des Objekts, z. B. ein Sturmschaden in einem Pauschal-Objekt. Kann nach Erledigung sofort einzeln abgerechnet werden, nach Stunden erst, wenn alle seine Zeiteinträge freigegeben sind.
_Avoid_: Sonderauftrag, Extraarbeit, Regiearbeit

**Festbetrag**:
Ein einmaliger fester Preis für einen Zusatzauftrag, unabhängig von der erfassten Zeit.
_Avoid_: Pauschale (die ist monatlich und gehört zum Objekt), Festpreis

**Abrechnungszeitraum**:
Der Rhythmus, in dem die Arbeit eines Kunden gesammelt abgerechnet wird: monatlich oder quartalsweise, festgelegt je Kunde.
_Avoid_: Abrechnungsperiode, Rechnungszeitraum

**Rechnungsvorbereitung**:
Die Zusammenstellung aller abzurechnenden Pauschalen, Stunden und Zusatzaufträge eines Kunden für einen Zeitraum als Grundlage der Rechnung. Was darin abgerechnet wurde, wird nicht erneut berechnet.
_Avoid_: Rechnungsentwurf, Abrechnungsliste

**Abrechnung**:
Eine als abgerechnet markierte Rechnungsvorbereitung: Kunde, Zeitraum (bei einem einzeln abgerechneten Zusatzauftrag stattdessen dieser), Positionen und Summe, wann und von wem, dazu die umfassten Zeiteinträge, Pauschal-Monate und Zusatzaufträge mit Festbetrag. Diese sind danach für alle gesperrt und erscheinen in keiner weiteren Rechnungsvorbereitung. Das Büro kann eine Abrechnung nach Rückfrage zurücknehmen; sie bleibt dann als zurückgenommen stehen, und ihr Inhalt ist wieder abrechenbar.
_Avoid_: Rechnung (die schreibt das Büro in DATEV), Abschluss
