import { execSync } from "node:child_process";

export const DEFAULT_DEV_PORT = 3000;

export function killProcessOnPort(port = DEFAULT_DEV_PORT) {
  if (process.platform === "win32") {
    try {
      const output = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      const pids = new Set();

      output.split("\n").forEach((line) => {
        if (!line.includes("LISTENING")) return;

        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) return;

        const localAddress = parts[1] || "";
        const pid = parts[parts.length - 1];
        const portSuffix = `:${port}`;

        if (!localAddress.endsWith(portSuffix)) return;
        if (pid && pid !== "0") pids.add(pid);
      });

      pids.forEach((pid) => {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`Stopped stale process ${pid} on port ${port}.`);
        } catch {
          // Process may already be gone.
        }
      });
    } catch {
      // No listeners on this port.
    }
    return;
  }

  try {
    execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: "ignore",
      shell: true,
    });
  } catch {
    // No listeners on this port.
  }
}
