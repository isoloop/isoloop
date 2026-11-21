#!/usr/bin/env node
// The `isoloop` bin. Everything testable is in main.ts.
import { nodeIo } from './program/io';
import { main } from './program/main';

process.exitCode = await main(process.argv.slice(2), nodeIo());
