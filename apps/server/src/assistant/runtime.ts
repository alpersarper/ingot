/**
 * Where this server is actually running, which is a thing it has to be honest
 * about.
 *
 * One assistant connection -- the local Claude Code CLI -- is a *process on the
 * host*, not an address. A server inside a container cannot spawn it, and no
 * amount of configuration will make it able to: the binary, the login and the
 * keychain are all on the other side of the container boundary. Offering that
 * connection there would be offering a button that cannot work, which is worse
 * than not offering it, because the user would reasonably conclude that their
 * CLI is broken.
 *
 * So the runtime is detected once and reported. The panel uses it to disable
 * the CLI connection with a sentence rather than hide it, because "this one is
 * for the non-Docker run" is information a person setting up Ingot wants; and
 * the service uses it so that the CLI is never the resolved default in a
 * deployment that cannot reach it.
 *
 * Detection is deliberately boring. `INGOT_IN_CONTAINER` is the authority when
 * it is set -- the image sets it, so the common case is a declaration rather
 * than a guess -- and the two filesystem heuristics are the fallback for a
 * container somebody else built.
 */
import { existsSync, readFileSync } from 'node:fs'

export interface Runtime {
  /**
   * True when this process is inside a container.
   *
   * The only thing this is allowed to decide is whether a *host* process is
   * reachable. It is not a security boundary and nothing is trusted to it.
   */
  containerized: boolean
  /** How that was concluded, for the panel to say and a support thread to read. */
  detail: string
}

/** What the image sets, so the common case is declared rather than sniffed. */
const CONTAINER_ENV = 'INGOT_IN_CONTAINER'

/** Docker writes this into every container it builds from a Dockerfile. */
const DOCKER_MARKER = '/.dockerenv'

/** Reads `true` for Docker, Podman and containerd under most runtimes. */
const CGROUP = '/proc/1/cgroup'

export function detectRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const declared = env[CONTAINER_ENV]?.trim()
  if (declared !== undefined && declared !== '') {
    const containerized = declared !== '0' && declared.toLowerCase() !== 'false'
    return { containerized, detail: `${CONTAINER_ENV}=${declared}` }
  }

  if (existsSync(DOCKER_MARKER)) return { containerized: true, detail: `${DOCKER_MARKER} exists` }

  try {
    const cgroup = readFileSync(CGROUP, 'utf8')
    if (/docker|containerd|kubepods|podman/.test(cgroup)) {
      return { containerized: true, detail: `${CGROUP} names a container runtime` }
    }
  } catch {
    // No `/proc` at all is the ordinary case on macOS, and it is evidence of
    // nothing. Fall through to "not a container".
  }

  return { containerized: false, detail: 'no container marker found' }
}
