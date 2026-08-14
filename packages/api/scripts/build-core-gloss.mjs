// Regenerates packages/api/assets/dict-core-gloss.tsv — the curated
// high-frequency German→English core used for instant offline glosses. This is
// hand-authored content (no external data); the TSV asset is the source of
// truth and can also be edited directly. To regenerate from this script:
//   node packages/api/scripts/build-core-gloss.mjs
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Curated high-frequency German -> English core. [lemma, pos, gloss]
// pos: verb | noun | adj | adv | prep | conj | pron | det | num | interj
const E = [];
const g = (pos) => (arr) => arr.forEach(([l, gl]) => E.push([l, pos, gl]));

// --- pronouns & determiners ---
g("pron")([
  ["ich","I"],["du","you (informal)"],["er","he"],["sie","she; they"],["es","it"],
  ["wir","we"],["ihr","you (pl. informal)"],["Sie","you (formal)"],["man","one; you (impersonal)"],
  ["mich","me"],["mir","(to) me"],["dich","you"],["dir","(to) you"],["uns","us"],["euch","you (pl.)"],
  ["ihm","(to) him/it"],["ihn","him"],["ihnen","(to) them"],["wer","who"],["was","what"],
  ["etwas","something"],["nichts","nothing"],["jemand","someone"],["niemand","no one"],
  ["alle","all; everyone"],["alles","everything"],["jeder","each; everyone"],["manche","some"],
  ["einige","a few; some"],["viele","many"],["wenige","few"],["beide","both"],
  ["dieser","this"],["diese","this; these"],["dieses","this"],["welcher","which"],["selbst","oneself; even"],
]);
g("det")([
  ["der","the (m.)"],["die","the (f./pl.)"],["das","the (n.)"],["ein","a; one"],["eine","a; one"],
  ["kein","no; not a"],["keine","no; not any"],["mein","my"],["dein","your"],["sein","his; its"],
  ["unser","our"],["euer","your (pl.)"],["jede","each; every"],["jedes","each; every"],
]);

// --- prepositions ---
g("prep")([
  ["in","in; into"],["auf","on; onto"],["an","at; on"],["mit","with"],["nach","after; to"],
  ["aus","out of; from"],["zu","to"],["von","from; of"],["bei","at; near; with"],["über","over; about"],
  ["unter","under; among"],["vor","in front of; before"],["hinter","behind"],["neben","next to"],
  ["zwischen","between"],["für","for"],["gegen","against"],["ohne","without"],["um","around; at (time)"],
  ["durch","through"],["bis","until; up to"],["seit","since; for"],["während","during"],["wegen","because of"],
  ["trotz","despite"],["gegenüber","opposite; across from"],["ab","from; starting"],["außer","except; besides"],
  ["innerhalb","within"],["außerhalb","outside of"],["entlang","along"],["statt","instead of"],
]);

// --- conjunctions & subjunctions ---
g("conj")([
  ["und","and"],["oder","or"],["aber","but"],["denn","because; for"],["sondern","but rather"],
  ["weil","because"],["dass","that"],["wenn","if; when"],["als","when; than; as"],["ob","whether"],
  ["damit","so that"],["obwohl","although"],["bevor","before"],["nachdem","after"],["sobald","as soon as"],
  ["solange","as long as"],["bis","until"],["sowie","as well as"],["sowohl","both ... and"],
  ["entweder","either"],["weder","neither"],["falls","in case; if"],["indem","by (doing)"],["dennoch","nevertheless"],
]);

// --- question words ---
g("adv")([
  ["wo","where"],["wann","when"],["warum","why"],["wieso","why"],["weshalb","why"],["wie","how; as"],
  ["wohin","where to"],["woher","where from"],["wieviel","how much"],["wieviele","how many"],["wozu","what for"],
]);

