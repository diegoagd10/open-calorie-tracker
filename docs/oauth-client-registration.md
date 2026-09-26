# Public OAuth client registration

Signed-in account holders can register and review public clients at **Settings → OAuth clients** (`/settings/oauth-clients`). A registration stores the client name, a generated client ID, the registering account, and its allowed redirect URIs. Public clients have no shared client secret. Registration alone does not approve access to a Food Log or issue any credential; authorization and tokens are separate steps.

Enter one to ten redirect URIs, one per line. Each URI must be an absolute HTTPS URL. HTTP is accepted only for the loopback hosts `localhost`, `127.0.0.1`, and `[::1]`, so a terminal client can listen on a local callback port during development. The address may include a path and query. Credentials in the URL, fragments, wildcards, spaces, and duplicate URIs are rejected. Each URI is limited to 2,048 characters. The name is limited to 80 printable characters.

The server stores the parsed, normalized URL. Clients should use the URI displayed after registration for future authorization requests. A deployed client's callback should use HTTPS with a certificate trusted by the user's browser. An app reached over a LAN HTTP address can register an HTTPS callback, but arbitrary LAN HTTP callbacks are not accepted. For local development, use an explicit loopback HTTP callback such as `http://127.0.0.1:4567/callback`.

Registrations are visible only to the account that created them. This first slice has no edit operation; later authorization work will add connection management separately. A self-hosting operator should expose OAuth routes over HTTPS when enabling external clients.
