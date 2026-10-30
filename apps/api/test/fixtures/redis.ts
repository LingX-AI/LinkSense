import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "ioredis";

export async function createRedisFixture(): Promise<{
  client: Redis;
  close(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "lsbr-rate-"));
  const socket = join(directory, "redis.sock");
  const server = spawn(process.env.REDIS_SERVER_BIN ?? "redis-server", [
    "--port", "0", "--unixsocket", socket, "--unixsocketperm", "700",
    "--save", "", "--appendonly", "no",
  ], { stdio: ["ignore", "pipe", "ignore"] });
  const client = new Redis({ path: socket, lazyConnect: true, maxRetriesPerRequest: 0 });
  const close = async () => {
    client.disconnect();
    server.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Redis fixture startup timed out")), 5000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      server.once("error", finish);
      server.once("exit", () => finish(new Error("Redis fixture exited")));
      server.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().toLowerCase().includes("ready to accept connections")) finish();
      });
    });
    await client.connect();
    return { client, close };
  } catch (error) {
    await close();
    throw error;
  }
}
