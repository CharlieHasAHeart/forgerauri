const normalize = (text: string): string => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export const makeUnifiedDiff = (opts: { oldText: string; newText: string; filePath: string }): string => {
  const oldLines = normalize(opts.oldText).split("\n");
  const newLines = normalize(opts.newText).split("\n");

  const max = Math.max(oldLines.length, newLines.length);
  const body: string[] = [];

  for (let i = 0; i < max; i += 1) {
    const left = oldLines[i];
    const right = newLines[i];

    if (left === right) {
      if (left !== undefined) body.push(` ${left}`);
      continue;
    }

    if (left !== undefined) body.push(`-${left}`);
    if (right !== undefined) body.push(`+${right}`);
  }

  return [
    `--- a/${opts.filePath}`,
    `+++ b/${opts.filePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...body
  ].join("\n");
};
