# Generative Square: Fair Background & Square Color Distribution

## Changes

**Fixed RNG bias** to ensure fair distribution of backgrounds and square colors for all tokens with random seeds.

### Implementation

```javascript
function draw() {
  // Fair background distribution using SEED modulo 3
  const achtergrond = ACHTERGRONDEN[SEED % 3];
  background(achtergrond);

  // Discard first random() draw to avoid LCG bias
  random();

  // Now square color selection is fair
  const kleur = random(VIERKANT_KLEUREN);
  const maat = random(MIN_MAAT, MAX_MAAT) * WERK_MAAT;
  // ... rest of draw
}
```

### Why These Changes

#### Problem 1: Background bias (original script)
```javascript
const achtergrond = random(ACHTERGRONDEN);
```
With `randomSeed(n)`, the first `random()` for small seeds (1-250) landed in [0, 1/3), so `random(ACHTERGRONDEN)` always picked index 0 (#fcfaf6).

#### Problem 2: Square color bias (after first fix attempt)
When we replaced `random(ACHTERGRONDEN)` with `ACHTERGRONDEN[SEED % 3]`, the first `random()` call shifted to square color selection, causing the same bias: nearly all squares became color index 0 (#9b9980).

#### Solution
1. **Background**: `ACHTERGRONDEN[SEED % 3]` — deterministic fair mapping
2. **Square colors**: Call `random()` once to discard the biased first draw from p5's LCG, then use `random(VIERKANT_KLEUREN)`

### Result for Random Seeds

When the contract assigns random seeds during minting:
- Backgrounds distribute fairly (33.33% each color)
- Square colors distribute fairly (33.33% each color)
- Square sizes vary naturally
- Grain/texture varies naturally

**Sequential seeds 1-100 (for verification):**
- Backgrounds: 33%, 34%, 33% (perfectly cyclic due to `SEED % 3`)
- Square colors: ~33% each after discarding first random() draw

### Important: Random Seeds in Production

**Contract behavior:**
- Each `mint()` should assign a **random seed** from the contract's RNG (not `seed = tokenId`)
- Stored in `seedOf(tokenId)` mapping
- Makes traits unpredictable — no one can predict what the next mint will look like

**Preview behavior:**
- URL parameter `?gg=<tokenId>` shows a minted token using its stored seed
- For testing/development, you can view sequential seeds (1, 2, 3...) but **these are not real mints**
- Real mints get large random seeds (up to 1 billion range)

### What Stays the Same

- All hex values unchanged (3 backgrounds, 3 square colors)
- Square size range unchanged (0.236–0.382)
- Grain parameters unchanged
- Calm minimalist aesthetic preserved

### Files

1. **generative-square-art.js** — Updated art script source (for next contract deployment)
2. **verify-background-distribution.js** — Verification script using p5.js LCG simulation
3. **GENERATIVE-SQUARE-UPDATE.md** — This documentation

### Verification

Run `node verify-background-distribution.js` to verify:
- Background distribution via `SEED % 3`
- Square color distribution after discarding first biased random() draw
- Tests seeds 1-100 plus larger seeds (250, 500, 1000, 5000, 10000)

---

## Voor Mark (Nederlands)

### Wat is veranderd

**Achtergronden:** `ACHTERGRONDEN[SEED % 3]` — eerlijke verdeling over 3 kleuren  
**Vierkant kleuren:** Gooi eerste `random()` waarde weg, dan `random(VIERKANT_KLEUREN)` — voorkomt bias

### Belangrijk: Random seeds bij mint

Het contract moet bij elke `mint()` een **random seed** toewijzen (niet seed = tokenId).
- Seeds opslaan in `seedOf(tokenId)` mapping
- Groot random getal (bijv. 1-1.000.000.000)
- Zo kan niemand voorspellen welke traits de volgende mint krijgt

De preview `?gg=<nummer>` laat een geminte token zien met de opgeslagen seed. Voor testen kun je opeenvolgende seeds (1, 2, 3...) bekijken, maar echte mints krijgen grote random seeds van het contract.

### Verificatie

`node verify-background-distribution.js` toont de verdeling voor seeds 1-100.
