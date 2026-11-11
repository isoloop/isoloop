
### native-workers (A) vs isoloop:matched (B), 5 kHz, 4/4 runs

Renderer CPU: A 989 ms/s, B 1158 ms/s, gap +169 ms/s. Main thread A 807, B 268; workers A 83 (9), B 789 (11); other renderer threads A 99, B 105. Kernel time within it A 33, B 76 (on worker threads A 11, B 41). GPU process A 290, B 334; browser process A 1, B 3. Trace-event coverage of busy threads: A 89%, B 92%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 16.3 | 92.6 | +76.3 | 45% |
| JS: other (chunk:machine-canvas-BUOF0HV5.js) | 0.0 | 68.5 | +68.5 | 41% |
| JS: other (chunk:index-B1w7lIGG.js) | 0.0 | 47.7 | +47.7 | 28% |
| not covered by trace events (JS threads) | 18.0 | 55.9 | +37.9 | 22% |
| JS: other (chunk:engines-CkTd-MtY.js) | 0.0 | 36.5 | +36.5 | 22% |
| JS: other (chunk:worker-B2MNozAn.js) | 0.0 | 28.8 | +28.8 | 17% |
| JS: other (chunk:withStress-BKgpKcHj.js) | 0.0 | 26.5 | +26.5 | 16% |
| tasks and scheduling (other native) | 65.9 | 90.5 | +24.6 | 15% |
| messaging: postMessage (serialize) | 2.5 | 21.7 | +19.2 | 11% |
| JS: other (chunk:signals-B7SclRPQ.js) | 0.0 | 19.2 | +19.2 | 11% |
| JS: other (chunk:bus-worker-BsOwxacr.js) | 0.0 | 14.3 | +14.3 | 8% |
| JS: browser API calls | 20.9 | 30.2 | +9.3 | 6% |
| JS: other (chunk:Plot-CnfPZq9u.js) | 0.0 | 7.4 | +7.4 | 4% |
| animation frames in workers | 0.0 | 5.0 | +5.0 | 3% |
| JS: other (chunk:feed-k2K0u6V6.js) | 0.0 | 3.5 | +3.5 | 2% |
| not covered by trace events (other threads) | 16.3 | 18.2 | +1.8 | 1% |
| JS: other (chunk:contracts-CY7oOBwG.js) | 0.0 | 1.7 | +1.7 | 1% |
| JS: other (chunk:machine-dom-BNutpN8W.js) | 0.0 | 1.5 | +1.5 | 1% |
| GC | 24.6 | 25.5 | +0.9 | 1% |
| JS: other (chunk:dist-Dno6VrTf.js) | 0.0 | 0.5 | +0.5 | 0% |
| JS: other (chunk:fleet.worker-BIWPdQTd.js) | 0.6 | 0.0 | -0.6 | -0% |
| compositor thread | 25.4 | 21.5 | -3.9 | -2% |
| canvas and tiles: raster and present | 431.7 | 407.9 | -23.8 | -14% |
| style, layout, paint, commit | 193.3 | 156.4 | -36.9 | -22% |
| JS: other (chunk:machine.worker-DT-_E-Yh.js) | 49.1 | 0.0 | -49.1 | -29% |
| JS: other (chunk:index-DSptTvW8.js) | 124.5 | 0.0 | -124.5 | -74% |

### native-workers (A) vs isobatch:matched (B), 5 kHz, 4/4 runs

