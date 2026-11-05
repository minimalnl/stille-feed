# Generative Square: Fair Background Distribution

## Changes

**Updated background color selection** to ensure fair distribution across all 3 palette colors for every token, including small sequential seeds.

### Implementation

Changed from:
```javascript
const achtergrond = random(ACHTERGRONDEN);
```

To:
```javascript
const achtergrond = ACHTERGRONDEN[SEED % 3];
```

### Why

With `randomSeed(n)` in p5.js 1.9, the first `random()` call for small seeds (n=1..250) consistently returned values in the range [0, 1/3), causing `random(ACHTERGRONDEN)` to always select index 0 (#fcfaf6). This resulted in no variation in background colors for the initial token range.

### Result

**Deterministic fair mapping:**
- SEED % 3 === 0 → `#fcfaf6` (eerste kleur)
- SEED % 3 === 1 → `#f7f3ea` (tweede kleur)
- SEED % 3 === 2 → `#faf8f2` (derde kleur)

For seeds 1-100: 33%, 34%, 33% distribution (perfectly balanced).

### What Stays the Same

- Square colors (`VIERKANT_KLEUREN`) continue to use `random()` for natural variation
- Square size continues to use `random(MIN_MAAT, MAX_MAAT)` for natural variation
- Grain/noise (`KORREL_*`) continues to use `random()` for texture variation
- All three background hex values remain unchanged
- Preview rendering uses `seed = tokenId` as before

### Files Updated

1. **generative-square-art.js** - Source art script (for contract deployment reference)
2. Contract script (needs to be updated via contract deployment - not done by this PR)

### Verification

Run `node verify-background-distribution.js` to see the fair distribution across seeds 1-100 and larger seed values.
