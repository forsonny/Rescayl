import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { app } from "electron";
import { assertOutputAccess } from "../path-access";

export const spawnMosr = (command: string[]) => {
  const input = command[command.indexOf("-i") + 1];
  const output = command[command.indexOf("-o") + 1];
  const gpuFlag = command.indexOf("-g");
  const gpuLuid = gpuFlag < 0 ? "" : command[gpuFlag + 1];
  const staged = path.join(path.dirname(output), `.rescayl-mosr-${randomUUID()}.png`);
  assertOutputAccess(staged);
  const child = spawn(process.execPath, [
    path.join(app.getAppPath(), "export", "electron", "mosr-worker.js"),
    input, staged, path.join(app.getPath("userData"), "models", "mosr-preview"), gpuLuid,
  ], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
    detached: false,
  });
  let cancelled = false;
  let failed = false;
  child.on("error", () => { failed = true; });
  // Publish before the shared job handler observes close. A stopped or failed
  // worker can never replace a previously completed image.
  child.on("close", (code, signal) => {
    try {
      if (!cancelled && !failed && code === 0 && !signal) {
        if (!fs.statSync(staged).isFile() || fs.statSync(staged).size === 0) throw new Error("MoSR produced no image.");
        assertOutputAccess(output);
        fs.renameSync(staged, output);
      }
    } catch (error) {
      child.emit("error", error);
    } finally {
      try { fs.rmSync(staged, { force: true }); }
      catch (error) { child.emit("error", error); }
    }
  });
  return {
    process: child,
    kill: () => { failed = true; return child.kill(); },
    cancel: () => { cancelled = true; child.kill(); },
    isCancelled: () => cancelled,
  };
};
