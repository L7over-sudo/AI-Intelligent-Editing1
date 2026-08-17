@echo off
set WORKER_ROLE=render
set STICKMOTION_SETTINGS_PORT=4317
call pnpm --filter @stickmotion/worker dev

