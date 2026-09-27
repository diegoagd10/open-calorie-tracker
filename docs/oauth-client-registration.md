# OAuth client registration

For a step-by-step integration guide, see the [public OAuth documentation](https://diegoagd10.github.io/open-calory-tracker-docs/).

Signed-in account holders can register and review public or confidential clients at **Settings → OAuth clients** (`/settings/oauth-clients`). A registration stores the client name, a generated client ID, the registering account, and its allowed redirect URIs. Choose **Public client** for software that cannot keep a secret, or **Confidential server client** for a server that can keep a secret. Registration alone does not approve access to a Food Log or issue any credential; authorization and tokens are separate steps.

Public clients have no shared client secret. A confidential client receives a randomly generated secret in the registration response. Copy it immediately into the server's secret storage; the settings page will never display it again. The instance stores only its SHA-256 hash, and client listings contain neither the secret nor its hash. Losing the secret requires registering a new client. Never embed it in a browser app, URL, source repository, or log.

Enter one to ten redirect URIs, one per line. Each URI must be an absolute HTTPS URL. HTTP is accepted only for the loopback hosts `localhost`, `127.0.0.1`, and `[::1]`, so a terminal client can listen on a local callback port during development. The address may include a path and query. Credentials in the URL, fragments, wildcards, spaces, and duplicate URIs are rejected. Each URI is limited to 2,048 characters. The name is limited to 80 printable characters.

The server stores the parsed, normalized URL. Clients should use the URI displayed after registration for future authorization requests. A deployed client's callback should use HTTPS with a certificate trusted by the user's browser. An app reached over a LAN HTTP address can register an HTTPS callback, but arbitrary LAN HTTP callbacks are not accepted. For local development, use an explicit loopback HTTP callback such as `http://127.0.0.1:4567/callback`.

Registrations are visible only to the account that created them. Accounts can review and revoke their own approved connections on the same page. A self-hosting operator should expose OAuth routes over HTTPS when enabling external clients. See [Daily Food Log API v1](daily-log-api-v1.md) for both client flows.
