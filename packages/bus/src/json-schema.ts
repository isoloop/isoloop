/*
 * Run-time JSON Schema through Standard JSON Schema (ADR 0003, decision 21;
 * ADR 0018, decision 1). The module lives in `@isoloop/protocol`, so the
 * host's agent tools and `isoloop contracts export` share it; the bus
 * re-exports it for tools that already import the bus.
 */
export {
  hasJsonSchema,
  jsonSchemaOf,
  topicJsonSchemas,
  JSON_SCHEMA_TARGET,
  type StandardJSONSchemaV1,
  type JsonSchema,
  type JsonSchemaPair,
  type JsonSchemaResult,
  type NotExportableReason,
  type TopicJsonSchemas,
  type TopicJsonSchemasResult,
} from '@isoloop/protocol';
