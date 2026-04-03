import { mkdir, appendFile } from "fs/promises";
import { dirname } from "path";

/**
 * Appends formatted transcript lines to a local file.
 * Creates the directory and file if they don't exist.
 */
export async function appendLines(lines: string[], filePath: string): Promise<void> {
  if (lines.length === 0) return;
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, lines.join("\n") + "\n", "utf8");
}
