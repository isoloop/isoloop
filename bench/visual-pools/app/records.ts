/** What the feed sends each widget: a timestamp in the page's time base, and the data. */
export type VibRecord = { t: number; values: Float32Array };
export type ScalarRecord = {
  t: number;
  bearingC: [number, number];
  exhaustC: number;
  barG: number;
  rpm: number;
  kw: number;
};
export type Kind = 'vib' | 'scalars';
/** The plant dashboard's rates (M3d decision 4): vibration in 50 ms chunks at 1 kHz, slow signals every 200 ms. */
export const VIB_CHUNK_MS = 50;
export const VIB_SAMPLES = 50;
export const SCALARS_MS = 200;
/** Widgets 0–3 draw vibration, 4–7 slow signals, as a machine's panel would. */
export const kindOf = (member: number): Kind => (member < 4 ? 'vib' : 'scalars');
/** A timestamp both the page and any worker can compare. */
export const now = (): number => performance.timeOrigin + performance.now();
