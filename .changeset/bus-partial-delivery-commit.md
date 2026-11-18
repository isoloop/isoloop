---
'@isoloop/protocol': minor
'@isoloop/bus': patch
'@isoloop/runtime': patch
---

A consumer-group member that stops partway through a delivery now keeps the records it settled (ADR 0016, point 17). A commit entry carries `partial`, how many records of the next delivery are settled, in the order they arrived, and the broker covers those too. Before, a commit covered a delivery only once all its records were settled. So a member that crashed partway through a batch had its settled records sent again, and a record that crashed every member it reached, once settled, came back until the kernel gave up on all of them.