Renderer CPU: A 989 ms/s, B 1208 ms/s, gap +219 ms/s. Main thread A 807, B 269; workers A 83 (9), B 837 (11); other renderer threads A 99, B 107. Kernel time within it A 33, B 76 (on worker threads A 11, B 39). GPU process A 290, B 345; browser process A 1, B 4. Trace-event coverage of busy threads: A 89%, B 92%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 16.3 | 86.2 | +69.9 | 32% |
| JS: other (chunk:machine-canvas-BUOF0HV5.js) | 0.0 | 65.0 | +65.0 | 30% |
| JS: other (chunk:index-B0iOEnn7.js) | 0.0 | 47.9 | +47.9 | 22% |
| not covered by trace events (JS threads) | 18.0 | 62.3 | +44.3 | 20% |
| JS: other (chunk:engines-CkTd-MtY.js) | 0.0 | 39.5 | +39.5 | 18% |
| JS: other (chunk:worker-B2MNozAn.js) | 0.0 | 31.6 | +31.6 | 14% |
| JS: other (chunk:withStress-BKgpKcHj.js) | 0.0 | 26.9 | +26.9 | 12% |
| tasks and scheduling (other native) | 65.9 | 91.8 | +25.9 | 12% |
| JS: other (chunk:signals-B7SclRPQ.js) | 0.0 | 21.5 | +21.5 | 10% |
| messaging: postMessage (serialize) | 2.5 | 23.0 | +20.5 | 9% |
| JS: other (chunk:bus-worker-BsOwxacr.js) | 0.0 | 18.1 | +18.1 | 8% |
| JS: browser API calls | 20.9 | 32.8 | +11.9 | 5% |
| JS: other (chunk:Plot-CnfPZq9u.js) | 0.0 | 6.0 | +6.0 | 3% |
| animation frames in workers | 0.0 | 4.3 | +4.3 | 2% |
| canvas and tiles: raster and present | 431.7 | 435.7 | +4.0 | 2% |
| not covered by trace events (other threads) | 16.3 | 19.7 | +3.3 | 2% |
| JS: other (chunk:feed-k2K0u6V6.js) | 0.0 | 2.5 | +2.5 | 1% |
| JS: other (chunk:contracts-CY7oOBwG.js) | 0.0 | 2.3 | +2.3 | 1% |
| JS: other (chunk:dist-Dno6VrTf.js) | 0.0 | 1.4 | +1.4 | 1% |
| JS: other (chunk:machine-dom-BNutpN8W.js) | 0.0 | 1.0 | +1.0 | 0% |
| GC | 24.6 | 25.7 | +1.0 | 0% |
| JS: other (chunk:fleet.worker-BIWPdQTd.js) | 0.6 | 0.0 | -0.6 | -0% |
| compositor thread | 25.4 | 21.2 | -4.2 | -2% |
| style, layout, paint, commit | 193.3 | 146.2 | -47.0 | -21% |
| JS: other (chunk:machine.worker-DT-_E-Yh.js) | 49.1 | 0.0 | -49.1 | -22% |
| JS: other (chunk:index-DSptTvW8.js) | 124.5 | 0.0 | -124.5 | -57% |

### native (A) vs isoloop:one (B), 5 kHz, 4/4 runs

Renderer CPU: A 945 ms/s, B 1103 ms/s, gap +158 ms/s. Main thread A 839, B 248; workers A 0 (0), B 731 (2); other renderer threads A 106, B 127. Kernel time within it A 26, B 54 (on worker threads A 0, B 21). GPU process A 284, B 341; browser process A 1, B 2. Trace-event coverage of busy threads: A 94%, B 94%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 5.9 | 84.5 | +78.6 | 50% |
| JS: other (chunk:index-B1w7lIGG.js) | 0.0 | 58.3 | +58.3 | 37% |
| JS: other (chunk:engines-CkTd-MtY.js) | 0.0 | 53.7 | +53.7 | 34% |
| JS: other (chunk:machine-canvas-BUOF0HV5.js) | 0.0 | 53.1 | +53.1 | 34% |
| JS: other (chunk:signals-B7SclRPQ.js) | 0.0 | 40.8 | +40.8 | 26% |
| tasks and scheduling (other native) | 62.2 | 98.0 | +35.7 | 23% |
| not covered by trace events (JS threads) | 5.8 | 40.1 | +34.3 | 22% |
| JS: other (chunk:withStress-BKgpKcHj.js) | 0.0 | 21.7 | +21.7 | 14% |
| JS: other (chunk:worker-B2MNozAn.js) | 0.0 | 19.7 | +19.7 | 12% |
| JS: other (chunk:bus-worker-BsOwxacr.js) | 0.0 | 13.1 | +13.1 | 8% |
| messaging: postMessage (serialize) | 0.6 | 10.7 | +10.1 | 6% |
| JS: browser API calls | 20.1 | 29.4 | +9.4 | 6% |
| GC | 21.5 | 30.4 | +8.9 | 6% |
| animation frames in workers | 0.0 | 4.2 | +4.2 | 3% |
| not covered by trace events (other threads) | 15.2 | 18.6 | +3.4 | 2% |
| JS: other (chunk:Plot-CnfPZq9u.js) | 0.0 | 3.1 | +3.1 | 2% |
| JS: other (chunk:feed-k2K0u6V6.js) | 0.0 | 1.7 | +1.7 | 1% |
| JS: other (chunk:contracts-CY7oOBwG.js) | 0.0 | 1.2 | +1.2 | 1% |
| JS: other (chunk:machine-dom-BNutpN8W.js) | 0.0 | 0.6 | +0.6 | 0% |
| compositor thread | 25.2 | 22.0 | -3.2 | -2% |
| canvas and tiles: raster and present | 451.0 | 387.8 | -63.2 | -40% |
| style, layout, paint, commit | 194.1 | 126.1 | -68.0 | -43% |
| JS: other (chunk:index-Edadf9bw.js) | 167.2 | 0.0 | -167.2 | -106% |

