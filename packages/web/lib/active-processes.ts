import type { ChildProcess } from 'node:child_process';

const activeProcesses = new Map<string, ChildProcess>();

export default activeProcesses;
