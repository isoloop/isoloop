# Plant dashboard, head-to-head

Run settings:

```json
{
  "started": "2026-11-11T14:45:48.530Z",
  "args": {
    "pair": [
      "native-workers=isoloop:matched",
      "native=isoloop:one"
    ],
    "rates": "5,1",
    "rounds": "4",
    "hold": "0",
    "engines": "chromium",
    "out": ".probe/compare-on",
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
| Late frames (of ~60/s × window) | 0 | 0 | 0 | – | -1 to 0 |
| Typing (median of 5) | 33 ms | 23 ms | -12 ms | -35% | -49 ms to +8 ms |
| Main-thread CPU | 69% | 26% | -43 pp | -63% | -52 pp to -42 pp |
| CPU, all threads | 85% | 98% | +12 pp | +14% | +12 pp to +15 pp |
| Memory, first reading | 218 MB | 306 MB | +91 MB | +42% | +81 MB to +100 MB |
| Memory, first reading, after GC | 194 MB | 240 MB | +46 MB | +24% | +42 MB to +52 MB |
| First data | 332 ms | 605 ms | +270 ms | +81% | +156 ms to +327 ms |
| All 72 widgets with data | 1983 ms | 1687 ms | -220 ms | -11% | -660 ms to +99 ms |
| Recovery after a 3 s block | 3155 ms | 2821 ms | -323 ms | -10% | -449 ms to -256 ms |
| Data gap, T3 | 0.0 s | 0.0 s | 0.0 s | – | 0.0 s to 0.0 s |
| Data gap, other machines | 0.0 s | 0.0 s | 0.0 s | – | 0.0 s to 0.0 s |

### native (A) vs isoloop:one (B)

Rounds: A 4/4 ran, B 4/4 ran.

| Figure | A | B | Gap (B − A) | Gap % | Gap spread |
| --- | --- | --- | --- | --- | --- |
| Workers (Isoloop also runs the bus worker, not counted) | 0 | 1 | +1 | – | +1 to +1 |
| Late frames (of ~60/s × window) | 0 | 0 | 0 | – | 0 to 0 |
| Typing (median of 5) | 39 ms | 21 ms | -12 ms | -30% | -25 ms to -4 ms |
| Main-thread CPU | 68% | 23% | -44 pp | -65% | -45 pp to -43 pp |
| CPU, all threads | 78% | 88% | +11 pp | +14% | +10 pp to +11 pp |
| Memory, first reading | 170 MB | 251 MB | +81 MB | +47% | +74 MB to +84 MB |
| Memory, first reading, after GC | 155 MB | 185 MB | +33 MB | +21% | +27 MB to +38 MB |
| First data | 265 ms | 503 ms | +238 ms | +90% | +199 ms to +303 ms |
| All 72 widgets with data | 1307 ms | 2380 ms | +1065 ms | +82% | +900 ms to +1143 ms |
| Recovery after a 3 s block | 3180 ms | 3498 ms | +314 ms | +10% | +266 ms to +354 ms |
| Data gap, T3 | 3.8 s | 3.3 s | -0.5 s | -13% | -0.5 s to -0.5 s |
| Data gap, other machines | 3.8 s | 3.3 s | -0.5 s | -13% | -0.5 s to -0.5 s |

## chromium, 5 kHz

### native-workers (A) vs isoloop:matched (B)

Rounds: A 4/4 ran, B 4/4 ran.

| Figure | A | B | Gap (B − A) | Gap % | Gap spread |
| --- | --- | --- | --- | --- | --- |
| Workers (Isoloop also runs the bus worker, not counted) | 9 | 10 | +1 | +11% | +1 to +1 |
| Late frames (of ~60/s × window) | 1 | 0 | -1 | -100% | -1 to 0 |
| Typing (median of 5) | 72 ms | 31 ms | -46 ms | -64% | -64 ms to +2 ms |
| Main-thread CPU | 82% | 26% | -57 pp | -69% | -62 pp to -53 pp |
| CPU, all threads | 101% | 119% | +19 pp | +19% | +12 pp to +22 pp |
| Memory, first reading | 247 MB | 349 MB | +102 MB | +41% | +97 MB to +114 MB |
| Memory, first reading, after GC | 222 MB | 281 MB | +60 MB | +27% | +54 MB to +65 MB |
| First data | 334 ms | 630 ms | +278 ms | +83% | +233 ms to +362 ms |
| All 72 widgets with data | 2310 ms | 1509 ms | -777 ms | -34% | -820 ms to +105 ms |
| Recovery after a 3 s block | 3178 ms | 2966 ms | -220 ms | -7% | -379 ms to -147 ms |
| Data gap, T3 | 0.0 s | 0.0 s | 0.0 s | – | 0.0 s to 0.0 s |
| Data gap, other machines | 0.0 s | 0.0 s | 0.0 s | – | 0.0 s to 0.0 s |

### native (A) vs isoloop:one (B)

Rounds: A 4/4 ran, B 4/4 ran.

| Figure | A | B | Gap (B − A) | Gap % | Gap spread |
| --- | --- | --- | --- | --- | --- |
| Workers (Isoloop also runs the bus worker, not counted) | 0 | 1 | +1 | – | +1 to +1 |
| Late frames (of ~60/s × window) | 0 | 0 | 0 | – | 0 to 0 |
| Typing (median of 5) | 93 ms | 24 ms | -69 ms | -74% | -79 ms to -55 ms |
| Main-thread CPU | 84% | 23% | -61 pp | -72% | -62 pp to -59 pp |
| CPU, all threads | 95% | 111% | +16 pp | +17% | +15 pp to +31 pp |
| Memory, first reading | 190 MB | 272 MB | +84 MB | +44% | +79 MB to +88 MB |
| Memory, first reading, after GC | 166 MB | 203 MB | +38 MB | +23% | +34 MB to +43 MB |
| First data | 261 ms | 494 ms | +243 ms | +93% | +147 ms to +285 ms |
| All 72 widgets with data | 1167 ms | 2377 ms | +1202 ms | +103% | +1113 ms to +1232 ms |
| Recovery after a 3 s block | 3195 ms | 3491 ms | +289 ms | +9% | +177 ms to +358 ms |
| Data gap, T3 | 3.1 s | 2.6 s | -0.5 s | -16% | -0.6 s to -0.4 s |
| Data gap, other machines | 3.1 s | 2.6 s | -0.5 s | -16% | -0.6 s to -0.4 s |

