/*
 * The `0.2` step: one transform per change, each in its own file beside this
 * one, with its fixtures named after it in `fixtures/`.
 */
import { combine } from '../step';
import { healthyAfterMs } from './healthy-after-ms';

export const step = combine('0.2', [healthyAfterMs]);
