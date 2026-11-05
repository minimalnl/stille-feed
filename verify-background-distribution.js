// Verification script: check background color distribution for seeds 1-100
// Run: node verify-background-distribution.js

const ACHTERGRONDEN = ['#fcfaf6', '#f7f3ea', '#faf8f2'];

console.log('Background distribution test for seeds 1-100:\n');
console.log('Using deterministic mapping: ACHTERGRONDEN[SEED % 3]\n');

const distribution = { 0: 0, 1: 0, 2: 0 };
const samples = [];

for (let seed = 1; seed <= 100; seed++) {
  const index = seed % 3;
  const color = ACHTERGRONDEN[index];
  distribution[index]++;
  
  if (seed <= 10 || seed % 25 === 0) {
    samples.push(`  Seed ${seed.toString().padStart(3)}: ${color} (index ${index})`);
  }
}

console.log('Sample results:');
samples.forEach(s => console.log(s));

console.log('\nDistribution summary for seeds 1-100:');
console.log(`  ${ACHTERGRONDEN[0]} (index 0): ${distribution[0]} tokens (${distribution[0]}%)`);
console.log(`  ${ACHTERGRONDEN[1]} (index 1): ${distribution[1]} tokens (${distribution[1]}%)`);
console.log(`  ${ACHTERGRONDEN[2]} (index 2): ${distribution[2]} tokens (${distribution[2]}%)`);

console.log('\nExpected: ~33 per color for seeds 1-100');
console.log(`Actual: ${distribution[0]}, ${distribution[1]}, ${distribution[2]}`);

const balanced = distribution[0] === 34 && distribution[1] === 33 && distribution[2] === 33;
console.log(`\n✓ Distribution is ${balanced ? 'FAIR' : 'needs review'}`);

// Test larger seeds
console.log('\n\nTesting larger seeds (1000, 2000, 5000, 10000):');
[1000, 2000, 5000, 10000].forEach(seed => {
  const index = seed % 3;
  console.log(`  Seed ${seed}: ${ACHTERGRONDEN[index]} (index ${index})`);
});
