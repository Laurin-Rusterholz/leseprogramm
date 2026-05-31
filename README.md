# 📖 Leseprogramm

Eine warme, ruhige Web-App zum Lesen ganzer Bücher aus **PDFs** – klassisch
als Buch oder Wort für Wort im **Fokus-Modus** (RSVP), mit
**Kapitel-Einteilung durch Google Gemini** und **Vorlese-Funktion**.
Optimiert für das **iPad**, läuft vollständig im Browser und ist ideal für
**Netlify**.

## Funktionen

- **PDF-Upload & Textextraktion** direkt im Browser (pdf.js) – auch für ganze
  Bücher, mit Rekonstruktion von Zeilen/Absätzen und Zusammenfügen getrennter
  Wörter.
- **Kapitel per KI**: Google Gemini gliedert das Buch in Kapitel. Der
  API-Schlüssel wird **im Frontend eingegeben**. Sehr große Bücher werden
  automatisch in Blöcke geteilt. Ohne Schlüssel werden Kapitel heuristisch
  geschätzt; jederzeit „Neu mit KI gliedern“ möglich.
- **Zwei Lesemodi**
  - **Buch**: angenehme Lesetypografie, Schriftgröße/Zeilenabstand einstellbar,
    Kapitelnavigation.
  - **Fokus (RSVP)**: ein Wort nach dem anderen in Vollbild, einstellbare
    **Wörter pro Minute (100–1000)**, farbiger Lese-Fixpunkt (ORP),
    **Leertaste = Pause**, Tippen/Tap-Zonen auf dem iPad, Pausen an Satzzeichen.
- **Vorlesen** (Web Speech API) in beiden Modi zuschaltbar, mit Stimmenauswahl,
  Tempo und Tonhöhe. In der Buchansicht wird der gerade gesprochene Satz
  hervorgehoben; im Fokus-Modus laufen Wortanzeige und Stimme synchron.
- **Speicherung auf Netlify Blobs**: Bücher **und** Einstellungen (inkl.
  API-Schlüssel) werden über Netlify Functions auf **Netlify Blobs** abgelegt –
  also serverseitig und damit geräteübergreifend verfügbar. Ist die Function-API
  nicht erreichbar (z. B. reines `vite dev`), wird transparent auf lokalen
  Speicher (IndexedDB/localStorage) zurückgegriffen. Oben rechts zeigt ein
  Symbol den aktiven Modus an (☁︎ Netlify / ⌂ Lokal).
- **Warmes Design** mit drei Farbstimmungen (Warm, Sepia, Nacht).

## Tastatur & Touch im Fokus-Modus

| Aktion | Tastatur | Touch (iPad) |
| --- | --- | --- |
| Start / Pause | Leertaste | Mitte antippen |
| Ein Wort zurück / vor | ← / → | links / rechts antippen (±5) |
| Schneller / langsamer | ↑ / ↓ | Regler unten |
| Verlassen | Esc | ✕ oben links |

## Speicherung (Netlify Blobs)

Die App spricht zwei Netlify Functions an, die [Netlify Blobs](https://docs.netlify.com/blobs/overview/)
als Speicher nutzen:

- `netlify/functions/books.mts` → `/api/books` (Liste, einzelnes Buch, Speichern,
  Fortschritt-Update, Löschen)
- `netlify/functions/settings.mts` → `/api/settings` (Einstellungen inkl. API-Key)

Der Buchtext wird getrennt von einem schlanken Index gespeichert, sodass beim
Mitschreiben des Lesefortschritts nicht jedes Mal das ganze Buch übertragen wird.
Netlify Blobs ist auf Netlify **ohne weitere Konfiguration** aktiv.

> **Sicherheitshinweis:** Diese Variante hat **keinen Zugriffsschutz** – wer die
> Seiten-URL kennt, kann die Bibliothek (und den dort abgelegten API-Schlüssel)
> über `/api/...` lesen und ändern. Für eine private Nutzung empfiehlt sich ein
> Passwortschutz (z. B. Netlify-Umgebungsvariable + Prüfung in den Functions)
> oder Netlify Identity. Sag Bescheid, dann rüste ich das nach.

## Entwicklung

```bash
npm install
npm run dev        # nur Frontend (Vite) – Speicher fällt auf lokal zurück
npm run build      # Produktionsbuild nach dist/
npm test           # Logik- und Function-Tests

# Mit Netlify Blobs/Functions lokal (empfohlen zum vollständigen Testen):
npm i -g netlify-cli
netlify dev        # startet Vite + Functions + lokalen Blobs-Sandbox
```

## Deployment auf Netlify

Das Repo enthält bereits `netlify.toml` (Build, Publish, Functions-Verzeichnis
und `/api`-Routing):

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Functions:** `netlify/functions`

Repository in Netlify importieren – fertig. Netlify Blobs ist automatisch
verfügbar; es sind keine Umgebungsvariablen nötig.

> Hinweis zum API-Schlüssel: Er wird im Frontend eingegeben, auf Blobs
> gespeichert und für Anfragen direkt an Google verwendet. Nutze am besten einen
> Schlüssel mit eng gefassten Berechtigungen/Quoten.

## Einen Gemini-Schlüssel erstellen

Kostenlos unter <https://aistudio.google.com/app/apikey>. In der App oben
rechts unter **Einstellungen → Google Gemini** eintragen und „Prüfen“ drücken,
um die verfügbaren Modelle zu laden.

## Technik

Vite · React · TypeScript · pdf.js · Web Speech API · Netlify Functions ·
Netlify Blobs (mit IndexedDB/localStorage als lokalem Fallback).
