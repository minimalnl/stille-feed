// ---- variabelen om mee te spelen ----
const WERK_MAAT = 2400;

const ACHTERGRONDEN = ['#fcfaf6', '#f7f3ea', '#faf8f2'];

const VIERKANT_KLEUREN = [
  '#9b9980ff',
  '#9b8d80ff',
  '#9b7980ff'
];

const MIN_MAAT = 0.236;
const MAX_MAAT = 0.382;

const KORREL_DICHTHEID = 0.5;
const KORREL_STERKTE = 30;
const KORREL_GROOTTE = 0.5;
const KORREL_ALPHA = 150;
// -------------------------------------

const SCHAAL = WERK_MAAT / 1200;
const KORREL_PX = KORREL_GROOTTE * SCHAAL;

function setup() {
  createCanvas(WERK_MAAT, WERK_MAAT);
  randomSeed(SEED);
  random(); // discard biased first draw so VIERKANT_KLEUREN varies for low seeds
  noLoop();
  noStroke();
}

function draw() {
  // Achtergrond-ordening (vast): seed%3===0 -> #fcfaf6, 1 -> #f7f3ea, 2 -> #faf8f2
  const achtergrond = ACHTERGRONDEN[(Math.floor(Number(SEED)) >>> 0) % ACHTERGRONDEN.length];
  background(achtergrond);

  const kleur = random(VIERKANT_KLEUREN);
  const maat = random(MIN_MAAT, MAX_MAAT) * WERK_MAAT;

  fill(kleur);
  rectMode(CENTER);
  rect(width / 2, height / 2, maat, maat);

  const marge = KORREL_PX;
  const links = width / 2 - maat / 2 + marge;
  const boven = height / 2 - maat / 2 + marge;
  const ruisMaat = maat - marge * 2;

  const basis = color(kleur);
  const r = red(basis);
  const g = green(basis);
  const b = blue(basis);
  const aantal = (maat * maat * KORREL_DICHTHEID) / (SCHAAL * SCHAAL);

  strokeWeight(KORREL_PX);
  for (let i = 0; i < aantal; i++) {
    const x = links + random(ruisMaat);
    const y = boven + random(ruisMaat);
    const v = random(-KORREL_STERKTE, KORREL_STERKTE);
    stroke(r + v, g + v, b + v, KORREL_ALPHA);
    point(x, y);
  }
  noStroke();
}