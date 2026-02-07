export type CharacterAmbit =
  | "sports"
  | "cinema"
  | "music"
  | "streamers"
  | "politics"
  | "internet"
  | "other";

export type CharacterDifficulty = 1 | 2 | 3;

export interface CharacterEntity {
  id: string;
  name: string;
  ambit: CharacterAmbit[];
  difficulty: CharacterDifficulty;
  isActive: boolean;
  country?: string;
  aliases?: string[];
  source?: "manual" | "import";
}
