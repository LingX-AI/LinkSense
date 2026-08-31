import { constants, type Stats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

export interface StableRegularFileReadOptions {
  maximumBytes: number;
  invalidFileError(): Error;
  fileTooLargeError(sizeBytes: number): Error;
  afterInitialStat?: () => Promise<void>;
}

export async function readStableRegularFile(
  absolutePath: string,
  pathStats: Stats,
  options: StableRegularFileReadOptions,
): Promise<Buffer> {
  if (pathStats.size > options.maximumBytes) {
    throw options.fileTooLargeError(pathStats.size);
  }
  let handle: FileHandle;
  try {
    handle = await open(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch {
    throw options.invalidFileError();
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.dev !== pathStats.dev ||
      before.ino !== pathStats.ino
    ) {
      throw options.invalidFileError();
    }
    if (before.size > options.maximumBytes) {
      throw options.fileTooLargeError(before.size);
    }
    await options.afterInitialStat?.();

    const data = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < data.byteLength) {
      const result = await handle.read(
        data,
        offset,
        data.byteLength - offset,
        offset,
      );
      if (result.bytesRead === 0) throw options.invalidFileError();
      offset += result.bytesRead;
    }
    const trailing = Buffer.alloc(1);
    const extra = await handle.read(trailing, 0, 1, offset);
    const after = await handle.stat();
    if (
      extra.bytesRead !== 0 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw options.invalidFileError();
    }
    return data;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
