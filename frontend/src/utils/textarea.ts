export type InsertTextResult = {
  nextValue: string;
  caret: number;
};

export const insertTextAtSelection = (
  value: string,
  textToInsert: string,
  selectionStart: number,
  selectionEnd: number
): InsertTextResult => {
  const max = value.length;
  const start = Math.max(0, Math.min(Number.isFinite(selectionStart) ? selectionStart : max, max));
  const endRaw = Math.max(0, Math.min(Number.isFinite(selectionEnd) ? selectionEnd : start, max));
  const end = Math.max(start, endRaw);
  const nextValue = `${value.slice(0, start)}${textToInsert}${value.slice(end)}`;
  return { nextValue, caret: start + textToInsert.length };
};
