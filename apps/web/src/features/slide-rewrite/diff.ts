import type { SelectionRewrite } from "@deck-rehearsal/contracts";
/** Word/Chinese phrase diff; bounded LCS avoids quadratic work on long selections. */
export function textDiff(
  before: string,
  after: string,
): SelectionRewrite["diff"] {
  const segment = (text: string) =>
    Array.from(
      new Intl.Segmenter("zh", { granularity: "word" }).segment(text),
      (s) => s.segment,
    );
  const a = segment(before),
    b = segment(after);
  if (a.length * b.length > 250000)
    return [
      { type: "delete", text: before },
      { type: "insert", text: after },
    ];
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      (table[i] ?? new Uint32Array())[j] =
        a[i] === b[j]
          ? 1 + (table[i + 1]?.[j + 1] ?? 0)
          : Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0);
  const result: SelectionRewrite["diff"] = [];
  const push = (
    type: SelectionRewrite["diff"][number]["type"],
    text: string,
  ) => {
    const last = result.at(-1);
    if (last?.type === type) last.text += text;
    else result.push({ type, text });
  };
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("equal", a[i++] ?? "");
      j++;
    } else if (
      i < a.length &&
      (j === b.length || (table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0))
    )
      push("delete", a[i++] ?? "");
    else push("insert", b[j++] ?? "");
  }
  return result;
}
