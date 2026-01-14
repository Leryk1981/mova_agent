import * as childProcess from "child_process";
import { promisify } from "util";
import { Driver, DriverContext } from "./types";

type ExecFileResult = { stdout: string; stderr: string };
type ExecFileRunner = (
  file: string,
  args?: readonly string[] | null,
  options?: childProcess.ExecFileOptions
) => Promise<ExecFileResult>;

let execFileRunner: ExecFileRunner = promisify(childProcess.execFile);

// For testing: allow replacing exec implementation
export function __setExecFileRunner(fn: ExecFileRunner) {
  execFileRunner = fn;
}

export function __getExecFileRunner(): ExecFileRunner {
  return execFileRunner;
}

export type ShellInput = {
  command: string;
  args?: string[];
};

function isCommandAllowed(command: string, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.some((allowed) => command.trim().startsWith(allowed));
}

export function restrictedShellDriverFactory(): Driver {
  return {
    async execute(input: ShellInput, context?: DriverContext): Promise<any> {
      const { command, args = [] } = input;
      if (!command) {
        throw new Error("Restricted shell driver requires command");
      }

      if (!isCommandAllowed(command, context?.allowlist)) {
        throw new Error(`Command not allowlisted: ${command}`);
      }

      const timeout = context?.limits?.timeout_ms ?? 5000;

      try {
        const result = await execFileRunner(command, args, { timeout, windowsHide: true });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exit_code: 0,
          command,
          args
        };
      } catch (error: any) {
        const exitCode = typeof error?.code === "number" ? error.code : 1;
        return {
          stdout: error?.stdout || "",
          stderr: error?.stderr || error.message,
          exit_code: exitCode,
          command,
          args
        };
      }
    }
  };
}
