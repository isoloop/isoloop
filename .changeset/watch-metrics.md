---
'@isoloop/protocol': minor
'@isoloop/bus': minor
'@isoloop/devtools': minor
---

The bus metrics and the devtools panel show watched topics. These figures are experimental.

- Each topic row in `BusMetrics` gains `watch` once the topic has had a watch: the watches on it now, the distinct keys they hold, the transport (`'messages'`), and the records appended while each watch was on the topic and the values sent to watches, since the bus worker started. The host's watches are counted with the isolates'.
- The devtools bus view lists watched topics under the topics table, with how many of the topic's records each watch showed, in words, such as "showed 1 of every 40 records on the topic".
