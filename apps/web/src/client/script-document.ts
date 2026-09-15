import type { ScriptDocument } from "@deck-rehearsal/contracts";
/** Preserve unaffected UTF-16 ranges across one contiguous edit. */
export function editDocument(
  document: ScriptDocument,
  text: string,
): ScriptDocument {
  let start = 0;
  while (
    start < document.text.length &&
    start < text.length &&
    document.text[start] === text[start]
  )
    start++;
  let oldEnd = document.text.length;
  let newEnd = text.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    document.text[oldEnd - 1] === text[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  return replaceDocumentRange(
    document,
    start,
    oldEnd,
    text.slice(start, newEnd),
  );
}
/** Split intersecting marks so formatting outside the replacement is never lost. */
export function replaceDocumentRange(
  document: ScriptDocument,
  start: number,
  end: number,
  replacement: string,
): ScriptDocument {
  const delta = replacement.length - (end - start);
  return {
    ...document,
    text:
      document.text.slice(0, start) + replacement + document.text.slice(end),
    marks: document.marks.flatMap((mark) => {
      if (mark.end <= start) return [mark];
      if (mark.start >= end)
        return [{ ...mark, start: mark.start + delta, end: mark.end + delta }];
      if (mark.start <= start && mark.end >= end)
        return [{ ...mark, end: mark.end + delta }].filter(
          (m) => m.end > m.start,
        );
      return [
        ...(mark.start < start ? [{ ...mark, end: start }] : []),
        ...(mark.end > end
          ? [
              {
                ...mark,
                start: start + replacement.length,
                end: mark.end + delta,
              },
            ]
          : []),
      ];
    }),
    annotations: document.annotations.map((a) =>
      a.invalid || a.end <= start
        ? a
        : a.start >= end
          ? { ...a, start: a.start + delta, end: a.end + delta }
          : { ...a, invalid: true },
    ),
  };
}
