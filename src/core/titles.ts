import type { Role } from './types.ts';

/**
 * Titles must read consistently with the role they belong to, so that nobody
 * — human or model — has to guess someone's standing from their job name.
 * The title still carries WHICH house; the role still carries rank.
 */
export const titleFor = (role: Role, house?: string): string => {
  switch (role) {
    case 'innkeeper': return 'Inn Keeper';
    case 'chief_of_staff': return 'Chief of Staff';
    case 'house_manager': return house ? `${house} Manager` : 'House Manager';
    case 'house_assistant': return house ? `${house} Assistant` : 'House Assistant';
  }
};

/** Guard against vocabulary drift as the staff hire more staff. */
export const titleMatchesRole = (role: Role, title: string): boolean => {
  switch (role) {
    case 'innkeeper': return /^inn ?keeper$/i.test(title.trim());
    case 'chief_of_staff': return /^chief of staff$/i.test(title.trim());
    case 'house_manager': return /\bmanager$/i.test(title.trim());
    case 'house_assistant': return /\bassistant$/i.test(title.trim());
  }
};
