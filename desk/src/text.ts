/**
 * One line of the line of business, for the places where one line is all
 * there is room for.
 *
 * The field used to hold two or three words, so the switcher and the company
 * list rendered it whole and nobody noticed. It now holds the founder's whole
 * brief — and a paragraph of it under the company name pushes the rail
 * around and buries the name it belongs to.
 *
 * The full text stays in the title attribute, and the Rename dialog is where
 * you read and edit it.
 */
export const tagline = (text: string | null | undefined, max = 80): string => {
  const line = (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (line.length <= max) return line;
  // Cut on a word if one is near the end; a mid-word ellipsis reads as damage.
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s,;:.—-]+$/, '')}…`;
};