// --- adverbs & particles ---
g("adv")([
  ["nicht","not"],["auch","also; too"],["nur","only"],["schon","already"],["noch","still; yet"],
  ["immer","always"],["oft","often"],["manchmal","sometimes"],["selten","rarely"],["nie","never"],
  ["hier","here"],["da","there; then"],["dort","there"],["heute","today"],["morgen","tomorrow"],
  ["gestern","yesterday"],["jetzt","now"],["dann","then"],["danach","afterwards"],["zuerst","first"],
  ["endlich","finally"],["sofort","immediately"],["gerade","just; right now"],["bald","soon"],["früher","earlier"],
  ["später","later"],["sehr","very"],["gern","gladly; (to like to)"],["vielleicht","maybe"],["wirklich","really"],
  ["natürlich","of course"],["wieder","again"],["zusammen","together"],["allein","alone"],["genug","enough"],
  ["fast","almost"],["ziemlich","quite; fairly"],["besonders","especially"],["ungefähr","approximately"],
  ["etwa","about; roughly"],["mehr","more"],["weniger","less"],["genau","exactly"],["leider","unfortunately"],
  ["hoffentlich","hopefully"],["übrigens","by the way"],["deshalb","therefore"],["deswegen","for that reason"],
  ["trotzdem","nevertheless"],["also","so; thus"],["eigentlich","actually"],["sogar","even"],["ebenfalls","likewise"],
  ["außerdem","besides; moreover"],["nämlich","namely; you see"],["zwar","admittedly"],["links","left"],
  ["rechts","right"],["oben","above; up"],["unten","below; down"],["draußen","outside"],["drinnen","inside"],
  ["überall","everywhere"],["irgendwo","somewhere"],["nirgends","nowhere"],["ganz","completely; quite"],
  ["ja","yes"],["nein","no"],["doch","yes (contradicting); after all"],["bitte","please"],["danke","thank you"],
]);

// --- numbers ---
g("num")([
  ["null","zero"],["eins","one"],["zwei","two"],["drei","three"],["vier","four"],["fünf","five"],
  ["sechs","six"],["sieben","seven"],["acht","eight"],["neun","nine"],["zehn","ten"],["elf","eleven"],
  ["zwölf","twelve"],["dreizehn","thirteen"],["zwanzig","twenty"],["dreißig","thirty"],["vierzig","forty"],
  ["fünfzig","fifty"],["hundert","hundred"],["tausend","thousand"],["Million","million"],
  ["erste","first"],["zweite","second"],["dritte","third"],["letzte","last"],["halb","half"],
]);

// --- days, months, seasons ---
g("noun")([
  ["Montag","Monday"],["Dienstag","Tuesday"],["Mittwoch","Wednesday"],["Donnerstag","Thursday"],
  ["Freitag","Friday"],["Samstag","Saturday"],["Sonntag","Sunday"],["Wochenende","weekend"],
  ["Januar","January"],["Februar","February"],["März","March"],["April","April"],["Mai","May"],
  ["Juni","June"],["Juli","July"],["August","August"],["September","September"],["Oktober","October"],
  ["November","November"],["Dezember","December"],
  ["Frühling","spring"],["Sommer","summer"],["Herbst","autumn; fall"],["Winter","winter"],
]);

// --- colors ---
g("adj")([
  ["rot","red"],["blau","blue"],["grün","green"],["gelb","yellow"],["schwarz","black"],["weiß","white"],
  ["braun","brown"],["grau","grey"],["rosa","pink"],["orange","orange"],["lila","purple"],["bunt","colorful"],
]);

