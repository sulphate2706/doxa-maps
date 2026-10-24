/**
 * _serve-reaped.mjs — spawn a dev server that cannot outlive the process that started it.
 *
 * THE LEAK, MEASURED. Twelve gates in this repo spawn `serve-strict`; eleven of them reap it
 * only on the happy path — `srv.kill()` at the end of the script. That works until the script
 * does not reach the end. When the box ran low on memory it killed several gate processes
 * mid-run, and every server those gates had spawned was orphaned. Counted at the time: ten
 * orphans in one worktree, four in another. Each orphan holds memory, which makes the next
 * kill more likely, which orphans more servers. The leak feeds the condition that causes it.
 *
 * I caught this by leaking two myself, minutes after describing the loop to someone else —
 * so "my gate kills its server" is not evidence. The kill has to survive the killing.
 *
 * WHAT THIS DOES. Registers the child against SIGTERM, SIGINT, SIGHUP and normal exit, and
 * unregisters cleanly when you stop it yourself. `exit` fires for a plain process.exit() and
 * for an uncaught throw; the signals cover the memory killer and Ctrl-C. Nothing covers
 * SIGKILL — nothing can — which is why the port is also reported, so a sweep can find it.
 *
 *   const srv = serveReaped(PUBLIC_DIR, port)
 *   ... use it ...
 *   srv.stop()          // idempotent; safe to call from a finally block
 */
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * @param {string} directory  what to serve
 * @param {number} port
 * @returns {{ child: import('node:child_process').ChildProcess, port: number, stop: () => void }}
 */
export function serveReaped(directory, port) {
  const child = spawn(
    process.execPath,
    [resolve(HERE, 'serve-strict.mjs'), '--port', String(port), '--directory', directory, '--exit-with-parent'],
    { stdio: 'ignore' },
  )

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    try { child.kill() } catch { /* already gone */ }
    process.off('exit', onExit)
    for (const sig of SIGNALS) process.off(sig, onSignal)
  }

  const onExit = () => { try { child.kill() } catch { /* already gone */ } }
  /* Re-raise after cleaning up, so the caller still sees the signal's exit status. */
  const onSignal = (sig) => {
    onExit()
    process.exit(sig === 'SIGINT' ? 130 : 143)
  }
  const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP']

  process.on('exit', onExit)
  for (const sig of SIGNALS) process.on(sig, onSignal)

  return { child, port, stop }
}
