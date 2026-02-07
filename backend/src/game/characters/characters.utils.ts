import { CharacterAmbit, CharacterDifficulty, CharacterEntity } from "./characters.types";

export type CharacterPickOptions = {
  ambit?: CharacterAmbit;
  difficulty?: CharacterDifficulty;
  onlyActive?: boolean;
  excludeIds?: string[];
};

export function pickRandomCharacter(
  characters: CharacterEntity[],
  opts: CharacterPickOptions = {}
): CharacterEntity | null {
  const {
    ambit,
    difficulty,
    onlyActive = true,
    excludeIds = [],
  } = opts;

  const filtered = characters.filter(c => {
    if (onlyActive && !c.isActive) return false;
    if (difficulty && c.difficulty !== difficulty) return false;
    if (ambit && !c.ambit.includes(ambit)) return false;
    if (excludeIds.includes(c.id)) return false;
    return true;
  });

  if (!filtered.length) return null;
  const idx = Math.floor(Math.random() * filtered.length);
  return filtered[idx];
}
