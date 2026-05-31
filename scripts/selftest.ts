// Schnelltest der reinen Logik (ohne UI). Ausführen: npx tsx scripts/selftest.ts
import { orpIndex, tokenize, splitSentences, countWords } from '../src/lib/tokenize';
import { buildReadingModel, tokenAtChar } from '../src/lib/reading';
import {
  chaptersFromAiMarkers,
  heuristicChapters,
  findMarkerOffset,
  buildChaptersFromPoints,
  detectTocEnd,
} from '../src/lib/chapters';
import { reconstructPageText, cleanupText, looksLikeHeading } from '../src/lib/pdfText';
import { bookToMarkdown } from '../src/lib/export';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, info?: unknown) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ FEHLER:', name, info ?? '');
  }
}

// ----- ORP -----
check('orp len1', orpIndex('a') === 0);
check('orp len4', orpIndex('Haus') === 1);
check('orp len7', orpIndex('Beispie') === 2);
check('orp len12', orpIndex('Donaudampfe') === 3);
check('orp len20', orpIndex('Donaudampfschifffahrt') === 4);

// ----- Tokenize -----
const toks = tokenize('Hallo Welt. Dies ist ein Test, oder?');
check('token count', toks.length === 7, toks.length);
check('satzende delay', toks[1].delay > 1.5, toks[1]); // "Welt."
check('komma delay', toks[5].delay > 1.3 && toks[5].delay < 2, toks[5]); // "Test,"
check('offset steigend', toks[0].offset === 0 && toks[1].offset > 0);
check('countWords', countWords('eins zwei   drei\nvier') === 4);

// langes Wort wird gesplittet
const longTok = tokenize('x'.repeat(50));
check('langes wort gesplittet', longTok.length >= 2, longTok.length);

// ----- Sätze -----
const text = 'Erster Satz. Zweiter Satz!\n\nNeuer Absatz hier. Und noch einer?';
const sents = splitSentences(text);
check('satzanzahl', sents.length === 4, sents.map((s) => s.text));
check('satz offset korrekt', text.slice(sents[2].start, sents[2].start + 5) === 'Neuer', text.slice(sents[2].start, sents[2].start + 5));

// ----- Lesemodell: Token <-> Satz -----
const model = buildReadingModel(text, true);
check('modell tokens', model.tokens.length === countWords(text));
check('modell sätze', model.sentences.length === 4);
// erstes Token gehört zu Satz 0
check('token0 -> satz0', model.tokenToSentence[0] === 0);
// tokenAtChar: char 0 des dritten Satzes -> dessen erstes Token
const s2 = model.sentences[2];
check('tokenAtChar start', tokenAtChar(model, 2, 0) === s2.first, { got: tokenAtChar(model, 2, 0), first: s2.first });

// ----- KI-Marker -> Kapitel (Kapitel mit echtem, ausreichend langem Inhalt) -----
const vorwortBody = 'Dies sind einige einleitende Worte zum Buch und seinem Anliegen. '.repeat(8);
const dorfBody = 'Es war einmal ein kleines Dorf am Fluss, in dem zufriedene Menschen lebten. '.repeat(8);
const rueckBody = 'Viele Jahre später kehrte sie in das Dorf ihrer Kindheit zurück. '.repeat(8);
const book =
  'Vorwort\n' + vorwortBody + '\n\n' +
  'Kapitel 1\n' + dorfBody + '\n\n' +
  'Kapitel 2\n' + rueckBody;
const markers = [
  { title: 'Vorwort', start_marker: 'Dies sind einige einleitende Worte' },
  { title: 'Das Dorf', start_marker: 'Es war einmal ein kleines Dorf am Fluss' },
  { title: 'Rückkehr', start_marker: 'Viele Jahre später kehrte sie' },
];
const aiChapters = chaptersFromAiMarkers(book, markers);
check('ki kapitelanzahl', aiChapters.length === 3, aiChapters.map((c) => c.title));
check('ki kapitel2 titel', aiChapters[1].title === 'Das Dorf');
check('ki kapitel2 text', aiChapters[1].text.includes('kleines Dorf'));
check('ki kapitel3 text', aiChapters[2].text.includes('kehrte sie'));
// Lückenlose Abdeckung
check('ki abdeckung', aiChapters[0].start === 0 && aiChapters[2].end === book.length);

// Fuzzy: Marker mit abweichenden Leerzeichen
const offset = findMarkerOffset(
  // @ts-expect-error – interne Normalisierung wird hier direkt nachgebaut
  { norm: book.replace(/\s+/g, ' '), map: buildMap(book), lower: book.replace(/\s+/g, ' ').toLowerCase() },
  'Es   war  einmal',
);
check('fuzzy marker gefunden', offset > 0, offset);

// ----- Heuristik -----
const hChapters = heuristicChapters(book);
check('heuristik findet kapitel', hChapters.length >= 2, hChapters.map((c) => c.title));

