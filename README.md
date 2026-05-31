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
  API-Schlüssel wird **im Frontend eingegeben** und nur lokal im Browser
  gespeichert. Sehr große Bücher werden automatisch in Blöcke geteilt. Ohne
  Schlüssel werden Kapitel heuristisch geschätzt; jederzeit „Neu mit KI
  gliedern“ möglich.
- **Zwei Lesemodi**
  - **Buch**: angenehme Lesetypografie, Schriftgröße/Zeilenabstand einstellbar,
    Kapitelnavigation.
  - **Fokus (RSVP)**: ein Wort nach dem anderen in Vollbild, einstellbare
    **Wörter pro Minute (100–1000)**, farbiger Lese-Fixpunkt (ORP),
    **Leertaste = Pause**, Tippen/Tap-Zonen auf dem iPad, Pausen an Satzzeichen.
- **Vorlesen** (Web Speech API) in beiden Modi zuschaltbar, mit Stimmenauswahl,
  Tempo und Tonhöhe. In der Buchansicht wird der gerade gesprochene Satz
  hervorgehoben; im Fokus-Modus laufen Wortanzeige und Stimme synchron.
- **Bibliothek** mit lokaler Speicherung der Bücher (IndexedDB).
- **Warmes Design** mit drei Farbstimmungen (Warm, Sepia, Nacht).

## Tastatur & Touch im Fokus-Modus

| Aktion | Tastatur | Touch (iPad) |
| --- | --- | --- |
| Start / Pause | Leertaste | Mitte antippen |
| Ein Wort zurück / vor | ← / → | links / rechts antippen (±5) |
| Schneller / langsamer | ↑ / ↓ | Regler unten |
| Verlassen | Esc | ✕ oben links |

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver
npm run build      # Produktionsbuild nach dist/
npm run preview    # Build lokal ansehen
```

## Deployment auf Netlify

Das Repo enthält bereits `netlify.toml`:

- **Build command:** `npm run build`
- **Publish directory:** `dist`

Einfach das Repository in Netlify importieren – fertig. Es werden keine
Server-Funktionen und keine Umgebungsvariablen benötigt, da alles im Browser
läuft und der Gemini-Schlüssel im Frontend eingegeben wird.

> Hinweis: Da der API-Schlüssel im Browser verwendet wird, ist er für die App
> sichtbar. Verwende am besten einen Schlüssel mit eng gefassten
> Berechtigungen/Quoten. Er verlässt das Gerät nur in Anfragen direkt an Google.

## Einen Gemini-Schlüssel erstellen

Kostenlos unter <https://aistudio.google.com/app/apikey>. In der App oben
rechts unter **Einstellungen → Google Gemini** eintragen und „Prüfen“ drücken,
um die verfügbaren Modelle zu laden.

## Technik

Vite · React · TypeScript · pdf.js · Web Speech API · IndexedDB. Keine
Backend-Abhängigkeiten.
