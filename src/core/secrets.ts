import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const service = "wednesday";

function runWithInput(command: string, args: string[], input: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => {
      error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(error || `${command} exited ${code}`)),
    );
    child.stdin.end(input);
  });
}

export class SecretStore {
  async backend() {
    if (platform() === "darwin") return "macOS Keychain";
    if (platform() === "win32") return "Windows DPAPI";
    try {
      await exec("secret-tool", ["--version"]);
      return "Secret Service";
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return "unavailable";
      // `--version`/`--help` may exit non-zero on some builds; the binary
      // exists, so the Secret Service backend is available.
      return "Secret Service";
    }
  }

  async get(name: string): Promise<string | undefined> {
    try {
      if (platform() === "darwin")
        return (
          (
            await exec("security", [
              "find-generic-password",
              "-a",
              name,
              "-s",
              service,
              "-w",
            ])
          ).stdout.trim() || undefined
        );
      if (platform() === "win32") {
        const path = join(
          homedir(),
          "AppData",
          "Local",
          "Wednesday",
          "secrets",
          `${name}.dpapi`,
        );
        const encrypted = (await readFile(path, "utf8")).trim();
        const script = `$b=[Convert]::FromBase64String('${encrypted}');$d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($d)`;
        return (
          (
            await exec("powershell", [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              script,
            ])
          ).stdout.trim() || undefined
        );
      }
      return (
        (
          await exec("secret-tool", [
            "lookup",
            "service",
            service,
            "account",
            name,
          ])
        ).stdout.trim() || undefined
      );
    } catch {
      return undefined;
    }
  }

  async set(name: string, secret: string) {
    if (!secret) throw new Error("Secret cannot be empty");
    if (platform() === "darwin") {
      await exec("security", [
        "delete-generic-password",
        "-a",
        name,
        "-s",
        service,
      ]).catch(() => undefined);
      await runWithInput(
        "security",
        ["add-generic-password", "-a", name, "-s", service, "-w"],
        secret,
      );
      return;
    }
    if (platform() === "win32") {
      const path = join(
        homedir(),
        "AppData",
        "Local",
        "Wednesday",
        "secrets",
        `${name}.dpapi`,
      );
      await mkdir(dirname(path), { recursive: true });
      const encoded = Buffer.from(secret).toString("base64");
      const script = `$d=[Convert]::FromBase64String('${encoded}');$b=[Security.Cryptography.ProtectedData]::Protect($d,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($b)`;
      const encrypted = (
        await exec("powershell", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          script,
        ])
      ).stdout.trim();
      await writeFile(path, encrypted, { mode: 0o600 });
      return;
    }
    if ((await this.backend()) === "unavailable")
      throw new Error(
        "Install secret-tool and a Secret Service provider; plaintext secret storage is intentionally unsupported",
      );
    await runWithInput(
      "secret-tool",
      ["store", "--label=Wednesday", "service", service, "account", name],
      secret,
    );
  }
}

export function providerSecretName(provider: string) {
  return `model:${provider}`;
}
