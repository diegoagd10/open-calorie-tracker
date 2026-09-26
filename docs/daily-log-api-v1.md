# Daily Food Log API v1 and public OAuth clients

The API and OAuth routes run in the same Open Calorie Tracker instance as the browser UI. The API reads one account's Food Log; it does not provide write operations. A public client must be registered by a signed-in account holder at `/settings/oauth-clients` before it can ask any account holder for access. Registration alone grants nothing.

## Discover and authorize

Read `/.well-known/oauth-authorization-server` for the instance's `issuer`, authorization endpoint, token endpoint, supported scope, and PKCE method. The instance supports authorization code with `S256` PKCE for public clients. A public client has no shared secret. It must retain a fresh, high-entropy `code_verifier` for each attempt and send its SHA-256 base64url challenge in the authorization request. See [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html) and the [OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html).

Open `/oauth/authorize` in the account holder's browser with these query parameters:

| Parameter | Value |
| --- | --- |
| `response_type` | `code` |
| `client_id` | The registered public client ID |
| `redirect_uri` | One exact URI displayed in the client's registration |
| `scope` | `daily-log:read` |
| `code_challenge` | Base64url SHA-256 of the verifier, without padding |
| `code_challenge_method` | `S256` |
| `state` | A client-generated, unpredictable value of 16 to 512 characters |

The signed-in user sees the client name and its Food Log read permission and can approve or decline. Approval redirects to the registered URI with a one-time `code` and the original `state`; denial redirects with `error=access_denied` and the original `state`. The client must check `state` before exchanging a code. Invalid client or redirect requests receive an error at the instance and are never redirected to an unregistered URI. Codes expire after five minutes and can be exchanged once.

Send a `POST` to `/oauth/token` with `Content-Type: application/x-www-form-urlencoded` and `grant_type=authorization_code`, `code`, `client_id`, the same `redirect_uri`, and the original `code_verifier`. The response has `access_token`, `token_type: "Bearer"`, `expires_in: 900`, and `scope: "daily-log:read"`. No refresh token is issued in this ticket. A failed exchange returns JSON `{ "error": "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" }` with HTTP 400. Codes and tokens are stored as SHA-256 hashes; the plaintext token appears only in the token response.

The callback rules are in [Public OAuth client registration](oauth-client-registration.md). For external clients, serve the instance and callback over trusted HTTPS. An instance accessed over LAN HTTP exposes the same routes and behavior, but the operator must provide HTTPS before sending OAuth credentials across an untrusted network. Loopback HTTP callbacks remain available for local development. This feature does not provision TLS.

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
