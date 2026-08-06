# Self-Hosting Next.js with Portainer

**Research date:** 2026-08-06
**Scope:** Repository-specific deployment research only. No application, Dockerfile, or Compose file was changed.

## Executive Recommendation

Package this as a production Next.js Node container using `output: "standalone"`, a multi-stage build, and a Debian-based official Node image. Run the generated standalone server on `0.0.0.0:3000`, publish a host port to container port `3000`, and mount a named Docker volume at the directory containing the SQLite database. Supply `DAILY_INTAKE_DB_PATH` as an absolute container path such as `/app/data/calories.db`.

For Portainer, an image-only Stack is the most portable lifecycle: build and test the image outside Portainer, push it to a registry or load it onto the target Docker host, then deploy a Compose Stack that references `image:`. The Repository UI shown for this project also supports a `build:` plus `pull_policy: build` workflow on Docker Standalone endpoints; use that only when the Portainer version successfully supports Git-based Compose builds.

## Repository Findings

| Item | Confirmed fact | Deployment implication |
| --- | --- | --- |
| `package.json` | Next.js `16.3.0`, React `19.2.8`, `better-sqlite3` `^13.0.2`; scripts include `build` and `start`; package manager is `pnpm@11.10.0`. | Use a production build followed by a production server, not `next dev`; target Node 22+ because of the locked native dependency. |
| `README.md` | Requires Node.js `20.9+` and pnpm 11. Default URL is `http://localhost:3000`. SQLite defaults to `data/calories.db`; `DAILY_INTAKE_DB_PATH` and legacy `CALORIE_DB_PATH` override it. | Container port is expected to be 3000. Configure the preferred variable explicitly and persist its parent directory. |
| `next.config.ts` | Contains no output configuration; it is currently the default config. | Standalone output is not enabled yet. Adding `output: "standalone"` is a prerequisite for the recommended minimal runtime image, but is outside this report’s requested file-edit scope. |
| `src/lib/database.ts` | Chooses `DAILY_INTAKE_DB_PATH`, then `CALORIE_DB_PATH`, then `join(process.cwd(), "data", "calories.db")`; creates the parent directory and opens SQLite at module initialization. | The path must be writable at startup. A volume mounted somewhere else will not protect the database. A non-root runtime user must have write permission to the mounted directory. |
| Repository artifacts | `pnpm-lock.yaml` exists; its locked `better-sqlite3@13.0.2` entry declares Node `>=22`. No `Dockerfile`, `.dockerignore`, or Compose file was found at the repository root. | The README's Node `20.9+` floor is not sufficient for the locked native dependency; target Node 22+ and keep the build/runtime image compatible. Containerization and Stack deployment are not currently ready-made. |

## Confirmed Platform Facts

### Next.js

