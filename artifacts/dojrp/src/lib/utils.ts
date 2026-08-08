// ─────────────────────────────────────────────────────────────────────────────
// lib/utils.ts  —  Shared utility functions
//
// cn(...classes) — merges Tailwind class strings safely using clsx +
// tailwind-merge.  Use it wherever you conditionally apply Tailwind classes
// to avoid specificity conflicts.
// ─────────────────────────────────────────────────────────────────────────────
import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
