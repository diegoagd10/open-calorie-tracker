# OAuth client registration in self-hosted apps

Reviewed: 2026-09-26. Scope: who can register a client on an instance, how its
redirect URI is controlled, and how a user approves and disconnects it. This
note informs the daily-log API design; it is not an architecture decision.

## Comparable approaches

| App | Registration | User approval and removal | What it illustrates |
| --- | --- | --- | --- |
| **Mastodon** | Anyone can call the public `POST /api/v1/apps` endpoint with a client name, redirect URIs, and scopes. Mastodon currently provisions confidential clients and calls this a proprietary registration endpoint rather than RFC 7591 Dynamic Client Registration ([app registration](https://docs.joinmastodon.org/methods/apps/), [OAuth server metadata](https://docs.joinmastodon.org/methods/oauth/)). | Authorization shows the user a form; the redirect URI must be one registered for the app. Users can revoke authorized apps in account settings ([authorization endpoint](https://docs.joinmastodon.org/methods/oauth/), [account settings](https://docs.joinmastodon.org/user/contacts/)). | Open registration lets independently installed clients obtain credentials from each instance without an operator step, but registration alone does not authorize access to a user's data. |
| **Nextcloud** | An instance administrator adds an OAuth2 client in Administrator Security Settings, entering its name and redirection URL and receiving a client ID and secret. Nextcloud's OAuth2 provider supports confidential clients only ([admin guide](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/oauth2.html)). | The default OAuth2 flow has a confirmation before login when needed and another after login. Its OAuth2 tokens have full account access because the provider does not support scoped access ([admin guide](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/oauth2.html)). | Operator approval controls which apps exist, but this model alone does not provide the narrow `daily-log:read` permission or a public native client. Nextcloud's separate Login Flow documents per-client revocation; that is not evidence of OAuth2 grant revocation ([Login Flow](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/LoginFlow/index.html)). |
| **Gitea** | An individual user, organization admin, or instance admin can configure an OAuth2 application. A user registers one under Settings > Applications; registration records redirect URLs and whether it is confidential or public. Gitea also preconfigures selected clients at startup ([OAuth2 provider guide](https://docs.gitea.com/development/oauth2-provider/)). | The first authorization request prompts the user. Gitea's user settings include an authorized-app list and a revoke action ([OAuth2 provider guide](https://docs.gitea.com/development/oauth2-provider/), [first-party UI strings](https://github.com/go-gitea/gitea/blob/main/options/locale/locale_en-US.json)). | Self-service registration can coexist with per-user consent and revocation. Gitea supports public clients with PKCE and loopback redirect ports for native clients ([OAuth2 provider guide](https://docs.gitea.com/development/oauth2-provider/)). |

## Standards that affect this choice

- [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html) distinguishes open
  dynamic registration, which needs no initial access token, from protected
  registration, which does. Redirect-based clients must register their redirect
  URIs. Supporting OAuth does **not** itself require dynamic registration.
- [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html) treats ordinary native
  apps as public clients and requires authorization servers to support PKCE for
  them. For a desktop or terminal client, loopback-IP redirects may use a
  changing port; matching must retain the registered scheme, IP, and path.

## Implications for this project

For an initial self-hosted daily-log API, **user-managed client registration**
is a reasonable middle path: an authenticated account owner registers a named
client and its allowed redirect URIs, and each person separately approves its
`daily-log:read` grant. This is an inference from Gitea's pattern, not a
requirement of OAuth. It avoids making an instance administrator the routine
gatekeeper for every personal integration while still requiring the user's
consent. Registration and authorization should be separate records so removing
a client and revoking one user's grant have clear, different effects.

The first design should include public clients with authorization code + PKCE
and loopback redirect support if a terminal client is a real compatibility
goal; a client secret embedded in a terminal application cannot be treated as
confidential ([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html), [Gitea
provider guide](https://docs.gitea.com/development/oauth2-provider/)). A
confidential web client can also be registered. Scope should be limited to
`daily-log:read`, unlike Nextcloud's unscoped provider ([Nextcloud admin
guide](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/oauth2.html)).

Whether a particular hosted client can register manually with each self-hosted
instance remains an integration-specific question. Add standards-based dynamic
registration only when a chosen client requires it; Mastodon's public endpoint
shows that open registration is possible, while RFC 7591 defines the
interoperable form ([Mastodon apps API](https://docs.joinmastodon.org/methods/apps/),
[RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html)).
