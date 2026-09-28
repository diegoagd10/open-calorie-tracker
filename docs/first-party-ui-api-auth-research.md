# First-party UI authentication versus public API authentication

Reviewed: 2026-09-26. Scope: whether a self-hosted app's own web UI calls the
same HTTP API used by OAuth clients, and which credential that UI uses. This is
source research for the daily-log API, not an architecture decision. Source
links below pin the inspected revisions.

## Observed implementations

| App | First-party web UI | Public API authentication | What the source establishes |
| --- | --- | --- | --- |
| **Mastodon** | Its browser client calls `/api/v1/notifications` through its shared API helper ([browser API call](https://github.com/mastodon/mastodon/blob/a4ac5f5670942265804dbb261713e1ff0109a402/app/javascript/mastodon/api/notifications.ts#L13-L29)). The helper sends `Authorization: Bearer` using `access_token` from initial page state ([API helper](https://github.com/mastodon/mastodon/blob/a4ac5f5670942265804dbb261713e1ff0109a402/app/javascript/mastodon/api.ts#L81-L100), [initial-state accessor](https://github.com/mastodon/mastodon/blob/a4ac5f5670942265804dbb261713e1ff0109a402/app/javascript/mastodon/initial_state.ts#L176-L178)). | On web sign-in, the server embeds the current session's token in initial page state ([page helper](https://github.com/mastodon/mastodon/blob/a4ac5f5670942265804dbb261713e1ff0109a402/app/helpers/application_helper.rb#L210-L238), [serializer](https://github.com/mastodon/mastodon/blob/a4ac5f5670942265804dbb261713e1ff0109a402/app/serializers/initial_state_serializer.rb#L109-L112)). A session activation creates an OAuth access token associated with the signed-in user and a built-in application ([session model](https://github.com/mastodon/mastodon/blob/a4ac5f5670942265804dbb261713e1ff0109a402/app/models/session_activation.rb#L18-L30), [token creation](https://github.com/mastodon/mastodon/blob/a4ac5f5670942265804dbb261713e1ff0109a402/app/models/session_activation.rb#L59-L72)). | For the inspected notification operation, Mastodon's own browser uses the same versioned API path available to other API clients, with a first-party OAuth bearer token derived from the browser session. The browser's cookie signs in to the web app; the embedded bearer token authenticates its API requests. |
| **Gitea** | Web routes initialize sessions, add session authentication, and map repository pages directly to a web handler ([web router](https://github.com/go-gitea/gitea/blob/4eebefbce585568e51da3d703adf2fd3d53007f5/routers/web/web.go#L137-L154), [web middleware](https://github.com/go-gitea/gitea/blob/4eebefbce585568e51da3d703adf2fd3d53007f5/routers/web/web.go#L309-L318), [repository page route](https://github.com/go-gitea/gitea/blob/4eebefbce585568e51da3d703adf2fd3d53007f5/routers/web/web.go#L1290-L1297)). | Its versioned API router builds an authentication group with OAuth2, HTTP signatures, and Basic; it passes no session to the shared authentication function ([API auth group](https://github.com/go-gitea/gitea/blob/4eebefbce585568e51da3d703adf2fd3d53007f5/routers/api/v1/api.go#L910-L935), [API router setup](https://github.com/go-gitea/gitea/blob/4eebefbce585568e51da3d703adf2fd3d53007f5/routers/api/v1/api.go#L1031-L1037)). | For the inspected repository page, Gitea uses a session-aware web handler, not an internal HTTP request to its versioned API. Its public API authentication path does not authenticate with the browser session. This does not prove that no Gitea browser interaction ever calls an API route. |

## Implication for the daily-log endpoint

There is no single convention to copy. The examples demonstrate two viable
patterns: a first-party browser can use the same API with an application-issued
bearer token, or server-rendered pages can use session-aware handlers while
third-party clients use a separate API path. That comparison is an inference
from the linked source, not a rule imposed by OAuth.

For this project's daily-log design, the existing React Router loader and the
versioned API handler will call the same server-side Food Log service. The
loader continues to use the browser session; external clients use OAuth bearer
tokens at the API boundary. Each controller shapes its own response, with an
explicit, documented v1 JSON contract for external clients. This is a project
decision informed by the comparison, not behavior observed in Mastodon or
Gitea. OAuth does not require the first-party UI to obtain its own grant.

OAuth has since been removed: external clients now authenticate with API keys
created in Settings, and the settings page replaces the written v1 contract.
