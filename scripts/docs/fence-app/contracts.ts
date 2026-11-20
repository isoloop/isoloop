// The example app's contracts module, which the guides' fences import as
// `./contracts` (its default export is the list) and `./contracts?isolate`.
import { contracts, topic } from '@isoloop/bus';
import * as s from './schemas';

export const quoteTool = topic('markets.quote.v1', {
  schema: s.quoteRequest,
  reply: s.quoteReply,
  retention: { kind: 'last-n', n: 100 },
  tool: { description: 'The latest figures for one symbol.', readOnly: true },
});

export const createAlertTool = topic('markets.alerts.create.v1', {
  schema: s.alertRule,
  reply: s.alertCreated,
  retention: { kind: 'last-n', n: 100 },
  tool: { description: 'Adds an alert rule.', readOnly: false, consequential: true },
});

export default contracts(quoteTool, createAlertTool);
