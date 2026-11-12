# Plant dashboard, head-to-head

Run settings:

```json
{
  "started": "2026-11-11T14:31:11.474Z",
  "args": {
    "pair": [
      "native-workers=isoloop:matched",
      "native=isoloop:one"
    ],
    "rates": "5,1",
    "rounds": "4",
    "hold": "0",
    "engines": "chromium",
    "out": ".probe/compare-off",
    "extra": [],
    "warm": "6",
    "window": "10",
    "summary-only": false
  },
  "configs": [
    "native-workers",
    "isoloop:matched",
    "native",
    "isoloop:one"
  ],
  "cpus": "2,4,6,8"
}
```

Each pair ran interleaved (A, B, A, B…), one page at a time. **Gap** is B minus A within each round; the table gives its median over the rounds, as a share of A’s median, and its spread (lowest to highest round). Medians of A and B are over the rounds too. Stopped runs are left out and counted.

## chromium, 1 kHz

### native-workers (A) vs isoloop:matched (B)

Rounds: A 4/4 ran, B 4/4 ran.

| Figure | A | B | Gap (B − A) | Gap % | Gap spread |
| --- | --- | --- | --- | --- | --- |
| Workers (Isoloop also runs the bus worker, not counted) | 9 | 10 | +1 | +11% | +1 to +1 |
| Late frames (of ~60/s × window) | 0 | 0 | 0 | – | 0 to 0 |
| Typing (median of 5) | 43 ms | 32 ms | -11 ms | -26% | -32 ms to +13 ms |
| Main-thread CPU | 69% | 27% | -42 pp | -61% | -44 pp to -41 pp |
| CPU, all threads | 84% | 96% | +12 pp | +15% | +9 pp to +14 pp |
| Memory, first reading | 211 MB | 302 MB | +92 MB | +43% | +86 MB to +96 MB |
| Memory, first reading, after GC | 191 MB | 234 MB | +43 MB | +22% | +37 MB to +51 MB |
| First data | 322 ms | 563 ms | +251 ms | +78% | +210 ms to +288 ms |
| All 72 widgets with data | 2272 ms | 1729 ms | -176 ms | -8% | -559 ms to +199 ms |
| Recovery after a 3 s block | 3124 ms | 2788 ms | -336 ms | -11% | -395 ms to -141 ms |
| Data gap, T3 | 0.0 s | 0.0 s | 0.0 s | – | 0.0 s to 0.0 s |
| Data gap, other machines | 0.0 s | 0.0 s | 0.0 s | – | 0.0 s to 0.0 s |

### native (A) vs isoloop:one (B)

Rounds: A 4/4 ran, B 4/4 ran.

| Figure | A | B | Gap (B − A) | Gap % | Gap spread |
| --- | --- | --- | --- | --- | --- |
| Workers (Isoloop also runs the bus worker, not counted) | 0 | 1 | +1 | – | +1 to +1 |
| Late frames (of ~60/s × window) | 0 | 0 | 0 | – | 0 to 0 |
| Typing (median of 5) | 34 ms | 21 ms | -14 ms | -40% | -16 ms to -6 ms |
| Main-thread CPU | 69% | 23% | -46 pp | -67% | -47 pp to -45 pp |
| CPU, all threads | 79% | 87% | +8 pp | +10% | +6 pp to +15 pp |
| Memory, first reading | 168 MB | 247 MB | +81 MB | +48% | +66 MB to +87 MB |
| Memory, first reading, after GC | 153 MB | 187 MB | +35 MB | +23% | +31 MB to +39 MB |
| First data | 258 ms | 513 ms | +233 ms | +90% | +164 ms to +289 ms |
| All 72 widgets with data | 1407 ms | 2371 ms | +964 ms | +68% | +872 ms to +1119 ms |
| Recovery after a 3 s block | 3163 ms | 3444 ms | +287 ms | +9% | +238 ms to +331 ms |
| Data gap, T3 | 3.8 s | 3.3 s | -0.5 s | -13% | -0.5 s to -0.2 s |
| Data gap, other machines | 3.8 s | 3.3 s | -0.5 s | -13% | -0.5 s to -0.2 s |

## chromium, 5 kHz

### native-workers (A) vs isoloop:matched (B)

Rounds: A 4/4 ran, B 4/4 ran.

| Figure | A | B | Gap (B − A) | Gap % | Gap spread |
| --- | --- | --- | --- | --- | --- |
| Workers (Isoloop also runs the bus worker, not counted) | 9 | 10 | +1 | +11% | +1 to +1 |
| Late frames (of ~60/s × window) | 0 | 0 | 0 | – | -1 to 0 |
| Typing (median of 5) | 66 ms | 39 ms | -34 ms | -52% | -37 ms to -3 ms |
| Main-thread CPU | 82% | 27% | -55 pp | -67% | -61 pp to -52 pp |
| CPU, all threads | 101% | 119% | +18 pp | +18% | +12 pp to +25 pp |
| Memory, first reading | 247 MB | 356 MB | +109 MB | +44% | +100 MB to +122 MB |
| Memory, first reading, after GC | 223 MB | 283 MB | +60 MB | +27% | +51 MB to +67 MB |
| First data | 374 ms | 623 ms | +244 ms | +65% | +115 ms to +362 ms |
| All 72 widgets with data | 2330 ms | 1519 ms | -401 ms | -17% | -817 ms to +248 ms |
| Recovery after a 3 s block | 3180 ms | 2972 ms | -237 ms | -7% | -289 ms to +589 ms |
| Data gap, T3 | 0.0 s | 0.0 s | 0.0 s | – | 0.0 s to 0.0 s |
| Data gap, other machines | 0.0 s | 0.0 s | 0.0 s | – | 0.0 s to 0.0 s |

### native (A) vs isoloop:one (B)

Rounds: A 4/4 ran, B 4/4 ran.

| Figure | A | B | Gap (B − A) | Gap % | Gap spread |
| --- | --- | --- | --- | --- | --- |
| Workers (Isoloop also runs the bus worker, not counted) | 0 | 1 | +1 | – | +1 to +1 |
| Late frames (of ~60/s × window) | 0 | 0 | 0 | – | 0 to 0 |
| Typing (median of 5) | 70 ms | 23 ms | -47 ms | -68% | -70 ms to -25 ms |
| Main-thread CPU | 83% | 24% | -58 pp | -70% | -63 pp to -57 pp |
| CPU, all threads | 94% | 111% | +18 pp | +19% | +17 pp to +18 pp |
| Memory, first reading | 189 MB | 276 MB | +88 MB | +46% | +78 MB to +96 MB |
| Memory, first reading, after GC | 165 MB | 201 MB | +39 MB | +23% | +33 MB to +44 MB |
| First data | 294 ms | 481 ms | +187 ms | +64% | +175 ms to +195 ms |
| All 72 widgets with data | 1182 ms | 2367 ms | +1196 ms | +101% | +1162 ms to +1217 ms |
| Recovery after a 3 s block | 3219 ms | 3459 ms | +239 ms | +7% | +217 ms to +249 ms |
| Data gap, T3 | 3.0 s | 2.6 s | -0.4 s | -13% | -0.5 s to -0.4 s |
| Data gap, other machines | 3.0 s | 2.6 s | -0.4 s | -15% | -0.6 s to -0.4 s |

