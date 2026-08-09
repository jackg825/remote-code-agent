import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";

if (process.platform !== "win32") {
  const helpers = [
    join(
      "node_modules",
      "node-pty",
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    ),
    join("node_modules", "node-pty", "build", "Release", "spawn-helper"),
  ];

  for (const helper of helpers) {
    try {
      const metadata = await stat(helper);
      await chmod(helper, metadata.mode | 0o111);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
}
