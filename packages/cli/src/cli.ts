#!/usr/bin/env node
// The `isoloop` bin. Everything testable is in main.ts.
import { fileURLToPath } from 'node:url';
import { nodeIo } from './program/io';
import { main } from './program/main';

// The build copies the repo's skills/ next to this file (dist/skills/).
const skills = fileURLToPath(new URL('./skills/', import.meta.url));
process.exitCode = await main(process.argv.slice(2), nodeIo(skills));
