import type { ChildProcess } from "child_process";

const activeProcesses = new Map<string, ChildProcess>();

export default activeProcesses;
