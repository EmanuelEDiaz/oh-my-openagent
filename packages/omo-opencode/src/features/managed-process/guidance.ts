/** Always-on rule for every session that can run commands (fork roadmap 0.8b): process_start is mandatory, not optional. */
export const PROCESS_GUIDANCE_TAG = "<omo-managed-processes>"

export const PROCESS_GUIDANCE = `${PROCESS_GUIDANCE_TAG}
MANDATORY: run long-running commands with \`process_start\`, never in \`bash\`: package installs (npm/pnpm/yarn/bun/pip/uv/cargo/apt/brew…), downloads (curl -O, wget), container and heavy builds (docker, gradle, mvn), servers and watchers (dev, serve, start, --watch, tail -f), and anything you would background with \`&\` or \`nohup\`. \`bash\` refuses them.
- process_start({ name, command, wait_for }) runs it in the background with a log. wait_for: "exit" (default) for installs/builds, { pattern: "<ready text>" } or { port: <n> } for servers.
- Do not poll or sleep: you are woken with the result. Meanwhile do other work or end your turn.
- Stop with process_stop({ id }); it reports anything that survived. Never use pkill -f, killall or kill -1.
</omo-managed-processes>`
