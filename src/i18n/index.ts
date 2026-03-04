import { en } from "./en";
import { fr } from "./fr";

export const translations = {
  fr,
  en,
} as const;

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof translations.fr;
