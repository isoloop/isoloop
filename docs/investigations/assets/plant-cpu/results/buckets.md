
### native-workers (A) vs isoloop:matched (B), 5 kHz, 4/4 runs

Renderer CPU: A 1001 ms/s, B 1181 ms/s, gap +180 ms/s. Main thread A 826, B 284; workers A 82 (9), B 795 (11); other renderer threads A 97, B 102. Kernel time within it A 34, B 64 (on worker threads A 10, B 31). GPU process A 289, B 334; browser process A 2, B 3. Trace-event coverage of busy threads: A 89%, B 93%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 16.8 | 93.9 | +77.1 | 43% |
| not covered by trace events (JS threads) | 19.0 | 58.3 | +39.2 | 22% |
| messaging: postMessage (serialize) | 2.5 | 26.8 | +24.3 | 13% |
| tasks and scheduling (other native) | 65.6 | 89.3 | +23.7 | 13% |
| app: metrics panels | 8.7 | 31.6 | +22.9 | 13% |
| runtime: bus client | 0.0 | 22.0 | +22.0 | 12% |
| host: other | 0.0 | 21.2 | +21.2 | 12% |
| bus: broker | 0.0 | 16.8 | +16.8 | 9% |
| JS: browser API calls | 20.9 | 27.1 | +6.2 | 3% |
| runtime: other | 0.0 | 6.0 | +6.0 | 3% |
| app: widgets and page | 7.1 | 12.3 | +5.2 | 3% |
| animation frames in workers | 0.0 | 4.4 | +4.4 | 2% |
| host: patch apply | 0.0 | 4.1 | +4.1 | 2% |
| React | 19.0 | 22.7 | +3.6 | 2% |
| host: bus controller | 0.0 | 2.5 | +2.5 | 1% |
| not covered by trace events (other threads) | 15.5 | 17.6 | +2.1 | 1% |
| bus: schema validation | 0.0 | 2.0 | +2.0 | 1% |
| protocol guards | 0.0 | 1.4 | +1.4 | 1% |
| app: feeds and engines | 57.0 | 56.9 | -0.1 | -0% |
| GC | 25.2 | 23.1 | -2.1 | -1% |
| compositor thread | 25.7 | 21.7 | -3.9 | -2% |
| app: canvas drawing (JS) | 85.4 | 58.0 | -27.4 | -15% |
| canvas and tiles: raster and present | 437.6 | 407.3 | -30.3 | -17% |
| style, layout, paint, commit | 206.9 | 170.0 | -36.9 | -21% |

### native (A) vs isoloop:one (B), 5 kHz, 4/4 runs

Renderer CPU: A 942 ms/s, B 1128 ms/s, gap +186 ms/s. Main thread A 838, B 247; workers A 0 (0), B 754 (2); other renderer threads A 104, B 128. Kernel time within it A 24, B 63 (on worker threads A 0, B 26). GPU process A 284, B 337; browser process A 2, B 2. Trace-event coverage of busy threads: A 94%, B 93%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 5.4 | 88.6 | +83.3 | 45% |
| not covered by trace events (JS threads) | 6.2 | 41.4 | +35.2 | 19% |
| app: feeds and engines | 61.7 | 96.2 | +34.5 | 19% |
| tasks and scheduling (other native) | 60.1 | 92.8 | +32.7 | 18% |
| host: other | 0.0 | 26.1 | +26.1 | 14% |
| app: metrics panels | 6.9 | 26.1 | +19.2 | 10% |
| bus: broker | 0.0 | 15.6 | +15.6 | 8% |
| runtime: bus client | 0.0 | 13.5 | +13.5 | 7% |
| messaging: postMessage (serialize) | 0.5 | 13.5 | +13.0 | 7% |
| GC | 21.5 | 31.6 | +10.1 | 5% |
| host: patch apply | 0.0 | 7.7 | +7.7 | 4% |
| app: widgets and page | 7.4 | 11.8 | +4.4 | 2% |
| animation frames in workers | 0.0 | 4.4 | +4.4 | 2% |
| JS: browser API calls | 19.6 | 23.9 | +4.3 | 2% |
| not covered by trace events (other threads) | 14.5 | 18.4 | +3.9 | 2% |
| runtime: other | 0.0 | 3.5 | +3.5 | 2% |
| host: bus controller | 0.0 | 2.5 | +2.5 | 1% |
| bus: schema validation | 0.0 | 1.7 | +1.7 | 1% |
| React | 17.0 | 17.9 | +0.9 | 0% |
| protocol guards | 0.0 | 0.7 | +0.7 | 0% |
| compositor thread | 25.3 | 21.7 | -3.6 | -2% |
| app: canvas drawing (JS) | 74.1 | 48.8 | -25.3 | -14% |
| canvas and tiles: raster and present | 438.8 | 405.4 | -33.4 | -18% |
| style, layout, paint, commit | 188.1 | 127.0 | -61.1 | -33% |