### native (A) vs isobatch:one (B), 5 kHz, 4/4 runs

Renderer CPU: A 945 ms/s, B 1117 ms/s, gap +172 ms/s. Main thread A 839, B 244; workers A 0 (0), B 741 (2); other renderer threads A 106, B 128. Kernel time within it A 26, B 63 (on worker threads A 0, B 27). GPU process A 284, B 339; browser process A 1, B 2. Trace-event coverage of busy threads: A 94%, B 93%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 5.9 | 81.1 | +75.2 | 44% |
| JS: other (chunk:engines-CkTd-MtY.js) | 0.0 | 56.5 | +56.5 | 33% |
| JS: other (chunk:machine-canvas-BUOF0HV5.js) | 0.0 | 55.5 | +55.5 | 32% |
| JS: other (chunk:index-B0iOEnn7.js) | 0.0 | 51.3 | +51.3 | 30% |
| JS: other (chunk:signals-B7SclRPQ.js) | 0.0 | 43.7 | +43.7 | 25% |
| tasks and scheduling (other native) | 62.2 | 97.7 | +35.5 | 21% |
| not covered by trace events (JS threads) | 5.8 | 40.2 | +34.4 | 20% |
| JS: other (chunk:worker-B2MNozAn.js) | 0.0 | 21.1 | +21.1 | 12% |
| JS: other (chunk:withStress-BKgpKcHj.js) | 0.0 | 20.3 | +20.3 | 12% |
| JS: other (chunk:bus-worker-BsOwxacr.js) | 0.0 | 18.2 | +18.2 | 11% |
| messaging: postMessage (serialize) | 0.6 | 12.1 | +11.5 | 7% |
| JS: browser API calls | 20.1 | 29.8 | +9.7 | 6% |
| GC | 21.5 | 30.5 | +9.0 | 5% |
| animation frames in workers | 0.0 | 5.9 | +5.9 | 3% |
| JS: other (chunk:Plot-CnfPZq9u.js) | 0.0 | 3.6 | +3.6 | 2% |
| JS: other (chunk:feed-k2K0u6V6.js) | 0.0 | 2.6 | +2.6 | 1% |
| not covered by trace events (other threads) | 15.2 | 17.3 | +2.1 | 1% |
| JS: other (chunk:contracts-CY7oOBwG.js) | 0.0 | 1.8 | +1.8 | 1% |
| JS: other (chunk:machine-dom-BNutpN8W.js) | 0.0 | 0.6 | +0.6 | 0% |
| compositor thread | 25.2 | 22.2 | -3.0 | -2% |
| canvas and tiles: raster and present | 451.0 | 381.5 | -69.5 | -40% |
| style, layout, paint, commit | 194.1 | 124.0 | -70.1 | -41% |
| JS: other (chunk:index-Edadf9bw.js) | 167.2 | 0.0 | -167.2 | -97% |

