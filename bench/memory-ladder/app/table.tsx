// The ladder's React widget: a table of 20 rows by 6 columns, rendered once.
// The same component runs in an isolate and on the page's main thread.
export function Table({ id }: { id: string }) {
  const rows = Array.from({ length: 20 }, (_, r) => r);
  return (
    <table data-id={id}>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            {[0, 1, 2, 3, 4, 5].map((c) => (
              <td key={c}>{(r * 6 + c) / 10}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
