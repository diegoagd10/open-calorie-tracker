# Daily Food Log API v1 and OAuth clients

For a step-by-step integration guide, see the [public OAuth documentation](https://diegoagd10.github.io/open-calory-tracker-docs/).

The API and OAuth routes run in the same Open Calorie Tracker instance as the browser UI. The API reads one account's Food Log; it does not provide write operations. A public or confidential client must be registered by a signed-in account holder at `/settings/oauth-clients` before it can ask any account holder for access. Registration alone grants nothing.

## Discover and authorize

Read `/.well-known/oauth-authorization-server` for the instance's `issuer`, authorization endpoint, token endpoint, supported scope, PKCE method, and client authentication methods (`none` and `client_secret_basic`). Both client types use authorization code with `S256` PKCE. Retain a fresh, high-entropy `code_verifier` for each attempt and send its SHA-256 base64url challenge in the authorization request. A public client has no shared secret; a confidential server client also authenticates at the token endpoint. See [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html) and the [OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html).

Open `/oauth/authorize` in the account holder's browser with these query parameters:

| Parameter | Value |
| --- | --- |
| `response_type` | `code` |
| `client_id` | The registered client ID |
| `redirect_uri` | One exact URI displayed in the client's registration |
| `scope` | `daily-log:read` |
| `code_challenge` | Base64url SHA-256 of the verifier, without padding |
| `code_challenge_method` | `S256` |
| `state` | A client-generated, unpredictable value of 16 to 512 characters |

The user signs in if needed, then sees the client name and its Food Log read permission and can approve or decline. Sign-in returns to the same authorization request. Approval redirects to the registered URI with a one-time `code` and the original `state`; denial redirects with `error=access_denied` and the original `state`. The client must check `state` before exchanging a code. Invalid client or redirect requests receive an error at the instance and are never redirected to an unregistered URI. Codes expire after five minutes and can be exchanged once.

Send a `POST` to `/oauth/token` with `Content-Type: application/x-www-form-urlencoded` and `grant_type=authorization_code`, `code`, `client_id`, the same `redirect_uri`, and the original `code_verifier`. For a confidential client, also send `Authorization: Basic <base64(client_id:client_secret)>`; use the client ID and one-time secret from registration. Keep this header on the server. The body may omit `client_id` when Basic supplies it, but if included it must match. Do not put `client_secret` in the form body. Public clients send no Basic header.

The response has `access_token`, `refresh_token`, `token_type: "Bearer"`, `expires_in: 900`, and `scope: "daily-log:read"`. A failed exchange returns JSON `{ "error": "invalid_request" | "invalid_client" | "invalid_grant" | "invalid_scope" | "unsupported_grant_type" }` with HTTP 400, or HTTP 401 and a Basic challenge for failed confidential-client authentication. Codes and tokens are stored as SHA-256 hashes; plaintext tokens appear only in token responses. The client secret alone is never a Food Log credential.

## Renew and revoke a connection

When the access token expires, send `POST /oauth/token` with `Content-Type: application/x-www-form-urlencoded`, `grant_type=refresh_token`, `client_id`, and the latest `refresh_token`. Confidential clients must again supply the same Basic client authentication header. The response has the same fields as the code exchange, including a **new** access token and refresh token. Replace the stored refresh token atomically in the client before relying on another renewal. An optional `scope` must be exactly `daily-log:read`; a broader scope returns `invalid_scope`. The metadata endpoint lists both supported grant types.

Each refresh token is single-use. Reusing an older rotated token returns `invalid_grant` and invalidates the connection's active renewal credentials as replay protection. The account holder can review connected clients and their permission at `/settings/oauth-clients` and revoke one there. Revocation immediately invalidates that client's access and refresh tokens for that account, without affecting other connections. Refresh credentials remain available until revocation or detected replay; keep them in secure client storage and do not put them in URLs or logs.

An account's disabled state blocks both Food Log reads and token renewal without deleting its grants. After re-enabling, the existing refresh token can obtain a new access token. Resetting the login password leaves OAuth grants and tokens in place. Browser sessions and OAuth credentials have separate lifecycles.

The callback and secret handling rules are in [OAuth client registration](oauth-client-registration.md). For external clients, serve the instance and callback over trusted HTTPS. An instance accessed over LAN HTTP exposes the same routes and behavior, but the operator must provide HTTPS before sending OAuth credentials across an untrusted network. Loopback HTTP callbacks remain available for local development. This feature does not provision TLS.

## Read a day

Send `GET /api/v1/daily-log?date=YYYY-MM-DD` with `Authorization: Bearer <access_token>`. The date is a required real ISO calendar date. The account is determined only by the token; a supplied account or user ID does not select another account. The account's configured time zone determines `today`; future and historical days follow the browser Food Log's rules.

The response is JSON with these top-level fields:

| Field | Meaning |
| --- | --- |
| `version` | The string `"1"` |
| `selectedDate`, `today` | ISO local calendar dates |
| `isFuture` | Whether the selected date follows `today` |
| `timeZone`, `displayUnits` | Account time zone and `"us"` or `"metric"` |
| `goal` | The effective goal for the date, or `null` when no goal version applied yet |
| `foodEntries` | Food entries in the Food Log's descending order |
| `waterEvents` | Water events in the Food Log's descending order |
| `events` | The merged descending sequence of food and water records; each has a `kind` of `"food"` or `"water"` |
| `nutritionTotals` | Known total and incomplete-data flag for each nutrient |
| `waterTotalMicroliters` | Sum of the day's water events |

`goal` contains `effectiveDate`, `calorieTargetMilliKcal`, `waterTargetMicroliters`, `proteinTargetMilligrams`, `carbohydrateTargetMilligrams`, `fatTargetMilligrams`, `fiberTargetMilligrams`, `sugarMaximumMilligrams`, and `sodiumMaximumMilligrams`.

Each `foodEntries` item contains `id`, `foodLogDate`, `localEventTime`, `createdAt`, `updatedAt`, `name`, `originalName`, `provider`, `providerFoodId`, `dataType`, `providerPublishedDate`, `providerModifiedDate`, `brand`, `barcode`, `marketCountry`, `authoritativeBaseUnit`, `authoritativeBaseQuantityMicrounits`, `authoritativeNutrition`, `selectedMeasurementId`, `selectedMeasurementLabel`, `selectedMeasurementUnit`, `supportedMeasurements`, `quantityMicrounits`, and the seven logged nutrient amounts: `energyMilliKcal`, `proteinMilligrams`, `carbohydrateMilligrams`, `fatMilligrams`, `fiberMilligrams`, `sugarMilligrams`, `sodiumMilligrams`. Nutrient amounts may be `null` when unknown. `authoritativeNutrition` and `supportedMeasurements` retain the source-backed measurement details shown by the Food Log; unit names and quantities are explicit.

`authoritativeBaseUnit` and `selectedMeasurementUnit` are `"g"`, `"ml"`, or `"serving"`. `authoritativeBaseQuantityMicrounits` is a positive integer count of that base unit, scaled by 1,000,000. `quantityMicrounits` is the selected measurement count on the same scale. `supportedMeasurements` is an array of `{ "id": string, "label": string, "unit": "g" | "ml" | "serving", "baseQuantityMicrounits": number }`; each positive integer `baseQuantityMicrounits` is the amount of authoritative base unit represented by one of that measurement. `selectedMeasurementId` identifies one of those measurements.

`authoritativeNutrition` is an object with exactly these seven keys: `energyMilliKcal`, `proteinMilligrams`, `carbohydrateMilligrams`, `fatMilligrams`, `fiberMilligrams`, `sugarMilligrams`, and `sodiumMilligrams`. Each value is either `null` (unknown) or `{ "amount": number, "fixedPointMultiplier": number }`, where `amount` is a finite nonnegative source value per `authoritativeBaseQuantityMicrounits` and `fixedPointMultiplier` is a positive integer that converts it to the key's milliunit. For example, `{ "energyMilliKcal": { "amount": 180, "fixedPointMultiplier": 1000 } }` means 180 kcal, or 180,000 milli-kcal, per authoritative base quantity. The seven top-level nutrient amounts on a food entry are the already-scaled values for the logged `quantityMicrounits` and selected measurement; use those for totals.

Each `waterEvents` item contains `id`, `foodLogDate`, `localEventTime`, `createdAt`, `updatedAt`, `amountMicroliters`, `preset8Count`, `preset16Count`, and `preset24Count`. An `events` item has the corresponding food or water fields plus its `kind`.

`nutritionTotals` has entries for `energyMilliKcal`, `proteinMilligrams`, `carbohydrateMilligrams`, `fatMilligrams`, `fiberMilligrams`, `sugarMilligrams`, and `sodiumMilligrams`. Each is `{ "known": number, "isIncomplete": boolean }`: `known` adds available values and `isIncomplete` signals that at least one food entry lacks that nutrient. An empty day has empty entry and event arrays, zero known totals, false incomplete flags, and zero water total.

The API omits browser-only calendar, editor, catalog, photo-analysis, CSRF, and notice state. All responses are private and non-cacheable. Error responses have `{ "error": string }`:

| HTTP status | Error | Meaning |
| --- | --- | --- |
| 400 | `invalid_date` | Date missing, duplicated, or not a real ISO calendar date |
| 401 | `invalid_token` | Bearer token missing, invalid, expired, or account disabled |
| 403 | `insufficient_scope` | Token lacks `daily-log:read` |
| 405 | `method_not_allowed` | A write method was attempted |
| 409 | `missing_setup` | The token's account has not completed Food Log setup |

The API uses a `WWW-Authenticate: Bearer` challenge on token and scope failures. Browser session cookies are not API credentials.
