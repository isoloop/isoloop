// Test isolate: throws during start, every time.
export default function main(): void {
  throw new Error('start threw');
}
