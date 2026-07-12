export type ContractLanguage = "fr" | "en";

export const CONTRACT_LANGUAGE_LABELS: Record<ContractLanguage, string> = {
  fr: "Français",
  en: "English",
};

export function parseContractLanguage(value: unknown): ContractLanguage {
  return value === "en" ? "en" : "fr";
}