### native-workers (A) vs isoloop:matched (B), 1 kHz, 4/4 runs

Renderer CPU: A 822 ms/s, B 966 ms/s, gap +144 ms/s. Main thread A 686, B 280; workers A 46 (9), B 580 (11); other renderer threads A 100, B 98. Kernel time within it A 29, B 60 (on worker threads A 8, B 31). GPU process A 286, B 323; browser process A 2, B 3. Trace-event coverage of busy threads: A 91%, B 93%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 13.9 | 73.9 | +60.0 | 42% |
| not covered by trace events (JS threads) | 17.8 | 58.3 | +40.5 | 28% |
| host: other | 0.0 | 23.3 | +23.3 | 16% |
| app: metrics panels | 7.1 | 27.7 | +20.6 | 14% |
| tasks and scheduling (other native) | 67.3 | 83.3 | +16.0 | 11% |
| runtime: bus client | 0.0 | 14.9 | +14.9 | 10% |
| messaging: postMessage (serialize) | 2.6 | 16.8 | +14.1 | 10% |
| bus: broker | 0.0 | 12.6 | +12.6 | 9% |
| runtime: other | 0.0 | 5.5 | +5.5 | 4% |
| React | 13.4 | 18.3 | +4.9 | 3% |
| host: patch apply | 0.0 | 4.9 | +4.9 | 3% |
| animation frames in workers | 0.0 | 4.5 | +4.5 | 3% |
| JS: browser API calls | 19.1 | 22.3 | +3.2 | 2% |
| host: bus controller | 0.0 | 2.7 | +2.7 | 2% |
| bus: schema validation | 0.0 | 1.7 | +1.7 | 1% |
| GC | 13.7 | 14.8 | +1.1 | 1% |
| protocol guards | 0.0 | 0.6 | +0.6 | 0% |
| not covered by trace events (other threads) | 14.9 | 15.4 | +0.6 | 0% |
| app: widgets and page | 9.4 | 9.2 | -0.2 | -0% |
| compositor thread | 27.3 | 22.0 | -5.3 | -4% |
| app: feeds and engines | 26.9 | 18.7 | -8.3 | -6% |
| app: canvas drawing (JS) | 35.3 | 21.3 | -14.0 | -10% |
| canvas and tiles: raster and present | 378.5 | 340.6 | -37.8 | -26% |
| style, layout, paint, commit | 195.5 | 149.5 | -46.1 | -32% |

### native (A) vs isoloop:one (B), 1 kHz, 4/4 runs

Renderer CPU: A 791 ms/s, B 977 ms/s, gap +186 ms/s. Main thread A 699, B 260; workers A 0 (0), B 604 (2); other renderer threads A 94, B 110. Kernel time within it A 22, B 47 (on worker threads A 0, B 14). GPU process A 284, B 341; browser process A 2, B 4. Trace-event coverage of busy threads: A 91%, B 94%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 6.3 | 73.7 | +67.5 | 36% |
| not covered by trace events (JS threads) | 6.8 | 40.9 | +34.1 | 18% |
| host: other | 0.0 | 26.2 | +26.2 | 14% |
| tasks and scheduling (other native) | 51.7 | 76.6 | +24.9 | 13% |
| app: metrics panels | 7.6 | 28.4 | +20.7 | 11% |
| canvas and tiles: raster and present | 379.8 | 393.2 | +13.4 | 7% |
| bus: broker | 0.0 | 10.1 | +10.1 | 5% |
| runtime: bus client | 0.0 | 9.9 | +9.9 | 5% |
| app: feeds and engines | 20.3 | 29.9 | +9.6 | 5% |
| messaging: postMessage (serialize) | 0.4 | 9.2 | +8.8 | 5% |
| JS: browser API calls | 18.9 | 27.0 | +8.1 | 4% |
| GC | 13.4 | 20.4 | +6.9 | 4% |
| host: patch apply | 0.0 | 6.3 | +6.3 | 3% |
| animation frames in workers | 0.0 | 3.9 | +3.9 | 2% |
| runtime: other | 0.0 | 3.5 | +3.5 | 2% |
| not covered by trace events (other threads) | 14.5 | 17.2 | +2.7 | 1% |
| host: bus controller | 0.0 | 2.0 | +2.0 | 1% |
| app: widgets and page | 7.9 | 9.4 | +1.5 | 1% |
| bus: schema validation | 0.0 | 1.1 | +1.1 | 1% |
| protocol guards | 0.0 | 0.6 | +0.6 | 0% |
| React | 13.7 | 12.4 | -1.3 | -1% |
| compositor thread | 28.2 | 23.8 | -4.4 | -2% |
| app: canvas drawing (JS) | 34.2 | 28.3 | -5.9 | -3% |
| style, layout, paint, commit | 183.1 | 129.6 | -53.5 | -29% |
