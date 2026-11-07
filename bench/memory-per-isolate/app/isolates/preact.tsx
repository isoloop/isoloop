/** @jsxImportSource preact */
// An idle Preact isolate: a small static tree, then nothing.
import { defineIsolate, useIsolate } from '@isoloop/preact';

function Idle() {
  return <p>idle {useIsolate().id}</p>;
}

export default defineIsolate(Idle);