// --- modal & top verbs ---
g("verb")([
  ["sein","to be"],["haben","to have"],["werden","to become; will"],["können","can; to be able to"],
  ["müssen","must; to have to"],["wollen","to want"],["sollen","should; to be supposed to"],
  ["dürfen","may; to be allowed to"],["mögen","to like"],["machen","to do; to make"],["tun","to do"],
  ["gehen","to go; to walk"],["kommen","to come"],["sehen","to see"],["geben","to give"],["nehmen","to take"],
  ["finden","to find"],["denken","to think"],["glauben","to believe"],["wissen","to know (a fact)"],
  ["kennen","to know (be familiar with)"],["sagen","to say"],["sprechen","to speak"],["reden","to talk"],
  ["fragen","to ask"],["antworten","to answer"],["erzählen","to tell; to recount"],["erklären","to explain"],
  ["lernen","to learn"],["studieren","to study"],["arbeiten","to work"],["wohnen","to live; to reside"],
  ["leben","to live"],["lieben","to love"],["mögen","to like"],["hassen","to hate"],["essen","to eat"],
  ["trinken","to drink"],["schlafen","to sleep"],["aufstehen","to get up"],["kaufen","to buy"],
  ["verkaufen","to sell"],["bezahlen","to pay"],["kosten","to cost"],["fahren","to drive; to go (by vehicle)"],
  ["laufen","to run; to walk"],["fliegen","to fly"],["reisen","to travel"],["spielen","to play"],
  ["lesen","to read"],["schreiben","to write"],["hören","to hear; to listen"],["verstehen","to understand"],
  ["brauchen","to need"],["bleiben","to stay"],["bringen","to bring"],["holen","to fetch; to get"],
  ["tragen","to carry; to wear"],["setzen","to set; to put"],["stellen","to place; to put (upright)"],
  ["legen","to lay; to put (down)"],["stehen","to stand"],["liegen","to lie; to be located"],["sitzen","to sit"],
  ["öffnen","to open"],["schließen","to close"],["beginnen","to begin"],["anfangen","to start"],
  ["aufhören","to stop; to cease"],["enden","to end"],["helfen","to help"],["danken","to thank"],
  ["warten","to wait"],["suchen","to search; to look for"],["treffen","to meet"],["besuchen","to visit"],
  ["putzen","to clean"],["waschen","to wash"],["kochen","to cook"],["backen","to bake"],["kämmen","to comb"],
  ["anziehen","to put on; to dress"],["ausziehen","to take off; to move out"],["ansehen","to look at; to watch"],
  ["vorstellen","to introduce; to imagine"],["erinnern","to remind; (sich) to remember"],
  ["freuen","(sich) to be glad; to look forward"],["beeilen","(sich) to hurry"],["setzen","to sit down; to set"],
  ["fühlen","to feel"],["denken","to think"],["meinen","to mean; to think"],["zeigen","to show"],
  ["benutzen","to use"],["gebrauchen","to use"],["versuchen","to try"],["schaffen","to manage; to create"],
  ["gewinnen","to win"],["verlieren","to lose"],["vergessen","to forget"],["erinnern","to remember"],
  ["ändern","to change"],["wechseln","to change; to switch"],["entscheiden","to decide"],["wählen","to choose; to vote"],
  ["gefallen","to please; to be liked"],["passen","to fit; to suit"],["gehören","to belong"],["bedeuten","to mean"],
  ["heißen","to be called"],["nennen","to name; to call"],["fühlen","to feel"],["lachen","to laugh"],
  ["weinen","to cry"],["lächeln","to smile"],["rufen","to call; to shout"],["telefonieren","to phone"],
  ["schicken","to send"],["senden","to send"],["bekommen","to get; to receive"],["erhalten","to receive"],
  ["mitkommen","to come along"],["mitbringen","to bring along"],["einkaufen","to shop"],["fernsehen","to watch TV"],
  ["ankommen","to arrive"],["abfahren","to depart"],["umsteigen","to change (trains)"],["einsteigen","to get in/on"],
  ["aussteigen","to get off/out"],["aufmachen","to open"],["zumachen","to close"],["anrufen","to call (phone)"],
  ["aufpassen","to pay attention; to watch out"],["vorbereiten","to prepare"],["wiederholen","to repeat"],
  ["üben","to practice"],["erlauben","to allow"],["verbieten","to forbid"],["versprechen","to promise"],
  ["schwimmen","to swim"],["tanzen","to dance"],["singen","to sing"],["malen","to paint"],["zeichnen","to draw"],
  ["rauchen","to smoke"],["regnen","to rain"],["schneien","to snow"],["scheinen","to shine; to seem"],
]);