### native-workers (A) vs isoloop:matched (B), 1 kHz, 4/4 runs

Renderer CPU: A 824 ms/s, B 978 ms/s, gap +154 ms/s. Main thread A 685, B 276; workers A 43 (9), B 602 (11); other renderer threads A 97, B 103. Kernel time within it A 30, B 70 (on worker threads A 7, B 33). GPU process A 292, B 336; browser process A 2, B 4. Trace-event coverage of busy threads: A 94%, B 94%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 13.4 | 74.4 | +60.9 | 40% |
| JS: other (chunk:index-B1w7lIGG.js) | 0.0 | 49.4 | +49.4 | 32% |
| JS: other (chunk:machine-canvas-BUOF0HV5.js) | 0.0 | 25.6 | +25.6 | 17% |
| JS: other (chunk:worker-B2MNozAn.js) | 0.0 | 24.9 | +24.9 | 16% |
| JS: other (chunk:withStress-BKgpKcHj.js) | 0.0 | 21.3 | +21.3 | 14% |
| tasks and scheduling (other native) | 67.0 | 86.2 | +19.3 | 13% |
| not covered by trace events (JS threads) | 26.7 | 44.6 | +17.9 | 12% |
| messaging: postMessage (serialize) | 2.1 | 15.8 | +13.6 | 9% |
| JS: other (chunk:bus-worker-BsOwxacr.js) | 0.0 | 11.2 | +11.2 | 7% |
| JS: other (chunk:engines-CkTd-MtY.js) | 0.0 | 10.9 | +10.9 | 7% |
| JS: other (chunk:signals-B7SclRPQ.js) | 0.0 | 6.5 | +6.5 | 4% |
| JS: other (chunk:Plot-CnfPZq9u.js) | 0.0 | 4.7 | +4.7 | 3% |
| animation frames in workers | 0.0 | 3.9 | +3.9 | 3% |
| JS: browser API calls | 21.4 | 25.0 | +3.6 | 2% |
| JS: other (chunk:feed-k2K0u6V6.js) | 0.0 | 2.4 | +2.4 | 2% |
| not covered by trace events (other threads) | 14.0 | 16.0 | +2.0 | 1% |
| GC | 15.2 | 16.9 | +1.7 | 1% |
| JS: other (chunk:contracts-CY7oOBwG.js) | 0.0 | 1.4 | +1.4 | 1% |
| JS: other (chunk:machine-dom-BNutpN8W.js) | 0.0 | 1.2 | +1.2 | 1% |
| JS: other (chunk:dist-Dno6VrTf.js) | 0.0 | 0.5 | +0.5 | 0% |
| compositor thread | 28.0 | 22.6 | -5.4 | -3% |
| JS: other (chunk:machine.worker-DT-_E-Yh.js) | 19.8 | 0.0 | -19.8 | -13% |
| canvas and tiles: raster and present | 372.2 | 348.5 | -23.7 | -15% |
| style, layout, paint, commit | 189.1 | 162.7 | -26.4 | -17% |
| JS: other (chunk:index-DSptTvW8.js) | 68.4 | 0.0 | -68.4 | -44% |

### native-workers (A) vs isobatch:matched (B), 1 kHz, 4/4 runs

