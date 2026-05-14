import type { BackendResult } from "../../shared/types/skill";
import { tryRunNativeBackend } from "./nativeBackendCommands";

export async function runBackend<T = unknown>(args: string[]): Promise<BackendResult<T>> {
  const nativeCommand = await tryRunNativeBackend<T>(args);
  if (nativeCommand.handled && nativeCommand.result) {
    return nativeCommand.result;
  }
  const command = args[0] ?? "";
  return {
    ok: false,
    data: null,
    stdout: "",
    stderr: `未实现的 TS 后端命令: ${command}`,
    message: `未实现的 TS 后端命令: ${command}`,
  };
}
