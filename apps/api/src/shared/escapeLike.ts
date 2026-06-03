/** Escape LIKE/ILIKE wildcard characters in user input */
export function escapeLike(str: string): string {
  return str.replace(/%/g, '\\%').replace(/_/g, '\\_');
}
