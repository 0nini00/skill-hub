import type { BackendResult } from "../../shared/types/skill";
import { ensureBaseDirs } from "../database/paths";
import { openDatabase } from "../database/sqlite";
import { detectCliRows } from "./cliRegistryService";
import {
  addCustomCli,
  getAiConfig,
  getConfig,
  getVisibleClis,
  removeCustomCli,
  setAiConfig,
  setVisibleClis,
} from "./configService";
import { autoSummarizeLocal } from "./aiSummaryService";
import {
  deleteSkill,
  hideSkill,
  installProjectSkills,
  linkSkill,
  unhideSkill,
  unlinkSkill,
} from "./skillInstallService";
import { getNativeAppState, scanLocalSkills } from "./skillLibraryService";
import { installUrl } from "./remoteSkillService";

interface NativeCommandResult<T = unknown> {
  handled: boolean;
  result?: BackendResult<T>;
}

export async function tryRunNativeBackend<T = unknown>(args: string[]): Promise<NativeCommandResult<T>> {
  const command = args[0];
  if (!command) {
    return { handled: false };
  }

  try {
    switch (command) {
      case "init":
        ensureBaseDirs();
        openDatabase().close();
        return success(null as T);
      case "app-state":
        return success(getNativeAppState() as T);
      case "detect-clis":
        return success(detectCliRows() as T);
      case "scan-local":
        return success(scanLocalSkills() as T);
      case "get-visible-clis":
        return success(getVisibleClis() as T);
      case "set-visible-clis":
        setVisibleClis(readOption(args, "--clis").split(","));
        return success({ ok: true } as T);
      case "add-custom-cli":
        addCustomCli(readOption(args, "--name"), readOption(args, "--path"));
        return success({ ok: true } as T);
      case "remove-custom-cli":
        removeCustomCli(readOption(args, "--name") || readPositional(args, 0));
        return success({ ok: true } as T);
      case "list-custom-clis":
        return success((getConfig().custom_clis ?? {}) as T);
      case "get-ai-config":
        return success(getAiConfig() as T);
      case "set-ai-config":
        setAiConfig({
          api_url: readOption(args, "--url"),
          api_key: readOption(args, "--key"),
          model: readOption(args, "--model"),
          proxy: readOption(args, "--proxy"),
        });
        return success({ ok: true } as T);
      case "link-skill":
        return success(linkSkill(readPositional(args, 0), readPositional(args, 1)) as T);
      case "unlink-skill":
        return success(unlinkSkill(readPositional(args, 0), readPositional(args, 1)) as T);
      case "hide-skill":
      case "remove-skill":
        return success(hideSkill(readPositional(args, 0)) as T);
      case "unhide-skill":
        return success(unhideSkill(readPositional(args, 0)) as T);
      case "delete-skill":
      case "delete-hidden-skill":
        return success((await deleteSkill(readPositional(args, 0))) as T);
      case "install-project-skills":
        return success(installProjectSkills(readOption(args, "--project"), readOption(args, "--skills"), readOption(args, "--clis")) as T);
      case "install-url":
        return success((await installUrl(readOption(args, "--url") || readPositional(args, 0), readOption(args, "--slug") || undefined)) as T);
      case "install-remote":
        return success((await installUrl(readOption(args, "--url"), readOption(args, "--skill") || readOption(args, "--slug") || undefined)) as T);
      case "auto-summarize":
        return success((await autoSummarizeLocal()) as T);
      default:
        return { handled: false };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "原生 TS 命令执行失败";
    return {
      handled: true,
      result: {
        ok: false,
        data: null,
        stdout: "",
        stderr: message,
        message,
      },
    };
  }
}

function success<T>(data: T): NativeCommandResult<T> {
  const stdout = data === null ? "" : `${JSON.stringify(data)}\n`;
  return {
    handled: true,
    result: {
      ok: true,
      data,
      stdout,
      stderr: "",
    },
  };
}

function readOption(args: string[], option: string): string {
  const index = args.indexOf(option);
  if (index < 0 || index + 1 >= args.length) {
    return "";
  }
  return args[index + 1] ?? "";
}

function readPositional(args: string[], position: number): string {
  const values = args.slice(1).filter((item, index, source) => {
    if (item.startsWith("--")) {
      return false;
    }
    return index === 0 || !source[index - 1].startsWith("--");
  });
  return values[position] ?? "";
}
