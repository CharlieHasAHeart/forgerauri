import { readdir } from "node:fs/promises";

export const nextJsonCounter = async (dir: string): Promise<number> => {
  try {
    const files = await readdir(dir);
    const numbers = files
      .map((name) => {
        const match = name.match(/^(\d+)\.json$/);
        return match ? Number(match[1]) : -1;
      })
      .filter((num) => num >= 0);

    if (numbers.length === 0) {
      return 1;
    }

    return Math.max(...numbers) + 1;
  } catch {
    return 1;
  }
};
