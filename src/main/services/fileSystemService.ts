import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

export function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(fs.realpathSync.native(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isDirectChildPath(child: string, parent: string): boolean {
  return path.resolve(path.dirname(child)).toLowerCase() === path.resolve(parent).toLowerCase();
}

export function isLinkLike(targetPath: string): boolean {
  try {
    if (fs.lstatSync(targetPath).isSymbolicLink()) { return true; } if (process.platform === "win32" && isDirectory(targetPath)) { try { const real = fs.realpathSync(targetPath); return path.resolve(targetPath).toLowerCase() !== real.toLowerCase(); } catch { /* broken junction */ } } return false;
  } catch {
    return false;
  }
}

export function removeLink(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  if (!isLinkLike(targetPath)) {
    throw new Error(`目标不是受控链接，已跳过: ${targetPath}`);
  }
  fs.rmSync(targetPath, { recursive: true, force: false });
  return true;
}

export function createLink(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`源技能不存在: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) {
    removeLink(targetPath);
  }
  const sourceIsDirectory = isDirectory(sourcePath);
  const linkType = process.platform === "win32" && sourceIsDirectory ? "junction" : sourceIsDirectory ? "dir" : "file";
  fs.symlinkSync(sourcePath, targetPath, linkType);
}

export function removeTree(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return true;
  }
  fs.rmSync(targetPath, { recursive: true, force: false });
  return !fs.existsSync(targetPath);
}

export function copyDirectory(sourcePath: string, targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return name !== ".git" && name !== "__pycache__" && !name.endsWith(".pyc");
    },
  });
}

export async function recyclePath(targetPath: string): Promise<boolean> {
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  if (isLinkLike(targetPath)) {
    return removeLink(targetPath);
  }
  if (process.platform !== "win32") {
    fs.rmSync(targetPath, { recursive: true, force: false });
    return !fs.existsSync(targetPath);
  }
  const script = `
Add-Type -AssemblyName Microsoft.VisualBasic
$targetPath = $env:SKILL_HUB_DELETE_TARGET
if ([string]::IsNullOrWhiteSpace($targetPath)) {
    throw "SKILL_HUB_DELETE_TARGET is empty"
}
$target = Get-Item -LiteralPath $targetPath -Force
if ($target.PSIsContainer) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
        $target.FullName,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
} else {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $target.FullName,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
}
`;
  await runProcess("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    SKILL_HUB_DELETE_TARGET: targetPath,
  });
  return !fs.existsSync(targetPath);
}

export function runProcess(
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  cwd?: string,
  timeoutMs = 120000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`命令超时: ${command}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}
