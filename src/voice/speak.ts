import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";
import type { VoiceConfig } from "../core/config";

const exec = promisify(execFile);

function resolveEngine(config: VoiceConfig): VoiceConfig["engine"] {
  if (config.engine !== "auto") return config.engine;
  if (platform() === "darwin") return "say";
  if (platform() === "win32") return "powershell";
  return "espeak";
}

/**
 * Speaks text out loud using whatever native OS text-to-speech binary is
 * available. There is no bundled TTS engine or model — this shells out to
 * `say` (macOS), `espeak-ng`/`espeak`/`spd-say` (Linux), or PowerShell's
 * System.Speech (Windows). If none is installed, this throws a clear error
 * instead of silently doing nothing, matching how the browser/sandbox
 * adapters report missing dependencies.
 */
export async function speak(text: string, config: VoiceConfig) {
  if (!config.enabled) throw new Error("Voice output is disabled in config.");
  const clean = text.replace(/[`$]/g, "").slice(0, 2000);
  if (!clean.trim()) throw new Error("Nothing to speak.");
  const engine = resolveEngine(config);
  if (engine === "say") {
    await exec("say", [
      "-r",
      String(Math.max(90, Math.round(180 * config.rate))),
      clean,
    ]);
    return { engine: "say" as const };
  }
  if (engine === "espeak" || engine === "spd-say") {
    try {
      await exec("espeak-ng", [clean]);
      return { engine: "espeak-ng" as const };
    } catch {
      try {
        await exec("espeak", [clean]);
        return { engine: "espeak" as const };
      } catch {
        await exec("spd-say", [clean]);
        return { engine: "spd-say" as const };
      }
    }
  }
  if (engine === "powershell") {
    // Single-quoted PowerShell strings don't interpolate `$()`/backticks;
    // `clean` already strips `$` and backticks, and we escape `'` -> `''`,
    // so the text can't break out of the string. Args are passed via the
    // execFile array (no shell), not command-string interpolation.
    const escaped = clean.replace(/'/g, "''");
    const script = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${escaped}')`;
    await exec("powershell", ["-NoProfile", "-Command", script]);
    return { engine: "powershell" as const };
  }
  throw new Error(`No text-to-speech engine available for ${engine}.`);
}