Renderer CPU: A 824 ms/s, B 927 ms/s, gap +103 ms/s. Main thread A 685, B 257; workers A 43 (9), B 579 (11); other renderer threads A 97, B 95. Kernel time within it A 30, B 61 (on worker threads A 7, B 32). GPU process A 292, B 323; browser process A 2, B 3. Trace-event coverage of busy threads: A 94%, B 94%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 13.4 | 70.2 | +56.8 | 55% |
| JS: other (chunk:index-B0iOEnn7.js) | 0.0 | 46.4 | +46.4 | 45% |
| JS: other (chunk:machine-canvas-BUOF0HV5.js) | 0.0 | 27.1 | +27.1 | 26% |
| JS: other (chunk:worker-B2MNozAn.js) | 0.0 | 24.6 | +24.6 | 24% |
| JS: other (chunk:withStress-BKgpKcHj.js) | 0.0 | 21.4 | +21.4 | 21% |
| not covered by trace events (JS threads) | 26.7 | 46.2 | +19.5 | 19% |
| JS: other (chunk:bus-worker-BsOwxacr.js) | 0.0 | 13.7 | +13.7 | 13% |
| tasks and scheduling (other native) | 67.0 | 80.2 | +13.2 | 13% |
| messaging: postMessage (serialize) | 2.1 | 14.2 | +12.1 | 12% |
| JS: other (chunk:engines-CkTd-MtY.js) | 0.0 | 11.7 | +11.7 | 11% |
| JS: other (chunk:signals-B7SclRPQ.js) | 0.0 | 7.3 | +7.3 | 7% |
| JS: browser API calls | 21.4 | 25.8 | +4.4 | 4% |
| JS: other (chunk:Plot-CnfPZq9u.js) | 0.0 | 4.0 | +4.0 | 4% |
| animation frames in workers | 0.0 | 3.7 | +3.7 | 4% |
| JS: other (chunk:feed-k2K0u6V6.js) | 0.0 | 2.3 | +2.3 | 2% |
| JS: other (chunk:contracts-CY7oOBwG.js) | 0.0 | 2.0 | +2.0 | 2% |
| not covered by trace events (other threads) | 14.0 | 15.3 | +1.3 | 1% |
| JS: other (chunk:dist-Dno6VrTf.js) | 0.0 | 1.0 | +1.0 | 1% |
| JS: other (chunk:machine-dom-BNutpN8W.js) | 0.0 | 0.9 | +0.9 | 1% |
| GC | 15.2 | 14.0 | -1.2 | -1% |
| compositor thread | 28.0 | 20.9 | -7.1 | -7% |
| JS: other (chunk:machine.worker-DT-_E-Yh.js) | 19.8 | 0.0 | -19.8 | -19% |
| canvas and tiles: raster and present | 372.2 | 343.1 | -29.1 | -28% |
| style, layout, paint, commit | 189.1 | 144.6 | -44.5 | -43% |
| JS: other (chunk:index-DSptTvW8.js) | 68.4 | 0.0 | -68.4 | -66% |

### native (A) vs isoloop:one (B), 1 kHz, 4/4 runs

Renderer CPU: A 802 ms/s, B 882 ms/s, gap +80 ms/s. Main thread A 708, B 248; workers A 0 (0), B 531 (2); other renderer threads A 94, B 109. Kernel time within it A 22, B 48 (on worker threads A 0, B 15). GPU process A 289, B 341; browser process A 2, B 3. Trace-event coverage of busy threads: A 89%, B 93%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 6.1 | 72.3 | +66.2 | 83% |
| JS: other (chunk:index-B1w7lIGG.js) | 0.0 | 60.2 | +60.2 | 75% |
| not covered by trace events (JS threads) | 9.7 | 46.2 | +36.5 | 46% |
| JS: other (chunk:machine-canvas-BUOF0HV5.js) | 0.0 | 29.1 | +29.1 | 36% |
| tasks and scheduling (other native) | 57.2 | 78.7 | +21.6 | 27% |
| JS: other (chunk:engines-CkTd-MtY.js) | 0.0 | 17.5 | +17.5 | 22% |
| JS: other (chunk:worker-B2MNozAn.js) | 0.0 | 15.0 | +15.0 | 19% |
| JS: other (chunk:withStress-BKgpKcHj.js) | 0.0 | 14.4 | +14.4 | 18% |
| JS: other (chunk:signals-B7SclRPQ.js) | 0.0 | 10.0 | +10.0 | 12% |
| JS: other (chunk:bus-worker-BsOwxacr.js) | 0.0 | 8.6 | +8.6 | 11% |
| JS: browser API calls | 20.3 | 27.4 | +7.1 | 9% |
| messaging: postMessage (serialize) | 0.6 | 7.6 | +7.0 | 9% |
| GC | 15.4 | 21.0 | +5.6 | 7% |
| animation frames in workers | 0.0 | 3.7 | +3.7 | 5% |
| JS: other (chunk:Plot-CnfPZq9u.js) | 0.0 | 3.5 | +3.5 | 4% |
| not covered by trace events (other threads) | 14.8 | 17.8 | +3.0 | 4% |
| JS: other (chunk:feed-k2K0u6V6.js) | 0.0 | 1.4 | +1.4 | 2% |
| JS: other (chunk:contracts-CY7oOBwG.js) | 0.0 | 1.1 | +1.1 | 1% |
| JS: other (chunk:machine-dom-BNutpN8W.js) | 0.0 | 0.6 | +0.6 | 1% |
| compositor thread | 27.8 | 24.2 | -3.7 | -5% |
| canvas and tiles: raster and present | 381.9 | 318.1 | -63.8 | -80% |
| style, layout, paint, commit | 194.8 | 122.9 | -71.9 | -90% |
| JS: other (chunk:index-Edadf9bw.js) | 83.2 | 0.0 | -83.2 | -104% |

