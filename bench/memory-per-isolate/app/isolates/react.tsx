// An idle React isolate: a small static tree, then nothing.
import { defineIsolate, useIsolate } from '@isoloop/react';

function Idle() {
  return <p>idle {useIsolate().id}</p>;
}

export default defineIsolate(Idle);
