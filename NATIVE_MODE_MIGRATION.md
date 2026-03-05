# Native Mode Migration - Summary

## Overview

NanoClaw has been successfully migrated to support both container mode (Docker/Apple Container) and native Node.js mode. The native mode runs the agent-runner as a direct Node.js subprocess without requiring any container runtime.

## Changes Made

### 1. Configuration (`src/config.ts`)
- Added `USE_CONTAINERS` flag to control mode selection
- Set `export const USE_CONTAINERS = process.env.NANOCLAW_USE_CONTAINERS === '1';`
- By default, native mode is enabled (no Docker required)

### 2. Container Runtime (`src/container-runtime.ts`)
- Added `isNativeMode()` function to check current mode
- Modified `ensureContainerRuntimeRunning()` to skip Docker checks in native mode
- Modified `cleanupOrphans()` to skip orphan cleanup in native mode

### 3. Container Runner (`src/container-runner.ts`)
- Added `buildAgentEnv()` function to build environment variables for native mode
- Added `runNativeAgent()` function that spawns Node.js subprocess instead of container
- Modified `runContainerAgent()` to route to `runNativeAgent()` when in native mode
- Native mode uses environment variables instead of volume mounts:
  - `NANOCLAW_GROUP_DIR` - Working directory for the agent
  - `NANOCLAW_IPC_DIR` - IPC communication directory
  - `NANOCLAW_SESSIONS_DIR` - Claude sessions directory
  - `NANOCLAW_PROJECT_ROOT` - Project root (main group only)
  - `NANOCLAW_GLOBAL_DIR` - Global memory directory (non-main groups)

### 4. Agent Runner (`container/agent-runner/src/index.ts`)
- Modified path constants to read from environment variables
- Updated to use `NANOCLAW_IPC_DIR` for IPC directory
- Updated to use `NANOCLAW_GROUP_DIR` for working directory
- Updated to use `NANOCLAW_SESSIONS_DIR` for sessions
- Updated to use `NANOCLAW_GLOBAL_DIR` for global memory
- Updated to use `NANOCLAW_PROJECT_ROOT` for project root
- Fixed bug: `process.env.cwd` → `process.cwd()`

### 5. IPC MCP Server (`container/agent-runner/src/ipc-mcp-stdio.ts`)
- Modified to use `NANOCLAW_IPC_DIR` environment variable
- Falls back to `/workspace/ipc` for container mode compatibility

## Architecture

### Container Mode (Original)
```
Main Process (src/index.ts)
    ↓
spawn('docker', containerArgs)
    ↓
Container runs agent-runner
    ↓
stdin/stdout communication
```

### Native Mode (New)
```
Main Process (src/index.ts)
    ↓
spawn('node', ['container/agent-runner/dist/index.js'])
    ↓
Node.js subprocess runs agent-runner
    ↓
stdin/stdout communication (same protocol!)
```

## Key Benefits

1. **No Docker Required**: Can run on any system with Node.js, no container runtime needed
2. **Simpler Setup**: No need to build or manage container images
3. **Easier Debugging**: Can run agent-runner directly with `node container/agent-runner/dist/index.js`
4. **Same Protocol**: stdin/stdout communication protocol unchanged, so all other code works identically
5. **Gradual Migration**: Can switch back to container mode via `NANOCLAW_USE_CONTAINERS=1`

## Environment Variables

### Main Process
- `NANOCLAW_USE_CONTAINERS=1` - Force container mode (default: native mode)

### Agent Runner (Native Mode)
- `NANOCLAW_GROUP_DIR` - Agent working directory
- `NANOCLAW_IPC_DIR` - IPC communication directory
- `NANOCLAW_SESSIONS_DIR` - Claude sessions directory
- `NANOCLAW_PROJECT_ROOT` - Project root (main group)
- `NANOCLAW_GLOBAL_DIR` - Global memory directory (non-main groups)
- `NANOCLAW_CHAT_JID` - Current chat JID
- `NANOCLAW_GROUP_FOLDER` - Group folder name
- `NANOCLAW_IS_MAIN` - Whether this is the main group

## Files Modified

1. `src/config.ts` - Added USE_CONTAINERS flag
2. `src/container-runtime.ts` - Added native mode support
3. `src/container-runner.ts` - Added runNativeAgent() function
4. `container/agent-runner/src/index.ts` - Environment variable paths
5. `container/agent-runner/src/ipc-mcp-stdio.ts` - Environment variable IPC dir

## Testing

To test native mode:
```bash
# Ensure agent-runner is built
cd container/agent-runner && npm run build && cd ../..

# Build main project
npm run build

# Run in native mode (default)
npm run dev

# Force container mode if needed
NANOCLAW_USE_CONTAINERS=1 npm run dev
```

## Verification Checklist

- [x] TypeScript compiles without errors
- [x] agent-runner builds successfully
- [x] Main project builds successfully
- [x] Environment variables properly set
- [x] IPC directory structure created
- [x] Sessions directory initialized
- [x] Skills synchronized to sessions directory
- [ ] Test agent response in main group
- [ ] Test agent response in non-main groups
- [ ] Test IPC message passing
- [ ] Test scheduled tasks
- [ ] Verify tool functionality (Read, Write, Bash, etc.)

## Rollback Strategy

If issues occur:
```bash
# Switch back to container mode
export NANOCLAW_USE_CONTAINERS=1
npm run dev

# Or revert changes
git checkout HEAD -- src/container-runner.ts container/agent-runner/src/index.ts src/container-runtime.ts src/config.ts container/agent-runner/src/ipc-mcp-stdio.ts
npm run build
```

## Next Steps

1. Test with actual messages to verify agent responses work correctly
2. Verify all tools (Read, Write, Bash, etc.) function properly
3. Test IPC message passing for follow-up messages
4. Test scheduled tasks execution
5. Test non-main group functionality
6. Monitor for any security issues with environment variables
7. Consider adding more detailed logging for native mode debugging
