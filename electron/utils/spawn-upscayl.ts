import { spawn } from "child_process";
import { execPath } from "./get-resource-paths";
import { MOSR_PREVIEW_MODEL } from "../../common/mosr-preview";
import { spawnMosr } from "./spawn-mosr";

export const spawnUpscayl = (
  command: string[],
  logit: (...args: any) => void,
) => {
  logit(
    "📢 Upscayl Command: ",
    command.filter((arg) => arg !== ""),
  );

  if (command[command.indexOf("-n") + 1] === MOSR_PREVIEW_MODEL) return spawnMosr(command);

  const spawnedProcess = spawn(
    execPath,
    command.filter((arg) => arg !== ""),
    {
      cwd: undefined,
      detached: false,
    },
  );

  let cancelled = false;
  return {
    process: spawnedProcess,
    kill: () => spawnedProcess.kill(),
    cancel: () => {
      cancelled = true;
      spawnedProcess.kill();
    },
    isCancelled: () => cancelled,
  };
};
