import { describe, expect, test } from "bun:test";
import { DockerSandbox } from "../src/sandbox/docker";

const disabled = new DockerSandbox({
  enabled: false,
  image: "none",
  workspace: process.cwd(),
  memoryMb: 128,
  cpus: 1,
});

describe("DockerSandbox", () => {
  test("reports disabled without contacting Docker", async () => {
    expect(await disabled.doctor()).toEqual({ ok: true, detail: "disabled" });
  });

  test("refuses execution while disabled", async () => {
    expect(disabled.run("echo unsafe")).rejects.toThrow("disabled");
  });
});