### native (A) vs isobatch:one (B), 1 kHz, 4/4 runs

Renderer CPU: A 802 ms/s, B 923 ms/s, gap +121 ms/s. Main thread A 708, B 245; workers A 0 (0), B 585 (2); other renderer threads A 94, B 109. Kernel time within it A 22, B 48 (on worker threads A 0, B 17). GPU process A 289, B 350; browser process A 2, B 2. Trace-event coverage of busy threads: A 89%, B 93%.

| Bucket | A ms/s | B ms/s | B − A | Share of gap |
| --- | --- | --- | --- | --- |
| messaging: serialize, deserialize, IPC | 6.1 | 67.5 | +61.4 | 51% |
| JS: other (chunk:index-B0iOEnn7.js) | 0.0 | 59.2 | +59.2 | 49% |
| not covered by trace events (JS threads) | 9.7 | 48.0 | +38.3 | 32% |
| JS: other (chunk:machine-canvas-BUOF0HV5.js) | 0.0 | 30.5 | +30.5 | 25% |
| JS: other (chunk:engines-CkTd-MtY.js) | 0.0 | 19.8 | +19.8 | 16% |
| tasks and scheduling (other native) | 57.2 | 74.0 | +16.8 | 14% |
| JS: other (chunk:worker-B2MNozAn.js) | 0.0 | 16.5 | +16.5 | 14% |
| JS: other (chunk:withStress-BKgpKcHj.js) | 0.0 | 15.5 | +15.5 | 13% |
| JS: browser API calls | 20.3 | 32.0 | +11.7 | 10% |
| JS: other (chunk:signals-B7SclRPQ.js) | 0.0 | 11.5 | +11.5 | 9% |
| JS: other (chunk:bus-worker-BsOwxacr.js) | 0.0 | 11.2 | +11.2 | 9% |
| messaging: postMessage (serialize) | 0.6 | 7.7 | +7.2 | 6% |
| animation frames in workers | 0.0 | 4.0 | +4.0 | 3% |
| not covered by trace events (other threads) | 14.8 | 18.0 | +3.2 | 3% |
| JS: other (chunk:Plot-CnfPZq9u.js) | 0.0 | 2.7 | +2.7 | 2% |
| JS: other (chunk:feed-k2K0u6V6.js) | 0.0 | 1.6 | +1.6 | 1% |
| GC | 15.4 | 16.8 | +1.4 | 1% |
| JS: other (chunk:contracts-CY7oOBwG.js) | 0.0 | 1.0 | +1.0 | 1% |
| JS: other (chunk:machine-dom-BNutpN8W.js) | 0.0 | 0.9 | +0.9 | 1% |
| JS: other (chunk:dist-Dno6VrTf.js) | 0.0 | 0.6 | +0.6 | 1% |
| canvas and tiles: raster and present | 381.9 | 379.2 | -2.7 | -2% |
| compositor thread | 27.8 | 24.8 | -3.0 | -2% |
| style, layout, paint, commit | 194.8 | 120.7 | -74.1 | -61% |
| JS: other (chunk:index-Edadf9bw.js) | 83.2 | 0.0 | -83.2 | -69% |
