import { CHARACTERS } from "./characters.data";
import { pickRandomCharacter, CharacterPickOptions } from "./characters.utils";

export function getRandomCharacter(opts?: CharacterPickOptions) {
  return pickRandomCharacter(CHARACTERS, opts);
}