// --- nouns ---
g("noun")([
  ["Mann","man"],["Frau","woman; wife"],["Kind","child"],["Mensch","human; person"],["Leute","people"],
  ["Person","person"],["Familie","family"],["Freund","friend (m.)"],["Freundin","friend (f.); girlfriend"],
  ["Eltern","parents"],["Vater","father"],["Mutter","mother"],["Sohn","son"],["Tochter","daughter"],
  ["Bruder","brother"],["Schwester","sister"],["Großvater","grandfather"],["Großmutter","grandmother"],
  ["Baby","baby"],["Junge","boy"],["Mädchen","girl"],["Name","name"],["Haus","house"],["Wohnung","apartment"],
  ["Zimmer","room"],["Küche","kitchen"],["Bad","bathroom"],["Tür","door"],["Fenster","window"],["Wand","wall"],
  ["Boden","floor; ground"],["Tisch","table"],["Stuhl","chair"],["Bett","bed"],["Schrank","cupboard; wardrobe"],
  ["Lampe","lamp"],["Auto","car"],["Zug","train"],["Bus","bus"],["Bahn","train; tram"],["Fahrrad","bicycle"],
  ["Flugzeug","airplane"],["Straße","street"],["Weg","way; path"],["Platz","place; square"],["Stadt","city"],
  ["Dorf","village"],["Land","country; countryside"],["Welt","world"],["Ort","place"],["Gegend","area; region"],
  ["Zeit","time"],["Tag","day"],["Woche","week"],["Monat","month"],["Jahr","year"],["Stunde","hour"],
  ["Minute","minute"],["Sekunde","second"],["Morgen","morning"],["Mittag","noon"],["Abend","evening"],
  ["Nacht","night"],["Uhr","clock; o'clock"],["Wasser","water"],["Brot","bread"],["Milch","milk"],
  ["Kaffee","coffee"],["Tee","tea"],["Bier","beer"],["Wein","wine"],["Saft","juice"],["Ei","egg"],
  ["Fleisch","meat"],["Fisch","fish"],["Obst","fruit"],["Gemüse","vegetables"],["Apfel","apple"],
  ["Käse","cheese"],["Zucker","sugar"],["Salz","salt"],["Essen","food; meal"],["Frühstück","breakfast"],
  ["Mittagessen","lunch"],["Abendessen","dinner"],["Geld","money"],["Preis","price"],["Euro","euro"],
  ["Arbeit","work; job"],["Beruf","profession"],["Büro","office"],["Firma","company"],["Chef","boss"],
  ["Schule","school"],["Universität","university"],["Lehrer","teacher"],["Schüler","pupil"],["Student","student"],
  ["Klasse","class"],["Buch","book"],["Heft","notebook"],["Zeitung","newspaper"],["Brief","letter"],
  ["Sprache","language"],["Wort","word"],["Satz","sentence"],["Frage","question"],["Antwort","answer"],
  ["Problem","problem"],["Beispiel","example"],["Idee","idea"],["Grund","reason"],["Sache","thing; matter"],
  ["Ding","thing"],["Teil","part"],["Art","kind; way"],["Hand","hand"],["Kopf","head"],["Auge","eye"],
  ["Ohr","ear"],["Nase","nose"],["Mund","mouth"],["Zahn","tooth"],["Haar","hair"],["Herz","heart"],
  ["Körper","body"],["Gesicht","face"],["Fuß","foot"],["Bein","leg"],["Arm","arm"],["Finger","finger"],
  ["Rücken","back"],["Bauch","stomach; belly"],["Hund","dog"],["Katze","cat"],["Vogel","bird"],["Pferd","horse"],
  ["Tier","animal"],["Baum","tree"],["Blume","flower"],["Wald","forest"],["Berg","mountain"],["See","lake; (der) sea"],
  ["Meer","sea"],["Fluss","river"],["Himmel","sky"],["Sonne","sun"],["Mond","moon"],["Stern","star"],
  ["Regen","rain"],["Schnee","snow"],["Wind","wind"],["Wetter","weather"],["Farbe","color"],["Musik","music"],
  ["Film","film; movie"],["Spiel","game"],["Sport","sport"],["Ball","ball"],["Party","party"],["Fest","celebration"],
  ["Geschenk","gift"],["Bild","picture"],["Foto","photo"],["Telefon","telephone"],["Handy","mobile phone"],
  ["Computer","computer"],["Internet","internet"],["Kleidung","clothing"],["Hemd","shirt"],["Hose","trousers"],
  ["Jacke","jacket"],["Mantel","coat"],["Schuh","shoe"],["Kleid","dress"],["Hut","hat"],["Tasche","bag; pocket"],
  ["Geschichte","story; history"],["Leben","life"],["Liebe","love"],["Glück","luck; happiness"],["Angst","fear"],
  ["Gefühl","feeling"],["Gesundheit","health"],["Krankheit","illness"],["Arzt","doctor"],["Krankenhaus","hospital"],
  ["Apotheke","pharmacy"],["Geschäft","shop; business"],["Laden","shop"],["Markt","market"],["Restaurant","restaurant"],
  ["Hotel","hotel"],["Bank","bank; bench"],["Post","post office; mail"],["Kirche","church"],["Museum","museum"],
  ["Kino","cinema"],["Theater","theatre"],["Garten","garden"],["Park","park"],["Urlaub","holiday; vacation"],
  ["Reise","trip; journey"],["Ferien","school holidays"],["Termin","appointment"],["Uhrzeit","time (of day)"],
  ["Nummer","number"],["Adresse","address"],["Grad","degree"],["Seite","side; page"],["Ende","end"],["Anfang","beginning"],
]);

