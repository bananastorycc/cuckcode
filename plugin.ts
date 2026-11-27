// cuckcode/plugin, what a plugin imports, at a path that stays put when cuckcode's sources move:
// the contract's types (import type, in a plugin's own code) and the build recipe (HOST_MODULES
// and BUILD, for its build.mjs). Node (22.18 and later) imports this file as it is.
export * from './src/shared/plugin.ts'
export type { AgentPreset } from './src/shared/agents.ts'
export type { Agent, AgentRequest, AgentRun, AgentRunEnd, ChangeCode, ChangedFile, GitResult, GitStatus, Midway, RepoStatus, RunExit, RunSpec, Section } from './src/shared/types.ts'
