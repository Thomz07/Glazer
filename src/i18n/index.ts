import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { de } from "./de";

export const translations = {
  fr,
  en,
  es,
  de,
} as const;

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof translations.fr;