// --- adjectives ---
g("adj")([
  ["gut","good"],["schlecht","bad"],["groß","big; tall"],["klein","small"],["neu","new"],["alt","old"],
  ["jung","young"],["lang","long"],["kurz","short"],["hoch","high; tall"],["tief","deep; low"],["breit","wide"],
  ["schmal","narrow"],["dick","thick; fat"],["dünn","thin"],["schnell","fast"],["langsam","slow"],
  ["schön","beautiful; nice"],["hässlich","ugly"],["teuer","expensive"],["billig","cheap"],["günstig","cheap; favorable"],
  ["reich","rich"],["arm","poor"],["warm","warm"],["kalt","cold"],["heiß","hot"],["kühl","cool"],
  ["hell","bright; light"],["dunkel","dark"],["leicht","easy; light"],["schwer","heavy; difficult"],
  ["einfach","simple; easy"],["schwierig","difficult"],["kompliziert","complicated"],["richtig","correct; right"],
  ["falsch","wrong; false"],["wichtig","important"],["interessant","interesting"],["langweilig","boring"],
  ["spannend","exciting"],["lustig","funny"],["ernst","serious"],["glücklich","happy"],["traurig","sad"],
  ["müde","tired"],["wach","awake"],["hungrig","hungry"],["durstig","thirsty"],["satt","full (not hungry)"],
  ["krank","sick"],["gesund","healthy"],["froh","glad"],["böse","angry; evil"],["nett","nice"],
  ["freundlich","friendly"],["höflich","polite"],["stark","strong"],["schwach","weak"],["voll","full"],
  ["leer","empty"],["sauber","clean"],["schmutzig","dirty"],["nass","wet"],["trocken","dry"],["früh","early"],
  ["spät","late"],["nah","near; close"],["weit","far; wide"],["gleich","same; equal"],["verschieden","different"],
  ["ähnlich","similar"],["andere","other"],["nächste","next"],["letzte","last"],["ganze","whole"],
  ["frei","free"],["besetzt","occupied; taken"],["offen","open"],["geschlossen","closed"],["fertig","ready; finished"],
  ["bereit","ready"],["möglich","possible"],["unmöglich","impossible"],["nötig","necessary"],["klar","clear"],
  ["sicher","safe; sure"],["gefährlich","dangerous"],["ruhig","quiet; calm"],["laut","loud"],["leise","quiet; soft"],
  ["bekannt","known; famous"],["berühmt","famous"],["modern","modern"],["normal","normal"],["typisch","typical"],
  ["echt","real; genuine"],["falsch","fake; wrong"],["wahr","true"],["fein","fine"],["genau","exact; precise"],
  ["wunderbar","wonderful"],["toll","great"],["super","great"],["prima","great"],["schrecklich","terrible"],
  ["furchtbar","awful"],["angenehm","pleasant"],["bequem","comfortable"],["praktisch","practical"],
  ["nützlich","useful"],["beliebt","popular"],["zufrieden","satisfied"],["stolz","proud"],["neugierig","curious"],
  ["vorsichtig","careful"],["fleißig","hard-working; diligent"],["faul","lazy"],["klug","clever; smart"],
  ["dumm","stupid"],["reif","ripe; mature"],["lecker","tasty; delicious"],["süß","sweet; cute"],["sauer","sour"],
  ["scharf","spicy; sharp"],["bitter","bitter"],["salzig","salty"],
]);

// dedupe by (lemma,pos) keeping first
const seen = new Set();
const rows = [];
for (const [l, pos, gl] of E) {
  const k = l.toLowerCase() + "|" + pos;
  if (seen.has(k)) continue;
  seen.add(k);
  rows.push([l, pos, gl].join("\t"));
}
const header = "# Curated core German->English glossary (lemma \\t pos \\t gloss).\n# Lines starting with # and blank lines are ignored. Hand-editable.\n";
const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../assets/dict-core-gloss.tsv",
);
writeFileSync(outPath, header + rows.join("\n") + "\n");
console.log(`wrote ${outPath}: ${rows.length} core gloss entries`);