// ----- Inhaltsverzeichnis wird übersprungen (Kernfix) -----
const tBody1 = 'Dies ist die wahre Einführung mit ausreichend Fließtext für einen Absatz. '.repeat(8);
const tBody2 = 'Das Hindernis bist du selbst und niemand sonst steht dir im Weg. '.repeat(8);
const tBody3 = 'Der Weg nach vorn beginnt mit einem einzigen mutigen Schritt. '.repeat(8);
const tocBook =
  'INHALTSVERZEICHNIS\n' +
  'EINFÜHRUNG\n' +
  '1 DAS HINDERNIS BIST DU SELBST\n' +
  '2 DER WEG NACH VORN\n' +
  '3 DAS ZIEL VOR AUGEN\n' +
  'NACHWORT\n' +
  'DANKSAGUNG\n' +
  '\n' +
  'Dieses Buch ist allen gewidmet, die den Mut haben, sich selbst ehrlich zu begegnen und Muster zu durchbrechen.\n\n' +
  'EINFÜHRUNG\n' + tBody1 + '\n\n' +
  '1 DAS HINDERNIS BIST DU SELBST\n' + tBody2 + '\n\n' +
  '2 DER WEG NACH VORN\n' + tBody3;

check('toc erkannt', detectTocEnd(tocBook) > 0, detectTocEnd(tocBook));
const tocMarkers = [
  { title: 'Einführung', start_marker: 'EINFÜHRUNG' },
  { title: 'Das Hindernis', start_marker: '1 DAS HINDERNIS BIST DU SELBST' },
  { title: 'Der Weg', start_marker: '2 DER WEG NACH VORN' },
];
const tocChapters = chaptersFromAiMarkers(tocBook, tocMarkers);
const hindernis = tocChapters.find((c) => c.title === 'Das Hindernis');
check('toc: hindernis-kapitel existiert', !!hindernis, tocChapters.map((c) => c.title));
check(
  'toc: hindernis hat echten inhalt (nicht TOC-slice)',
  !!hindernis && hindernis.text.includes('Das Hindernis bist du selbst und niemand') && hindernis.text.length > 400,
  hindernis?.text.length,
);
const tinyMid = tocChapters.slice(1, -1).filter((c) => c.text.length < 200);
check('toc: keine mini-slices in der mitte', tinyMid.length === 0, tinyMid.map((c) => c.title));

// buildChaptersFromPoints: sehr nahe Punkte werden verschmolzen
const pts = buildChaptersFromPoints('AAAA BBBB CCCC', [
  { title: 'A', offset: 0 },
  { title: 'B', offset: 5 },
  { title: 'C-zu-nah', offset: 30 },
]);
check('punkte gebaut', pts.length >= 1, pts.length);

// ----- PDF-Textaufbereitung -----
// reconstructPageText: Fragmente nach Position zu Zeilen zusammensetzen
const page = reconstructPageText({
  items: [
    // bewusst unsortiert übergeben
    { str: 'World', transform: [1, 0, 0, 1, 50, 700] },
    { str: 'Zweite Zeile', transform: [1, 0, 0, 1, 10, 670] },
    { str: 'Hello ', transform: [1, 0, 0, 1, 10, 700] },
  ],
});
check('reconstruct zeilen', page === 'Hello World\nZweite Zeile', JSON.stringify(page));

check('looksLikeHeading kapitel', looksLikeHeading('Kapitel 7'));
check('looksLikeHeading caps', looksLikeHeading('DAS GROSSE BUCH'));
check('looksLikeHeading kein satz', !looksLikeHeading('Dies ist ein ganz normaler Satz, der weitergeht und endet.'));

// cleanupText: Silbentrennung zusammenführen
check('dehyphen', cleanupText('ein lan-\nges Wort').includes('langes'), cleanupText('ein lan-\nges Wort'));

// cleanupText: Überschrift bleibt eigene Zeile, Fließtext getrennt
const cleaned = cleanupText('Kapitel 2\nDies ist der Beginn eines Kapitels mit genügend Länge hier.');
check('heading eigene zeile', /^Kapitel 2\n\n/.test(cleaned), JSON.stringify(cleaned));

// cleanupText: umgebrochene Zeile wird zusammengefügt
const wrapped = cleanupText(
  'Dies ist ein recht langer Satz der über mehrere\nZeilen umgebrochen wurde und zusammengehört.',
);
check('unwrap', !wrapped.includes('\n') && wrapped.includes('mehrere Zeilen'), JSON.stringify(wrapped));

// ----- Export -----
const md = bookToMarkdown({
  id: 'x',
  title: 'Mein Buch',
  author: 'Autorin',
  text: 'egal',
  chapters: [
    { id: 'a', title: 'Einführung', start: 0, end: 1, text: 'Der erste Absatz des Buches.' },
    { id: 'b', title: 'Das Hindernis', start: 1, end: 2, text: 'Hier steht der zweite Kapiteltext.' },
  ],
  pageCount: 10,
  wordCount: 1234,
  createdAt: 0,
  chapterSource: 'ki',
});
check('export titel', md.includes('# Mein Buch'));
check('export kapitelueberschriften', md.includes('## 1. Einführung') && md.includes('## 2. Das Hindernis'));
check('export inhalt', md.includes('zweite Kapiteltext') && md.includes('erste Absatz'));

function buildMap(t: string): number[] {
  // grobe Rückabbildung für den Test (gleiche Logik wie in chapters.ts)
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < t.length; i++) {
    if (/\s/.test(t[i])) {
      if (!prevSpace) {
        map.push(i);
        prevSpace = true;
      }
    } else {
      map.push(i);
      prevSpace = false;
    }
  }
  return map;
}

console.log(`\nSelbsttest: ${passed} bestanden, ${failed} fehlgeschlagen.`);
if (failed > 0) process.exit(1);
