---
'@isoloop/react': patch
'@isoloop/preact': patch
---

The docs for `useTopic` say that an isolate has one subscription per topic: a second `useTopic` on the same topic replaces the first with no error, so only the last one gets records. They suggest one `useTopic` per topic, with the value passed down or shared through context.
