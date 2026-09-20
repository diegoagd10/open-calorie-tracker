# AI credential storage research

Reviewed: 2026-09-19.

## Conclusion

For the approved single-node deployment, store the recoverable Gemini and
TypeSafe credential pair as one AES-256-GCM-encrypted, versioned database
bundle. Generate one random 32-byte application master key on first start and
store it in a service-owned file with private permissions under a separately
persisted secrets path, not under the ordinary application data path. The
database or its routine backup must not contain the master key.

This design is intentionally narrower than a general secrets platform. It
protects credentials in database rows and ordinary data backups, detects
tampering and cross-purpose substitution, and keeps deployment practical for
one application process on one node. It does not protect plaintext from a
compromised application process, its service account, root, or a fully
compromised host. KMS, Vault, desktop keyrings, distributed key rotation, and
multi-node coordination remain outside the initial design.

## Why not a restricted plaintext credential file?

A plaintext file restricted to the service account is the simplest workable
baseline. Unix permissions can make a file readable and writable by its owner
while granting no permissions to its group or other users. Node exposes these
permission bits, but its file-creation default is `0o666` and the requested
mode applies only when a file is created, so secret creation must explicitly
request and then verify private permissions rather than rely on defaults
([Node.js file-system documentation](https://nodejs.org/download/release/v24.16.0/docs/api/fs.html)).
GitLab likewise directs operators to keep its secrets file owned by root with
mode `0600`
([GitLab Geo configuration](https://docs.gitlab.com/administration/geo/replication/configuration/#step-1-manually-replicate-secret-gitlab-values)).

That access control is useful but insufficient for provider credentials stored
beside application data: a copied data volume or routine backup would carry the
plaintext credentials. It also gives no authenticated integrity check. Because
Gemini and TypeSafe credentials must be recovered to call their APIs, hashing
is not an alternative. GitLab makes the same distinction: it supports SHA-256
digests for tokens that only need comparison, AES-256-GCM for tokens that must
be recovered, and strongly discourages plaintext storage
([GitLab `TokenAuthenticatable`](https://docs.gitlab.com/development/token_authenticatable/)).

The selected design therefore uses restricted plaintext only for the single
random master key. The replaceable provider credentials are encrypted in the
database. This reduces the number of plaintext-at-rest secrets and gives the
application one generic key-lifecycle boundary.

## Why the master key is external to application data

Encryption only adds a useful backup boundary when ciphertext and its key are
not routinely copied together. GitLab explicitly excludes configuration files
from its application backup because its database contains encrypted values and
states that storing encrypted information with the key defeats the purpose of
encryption. It requires its database-encryption secrets file to be backed up
separately
([GitLab backup documentation](https://docs.gitlab.com/administration/backup_restore/backup_gitlab/#storing-configuration-files)).

This supports two generic deployment settings:

- `APPLICATION_SECRETS_PATH` names a separately persisted secrets directory.
- `APPLICATION_MASTER_KEY_PATH` names the key file and defaults inside that
  directory, never inside the ordinary application data directory.

The default key file should be created exclusively with 32 cryptographically
random bytes and private service-account permissions. The containing directory
must also deny unrelated users access. Operators may back up the key, but they
should store that backup separately from application/database backups.

Losing the key makes old encrypted provider credentials unrecoverable. The
ticket deliberately limits the blast radius: on startup the application
creates a new master key, reports the existing bundle as unreadable, disables
new credential consumers, and permits an administrator to replace the bundle.
Users, Food Entries, Photo Analysis history, and catalogs do not depend on this
key and remain available. This recovery policy is specific to replaceable
external API credentials; it would not be appropriate for irreplaceable user
data.

## AES-256-GCM envelope requirements

NIST defines GCM as authenticated encryption with associated data and
recommends 96-bit IVs for interoperable, efficient use. Its security depends
critically on IV uniqueness under a given key, and authenticated decryption
returns failure when the supplied tag is not valid
([NIST SP 800-38D](https://doi.org/10.6028/NIST.SP.800-38D),
[full publication](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)).

The application envelope should therefore have these invariants:

- A 32-byte key selects AES-256.
- Every replacement uses a fresh cryptographically random 12-byte nonce. A
  nonce must never be reused with the same key, including when the plaintext is
  unchanged.
- The full 16-byte authentication tag is stored and required. Node's GCM
  implementation defaults encryption to a 16-byte tag, but its documentation
  warns that decryption can otherwise accept short GCM tags unless
  `authTagLength` is set or the length is checked
  ([Node.js crypto documentation](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html)).
- The persisted envelope is explicitly versioned and contains, at minimum,
  algorithm/version, nonce, authentication tag, and ciphertext. Binary fields
  use one canonical encoding and strict decoded lengths.
- Canonically encoded purpose and envelope-version metadata are supplied as
  AAD on both encryption and decryption. Binding the opaque bundle name, such
  as `photo-analysis`, prevents a valid ciphertext from being moved to a
  different credential purpose; binding the version prevents silent format
  reinterpretation.
- Authentication is completed before plaintext is accepted. Node documents
  that missing tags or tampered ciphertext cause `decipher.final()` to throw
  and the ciphertext must be discarded. Authentication, parsing, wrong-key,
  and unsupported-version failures must become a non-secret unreadable status,
  not partial plaintext or detailed secret-bearing errors.

AAD is authenticated but not encrypted, so it may contain only non-secret
metadata. Secret key names, provider responses, and plaintext credentials must
not be added to diagnostics, loaders, HTML, status responses, or persisted
metadata.

## Deployment mechanisms considered

| Mechanism | What primary sources establish | Fit for this design |
| --- | --- | --- |
| Environment variable containing the key | systemd warns that environment variables are unsuitable for passwords or key material because they can be exposed over IPC and propagate down process trees. Docker likewise warns that environment variables can reach processes or logs unexpectedly ([systemd execution environment](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml), [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)). | Do not introduce a master-key-value environment variable. Environment variables are appropriate for the two non-secret path settings. |
| Restricted host file / separate mount | Standard file permissions provide a small, portable single-node access-control boundary. Separating it from data follows GitLab's database-key backup model. | Selected default. It is operationally simple and supports automatic first-start generation. Document that service-account or root compromise still exposes it. |
| Docker Compose secret | Compose grants secrets per service and mounts each as a file under `/run/secrets`; ordinary Compose implements this as a bind-mounted host file and relies on filesystem permissions ([Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets/)). | A supported operator-provided `APPLICATION_MASTER_KEY_PATH`. The host source still needs private ownership, separate backup handling, persistence, and read-only treatment after provisioning. Do not claim Swarm guarantees for ordinary Compose. |
| Docker Swarm secret | Swarm encrypts secrets in transit and in its Raft log, grants them only to authorized services, and mounts decrypted values in an in-memory filesystem while a task runs ([Docker Swarm secrets](https://docs.docker.com/engine/swarm/secrets/)). | Stronger optional deployment mechanism, but Swarm secrets cannot be created or updated by an ordinary standalone container and are not required by this single-node application. Automatic application-side key generation also needs a durable writable target, so this is operator-managed rather than the default lifecycle. |
| systemd credential | systemd can expose a credential only to the unit user from a read-only, preferably non-swappable filesystem and can decrypt an authenticated credential bound to a TPM2 key, a host key, or both ([systemd credentials](https://systemd.io/CREDENTIALS/)). | A good hardened Linux deployment option. It adds systemd/TPM-specific setup and should be accepted through the generic key path rather than embedded into the storage module. |
| Desktop Secret Service / keyring | The Secret Service API stores secrets in collections reached through a D-Bus session. Collections may be locked, reads may require unlocking and a prompt, and a service may lock them again at any time ([Secret Service specification](https://specifications.freedesktop.org/secret-service/latest-single/)). | Poor default for an unattended headless server: availability depends on a user-session service and possibly interactive unlock. It may suit a future desktop package, not this deployment. |

Using a path as configuration preserves portability across a plain host file,
a separately persisted container volume, a Compose secret, or a systemd
credential directory without teaching the credential module about a specific
orchestrator.

## Comparable application patterns

n8n automatically generates a random encryption key on first launch and uses
it to encrypt credentials before storing them in its database; self-hosters may
supply a fixed deployment key
([n8n custom encryption key](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/set-a-custom-encryption-key)).
Its newer rotation design separates a stable instance master key from rotatable
data-encryption keys stored encrypted in the database and exposes only key
metadata through its management API
([n8n encryption-key rotation](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/rotate-encryption-keys)).

GitLab stores recoverable application tokens with AES-256-GCM rather than
plaintext and keeps database encryption material in a separate secrets file.
Its backup documentation explicitly describes both the confidentiality benefit
of separating data from keys and the availability cost if that secrets file is
lost
([GitLab token storage](https://docs.gitlab.com/development/token_authenticatable/),
[GitLab backup documentation](https://docs.gitlab.com/administration/backup_restore/backup_gitlab/#storing-configuration-files)).

These are precedents, not protocol specifications. They support the shape of
the selected design: database ciphertext, a separately managed instance key,
non-secret status/metadata, and explicit recovery consequences. The initial
implementation does not need n8n's multi-key rotation layer because it has one
process, one node, and one replaceable credential bundle; the versioned envelope
leaves room to add key identifiers later.

## Why KMS and Vault are deferred

AWS KMS uses envelope encryption so a data key can be stored encrypted beside
the ciphertext while the top-level KMS key remains non-exportable in an HSM.
Using that key requires a KMS API call
([AWS KMS cryptography essentials](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html)).
This adds strong centralized authorization, audit, and root-key custody, but it
also adds cloud identity, network/service availability, provider coupling, and
per-use operational cost to a self-contained single-node application
([AWS KMS key policies](https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html),
[AWS KMS CloudTrail logging](https://docs.aws.amazon.com/kms/latest/developerguide/logging-using-cloudtrail.html),
[AWS KMS pricing](https://aws.amazon.com/kms/pricing/)).

Vault's transit engine similarly offers cryptography as a service: it does not
store the submitted application data, and callers keep the returned ciphertext
([Vault transit engine](https://developer.hashicorp.com/vault/docs/secrets/transit)).
Operating Vault also introduces another authenticated network service, seal and
unseal lifecycle, protected storage, audit operations, upgrades, and backup
requirements
([Vault production hardening](https://developer.hashicorp.com/vault/docs/concepts/production-hardening),
[Vault seal/unseal](https://developer.hashicorp.com/vault/docs/concepts/seal)).
HashiCorp's availability model uses multiple Vault servers and an HA-capable
storage backend to protect against outages
([Vault high availability](https://developer.hashicorp.com/vault/docs/concepts/ha)).

KMS or Vault becomes attractive if later requirements include multiple
application nodes, centralized access revocation, hardware-backed custody,
compliance audit, or managed rotation across services. For the current one-node
SQLite deployment, either would make credential availability depend on a new
external control plane without removing the need to handle unreadable
ciphertext. Deferring them is therefore a scope and availability decision, not
a claim that a local file is stronger key custody.

## Resulting implementation constraints

The research supports these constraints for `TKT-b45846e7`:

1. Persist provider credentials only as a versioned authenticated envelope;
   persist no plaintext or secret-bearing status metadata.
2. Generate a 32-byte master key once, create its file with private permissions,
   verify its exact length and permissions on later starts, and keep its default
   path under the separate generic secrets directory.
3. Use AES-256-GCM with a new random 12-byte nonce, a required 16-byte tag, and
   canonical purpose/version AAD for every write.
4. Treat every authentication, key, format, or plaintext-schema failure as
   unreadable and fail closed. Never return unauthenticated plaintext.
5. Keep the master-key value out of environment variables, logs, command lines,
   database rows, application backups, loaders, HTML, and status responses.
6. Allow a file path supplied by Compose, systemd, or another deployment tool,
   while retaining a portable application-generated restricted-file default.
7. Preserve the ticket's replaceable-secret recovery boundary: a lost key
   disables only future credential consumers until a validated pair atomically
   replaces the unreadable bundle.
