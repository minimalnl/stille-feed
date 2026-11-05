// Verification script: check background AND square color distribution for seeds 1-100
// Run: node verify-background-distribution.js

const ACHTERGRONDEN = ['#fcfaf6', '#f7f3ea', '#faf8f2'];
const VIERKANT_KLEUREN = ['#9b9980ff', '#9b8d80ff', '#9b7980ff'];

// Simulate p5.js randomSeed + random() with the same LCG as p5.js 1.9
// LCG: multiplier 1664525, increment 1013904223, modulus 2^32
class P5Random {
  constructor(seed) {
    this.seed = (seed < 4294967296 ? seed : seed % 4294967296) >>> 0;
  }
  
  random(min, max) {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    const val = this.seed / 4294967296;
    
    if (min === undefined) return val;
    if (max === undefined) {
      // random(array)
      if (Array.isArray(min)) {
        return min[Math.floor(val * min.length)];
      }
      max = min;
      min = 0;
    }
    return min + val * (max - min);
  }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('Background & Square Color Distribution Test (seeds 1-100)');
console.log('═══════════════════════════════════════════════════════════════\n');

const bgDist = { 0: 0, 1: 0, 2: 0 };
const sqDist = { 0: 0, 1: 0, 2: 0 };
const samples = [];

for (let seed = 1; seed <= 100; seed++) {
  // Background: deterministic SEED % 3
  const bgIndex = seed % 3;
  const bgColor = ACHTERGRONDEN[bgIndex];
  bgDist[bgIndex]++;
  
  // Square color: simulate the fixed script
  const rng = new P5Random(seed);
  rng.random(); // Discard first biased draw
  const sqColor = rng.random(VIERKANT_KLEUREN);
  const sqIndex = VIERKANT_KLEUREN.indexOf(sqColor);
  sqDist[sqIndex]++;
  
  if (seed <= 10 || seed % 25 === 0) {
    samples.push({
      seed,
      bgColor: bgColor.slice(0, 7),
      bgIndex,
      sqColor: sqColor.slice(0, 7),
      sqIndex
    });
  }
}

console.log('Sample results (first 10 + every 25th):');
console.log('Seed │ Background       │ Square Color     ');
console.log('─────┼──────────────────┼──────────────────');
samples.forEach(s => {
  const seedStr = s.seed.toString().padStart(3);
  const bgStr = `${s.bgColor} (${s.bgIndex})`.padEnd(15);
  const sqStr = `${s.sqColor} (${s.sqIndex})`;
  console.log(`${seedStr}  │ ${bgStr} │ ${sqStr}`);
});

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('BACKGROUND Distribution (seeds 1-100):');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  ${ACHTERGRONDEN[0]} (index 0): ${bgDist[0]} tokens (${bgDist[0]}%)`);
console.log(`  ${ACHTERGRONDEN[1]} (index 1): ${bgDist[1]} tokens (${bgDist[1]}%)`);
console.log(`  ${ACHTERGRONDEN[2]} (index 2): ${bgDist[2]} tokens (${bgDist[2]}%)`);

const bgBalanced = Math.abs(bgDist[0] - 33.33) < 2 && Math.abs(bgDist[1] - 33.33) < 2 && Math.abs(bgDist[2] - 33.33) < 2;
console.log(`\n${bgBalanced ? '✓' : '✗'} Backgrounds: ${bgBalanced ? 'FAIR (±1% of 33.33%)' : 'BIASED'}`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('SQUARE COLOR Distribution (seeds 1-100):');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  ${VIERKANT_KLEUREN[0]} (index 0): ${sqDist[0]} tokens (${sqDist[0]}%)`);
console.log(`  ${VIERKANT_KLEUREN[1]} (index 1): ${sqDist[1]} tokens (${sqDist[1]}%)`);
console.log(`  ${VIERKANT_KLEUREN[2]} (index 2): ${sqDist[2]} tokens (${sqDist[2]}%)`);

// Reasonable spread: each color should appear at least 20% (20 times out of 100)
const sqBalanced = sqDist[0] >= 20 && sqDist[1] >= 20 && sqDist[2] >= 20;
const sqExcellent = Math.abs(sqDist[0] - 33.33) < 5 && Math.abs(sqDist[1] - 33.33) < 5 && Math.abs(sqDist[2] - 33.33) < 5;

if (sqExcellent) {
  console.log(`\n✓ Square colors: EXCELLENT (all within ±5% of 33.33%)`);
} else if (sqBalanced) {
  console.log(`\n✓ Square colors: FAIR (all colors appear ≥20 times)`);
} else {
  console.log(`\n✗ Square colors: BIASED (one or more colors < 20%)`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Testing larger seeds:');
console.log('═══════════════════════════════════════════════════════════════');
[250, 500, 1000, 5000, 10000].forEach(seed => {
  const bgIndex = seed % 3;
  const bgColor = ACHTERGRONDEN[bgIndex];
  
  const rng = new P5Random(seed);
  rng.random(); // Discard first draw
  const sqColor = rng.random(VIERKANT_KLEUREN);
  const sqIndex = VIERKANT_KLEUREN.indexOf(sqColor);
  
  console.log(`Seed ${seed.toString().padStart(5)}: BG ${bgColor.slice(0, 7)} (${bgIndex}) | SQ ${sqColor.slice(0, 7)} (${sqIndex})`);
});

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`OVERALL: ${bgBalanced && sqBalanced ? '✓ PASS' : '✗ FAIL'}`);
console.log('═══════════════════════════════════════════════════════════════');
