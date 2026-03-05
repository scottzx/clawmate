# Native Mode Testing Guide

## Quick Start

### 1. Verify Build Status

```bash
# Check agent-runner is built
ls -la container/agent-runner/dist/index.js

# Check main project is built
ls -la dist/container-runner.js
```

### 2. Test Native Mode (Default)

```bash
# Run in native mode (no Docker required)
npm run dev
```

### 3. Force Container Mode (if needed)

```bash
# Switch back to container mode
export NANOCLAW_USE_CONTAINERS=1
npm run dev
```

## Verification Tests

### Test 1: Basic Agent Response
1. Send a message to your main group
2. Agent should respond normally
3. Check logs: `tail -f groups/main/logs/agent-*.log`

### Test 2: Non-Main Group
1. Send a message to a non-main group
2. Agent should respond if trigger is present
3. Check logs in the group's logs directory

### Test 3: IPC Communication
1. Send a follow-up message while agent is running
2. Agent should receive and process it
3. No errors in logs

### Test 4: Tools
1. Ask agent to read a file: "Read package.json"
2. Ask agent to write a file: "Create a test.txt file with hello"
3. Ask agent to run a command: "Run ls -la"
4. All tools should work correctly

### Test 5: Scheduled Tasks
1. Schedule a task: "Schedule a task to run every minute that says hello"
2. Wait for task to execute
3. Verify task output

## Debugging

### Check Environment Variables
```bash
# Verify native mode is detected
node -e "const { isNativeMode } = require('./dist/container-runtime.js'); console.log('Native mode:', isNativeMode() ? 'enabled' : 'disabled');"
```

### View Agent Logs
```bash
# Main group
tail -f groups/main/logs/agent-*.log

# Other groups
tail -f groups/{group-folder}/logs/agent-*.log
```

### Test Agent Runner Directly
```bash
# Test agent-runner can be executed
node container/agent-runner/dist/index.js <<< '{"prompt":"test","groupFolder":"main","chatJid":"test","isMain":true}'
```

## Expected Behavior

### Native Mode
- No Docker/Apple Container required
- Agent runs as Node.js subprocess
- Working directory set to group folder
- IPC directory: `data/ipc/{group-folder}/`
- Sessions directory: `data/sessions/{group-folder}/.claude/`

### Container Mode
- Requires Docker or Apple Container
- Agent runs in container
- Volume mounts for directories
- Same stdin/stdout protocol

## Troubleshooting

### Issue: Agent not responding
1. Check logs for errors
2. Verify agent-runner is built: `ls -la container/agent-runner/dist/index.js`
3. Verify environment variables are set correctly

### Issue: Tools not working
1. Check working directory is correct
2. Verify file permissions
3. Check agent logs for tool errors

### Issue: IPC not working
1. Verify IPC directory exists: `ls -la data/ipc/{group-folder}/`
2. Check directory permissions
3. Verify agent can write to IPC directory

## Performance Comparison

### Native Mode
- Faster startup (no container overhead)
- Lower memory usage
- Simpler debugging
- Easier to run locally

### Container Mode
- Better isolation
- More secure (sandboxed)
- Consistent environment
- Production-ready

## Switching Modes

```bash
# Enable container mode
export NANOCLAW_USE_CONTAINERS=1

# Disable container mode (native)
unset NANOCLAW_USE_CONTAINERS
# or
export NANOCLAW_USE_CONTAINERS=0
```

## Success Criteria

- [ ] Agent responds to messages in main group
- [ ] Agent responds to messages in non-main groups
- [ ] IPC communication works for follow-up messages
- [ ] All tools (Read, Write, Bash, etc.) work correctly
- [ ] Scheduled tasks execute properly
- [ ] No errors in logs
- [ ] Sessions persist across restarts
- [ ] Performance is acceptable

## Rollback

If native mode has issues:
```bash
# Switch back to container mode
export NANOCLAW_USE_CONTAINERS=1
npm run dev

# Or revert changes entirely
git checkout HEAD -- src/container-runner.ts container/agent-runner/src/index.ts src/container-runtime.ts src/config.ts container/agent-runner/src/ipc-mcp-stdio.ts
npm run build
```