- Next.js self-hosting supports a Node.js server and recommends a reverse proxy in front of a directly exposed server for request protection and operational controls ([self-hosting](https://nextjs.org/docs/app/guides/self-hosting), version shown by the page: 16.3.0, accessed 2026-08-06).
- `output: "standalone"` uses output file tracing to create `.next/standalone` with the files and selected dependencies needed for production. It also emits a minimal `server.js`; `public` and `.next/static` are not copied automatically and must be copied when the application needs them ([output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), accessed 2026-08-06).
- The standalone server accepts `PORT` and `HOSTNAME`; Next.js gives `PORT=8080 HOSTNAME=0.0.0.0 node server.js` as the example. `next start` also documents port default 3000 and hostname default `0.0.0.0` ([output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [CLI](https://nextjs.org/docs/app/api-reference/cli/next), accessed 2026-08-06).
- Server-only environment variables are available at runtime. `NEXT_PUBLIC_*` values are inlined at build time and should not be used for the database path ([environment variables](https://nextjs.org/docs/app/guides/environment-variables), accessed 2026-08-06).
- The official Next.js Docker example demonstrates standalone mode, multi-stage builds, a non-root runtime, `HOSTNAME=0.0.0.0`, and `docker run -p 3000:3000` ([official `with-docker` example](https://github.com/vercel/next.js/tree/canary/examples/with-docker), accessed 2026-08-06). The Debian-versus-Alpine native-module tradeoff is documented by the official Node image sources below.

### Docker

- Docker multi-stage builds use multiple `FROM` stages and selectively copy build artifacts, leaving build tools out of the final image ([multi-stage builds](https://docs.docker.com/build/building/multi-stage/), accessed 2026-08-06).
- The official `node` image offers Debian variants and Alpine variants. Docker describes Alpine as smaller but warns that it uses musl libc rather than glibc and that software can encounter libc compatibility issues; Debian suite tags can reduce breakage when extra packages are needed ([official `node` image](https://hub.docker.com/_/node), accessed 2026-08-06).
- Docker `HEALTHCHECK` records whether a container is healthy; it does not itself publish a port or create an application endpoint ([Dockerfile reference](https://docs.docker.com/reference/dockerfile/#healthcheck), accessed 2026-08-06). The repository has no confirmed health endpoint, so a future healthcheck must target an actually implemented route or use a suitable local process check.
- Docker volumes are preferred for persistent container-generated data and outlive an individual container. A named volume mounted at the SQLite directory protects the database across container replacement; removing the volume is a separate destructive operation ([volumes](https://docs.docker.com/engine/storage/volumes/), accessed 2026-08-06).
- `EXPOSE` is documentation only. A host-facing mapping requires `-p` or the equivalent Compose `ports` entry ([Dockerfile reference](https://docs.docker.com/reference/dockerfile/#expose), accessed 2026-08-06).

### Portainer

- Portainer Docker Stacks can be created with the Web editor, uploaded Compose YAML, or a Git repository. Portainer can inject variables individually or from a `.env` file, and Compose can reference them as `${VARIABLE_NAME}` ([Add a new stack](https://docs.portainer.io/user/docker/stacks/add.md), accessed 2026-08-06).
- Portainer's container deployment UI distinguishes manual network port publishing from merely publishing all exposed ports; for a Stack, the equivalent is an explicit Compose `ports` mapping ([Add a new container](https://docs.portainer.io/user/docker/containers/add.md), accessed 2026-08-06).
- Portainer documents that remote environments currently do not support executing Compose `build` steps. Its workaround is to build externally, push or load the image on the remote host, and remove `build` in favor of the built `image` ([Compose build limitation](https://docs.portainer.io/faqs/known-issues/docker-compose-files-including-build-steps-fail.md), accessed 2026-08-06).
- Portainer's Git deployment documentation separately says the Git support does not fully implement building images from Compose and recommends referencing an image built separately ([Git stack build limitation](https://docs.portainer.io/faqs/troubleshooting/stacks-deployments-and-updates/can-i-build-an-image-while-deploying-a-stack-application-from-git.md), accessed 2026-08-06).

## Native SQLite and Image Recommendations

- `better-sqlite3` is a native Node.js dependency. Its official project says it requires a currently supported Node.js version and provides prebuilt binaries for major platforms and architectures; it points to troubleshooting when installation fails ([official project README](https://github.com/WiseLibs/better-sqlite3), accessed 2026-08-06).
- Prefer a pinned Debian-based Node 22+ image, such as a Debian slim tag, and verify the exact architecture used by the Portainer host. Debian/glibc is the lower-risk starting point for this native module.
- Alpine may reduce image size, but its musl libc can make native-module installation or loading differ from Debian. Use Alpine only after testing a clean build and runtime on the target architecture; do not assume a native binary built for Debian will work on Alpine.
- Use `pnpm install --frozen-lockfile` in CI/builds because the repository has a lockfile. The official pnpm documentation says frozen installs fail when the lockfile is absent or out of sync ([pnpm install](https://pnpm.io/cli/install), accessed 2026-08-06).

## Persistent Data and Runtime Wiring

Recommended future container contract:

```text
PORT=3000
HOSTNAME=0.0.0.0
DAILY_INTAKE_DB_PATH=/app/data/calories.db
volume: <named-volume> -> /app/data
published port: <host-port>:3000
```

The application creates the database directory automatically, but only if the parent path is writable. Mount the volume at `/app/data`, not only at the database file path, because SQLite may use adjacent files during operation. Back up the volume and test restore; recreating a container without the volume will otherwise leave the application with a new empty database. Do not run multiple replicas against the same local SQLite volume without an explicit storage/concurrency design; this is a single-user local ledger and should remain a single application instance.

Binding to `0.0.0.0` makes the process reachable through the container network. It does not by itself publish the service externally; the Stack still needs a `ports` mapping, and firewall/reverse-proxy policy remains an operator concern. Prefer a reverse proxy and TLS if the service is reachable beyond a trusted LAN.

## Portainer Deployment Recommendation

1. For the Repository form shown, use `https://github.com/diegoagd10/open-calory-tracker` as the Repository URL, `refs/heads/main` as the reference, and `docker-compose.yml` as the Compose path. The `/tree/main` suffix belongs nowhere in the Repository URL.
2. The Compose file builds the included Dockerfile and sets `pull_policy: build`, which is the Docker Standalone pattern indicated by the Portainer UI. If deployment returns Portainer's known remote Compose-build error, use the fallback below instead of retrying the same Stack definition.
3. For the fallback, build the standalone image outside Portainer, push it to a registry accessible by the Docker endpoint or load it directly onto that host, and deploy a Compose file with only `image:`. Prefer immutable version tags or digests over `latest`.
4. Keep the published host-to-container port mapping, named data volume, and `DAILY_INTAKE_DB_PATH=/app/data/calories.db`. Set deployment-specific values through Portainer's environment-variable UI or uploaded environment file.
5. Configure restart behavior and a healthcheck only after confirming the application endpoint or process check. On updates, retain the named volume and verify the database and migrations. Treat volume deletion as data loss unless a tested backup exists.

## Caveats and Uncertainty

- This report does not claim that standalone tracing will include every native `better-sqlite3` runtime artifact for every future build. The exact image must be tested on the target OS, CPU architecture, Node version, and package-manager install result.
- The repository does not currently define a health endpoint, Dockerfile, Compose file, runtime user, container work directory, or reverse-proxy configuration. Therefore the paths, user permissions, healthcheck command, and final image layout above are recommendations, not confirmed current behavior.
- Next.js documentation supports runtime server environment variables, but this repository reads the database variable during module initialization. Changing the variable requires a container restart; it is not a per-request setting.
- Portainer behavior varies by environment type. The cited `env_file` guidance applies to Docker Standalone and Podman, while Portainer notes that Docker Swarm's `docker stack deploy` does not support `env_file`; use explicit variables for Swarm.
- Portainer's remote Compose-build limitation means a Stack containing `build:` is not a portable deployment plan. A local Portainer setup may behave differently, but the external-build/image workflow is the documented safe path.

## Sources and Access Notes

All sources below are first-party official documentation or source repositories, accessed 2026-08-06:

- Next.js: [self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [output file tracing and standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [environment variables](https://nextjs.org/docs/app/guides/environment-variables), [CLI host/port](https://nextjs.org/docs/app/api-reference/cli/next), and the official [Docker example](https://github.com/vercel/next.js/tree/canary/examples/with-docker).
- Docker: [multi-stage builds](https://docs.docker.com/build/building/multi-stage/), [Dockerfile `HEALTHCHECK` and `EXPOSE`](https://docs.docker.com/reference/dockerfile/), [volumes](https://docs.docker.com/engine/storage/volumes/), and the [official Node image](https://hub.docker.com/_/node).
- Portainer: [Add a new Stack](https://docs.portainer.io/user/docker/stacks/add.md), [Add a new container / port publishing](https://docs.portainer.io/user/docker/containers/add.md), [remote Compose build limitation](https://docs.portainer.io/faqs/known-issues/docker-compose-files-including-build-steps-fail.md), and [Git deployment build limitation](https://docs.portainer.io/faqs/troubleshooting/stacks-deployments-and-updates/can-i-build-an-image-while-deploying-a-stack-application-from-git.md).
- better-sqlite3: [official repository README](https://github.com/WiseLibs/better-sqlite3).
- pnpm: [official `pnpm install` documentation](https://pnpm.io/cli/install).
