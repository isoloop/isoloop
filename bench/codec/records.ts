// Realistic topic records for the codec evaluation (M2b task 2): the markets
// dashboard's trades and book updates (M3b), and the four-loops topics.

const symbols: [string, ...string[]] = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BTC-EUR', 'ETH-BTC'];
const exchanges: [string, ...string[]] = ['coinbase', 'kraken', 'bitstamp'];

// A deterministic generator, so every run benches the same bytes.
let seed = 42;
const rand = (): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};
const pick = <T>(a: readonly [T, ...T[]]): T => a[Math.floor(rand() * a.length)] ?? a[0];
const price = (): number => Math.round((20_000 + rand() * 50_000) * 100) / 100;

export interface Trade {
  exchange: string;
  symbol: string;
  id: number;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  ts: number;
}

export const trade = (i: number): Trade => ({
  exchange: pick(exchanges),
  symbol: pick(symbols),
  id: 1_000_000_000 + i,
  price: price(),
  size: Math.round(rand() * 1e6) / 1e6,
  side: rand() < 0.5 ? 'buy' : 'sell',
  ts: 1_762_500_000_000 + i * 37,
});

export interface Book {
  exchange: string;
  symbol: string;
  seq: number;
  bids: [number, number][];
  asks: [number, number][];
  ts: number;
}

const levels = (): [number, number][] =>
  Array.from({ length: 10 }, () => [price(), Math.round(rand() * 1e4) / 1e4]);

export const book = (i: number): Book => ({
  exchange: pick(exchanges),
  symbol: pick(symbols),
  seq: 50_000_000 + i,
  bids: levels(),
  asks: levels(),
  ts: 1_762_500_000_000 + i * 100,
});

/** The four-loops topics, mixed: count.v1, note.v1, primes.v1, store.v1. */
export const fourLoops = (i: number): unknown => {
  switch (i % 4) {
    case 0:
      return i;
    case 1:
      return `note ${i}: the quick brown fox`;
    case 2:
      return { count: 78_498, ms: Math.round(rand() * 5000) / 100 };
    default:
      return { count: i, notes: i % 17 };
  }
};

export const sets: [string, (i: number) => unknown][] = [
  ['trades', trade],
  ['book updates', book],
  ['four-loops', fourLoops],
];
