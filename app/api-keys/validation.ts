import { EXPIRATION_PRESETS, isApiKeyScope, type ApiKeyScope } from "./presets";

export type ExpirationValue = (typeof EXPIRATION_PRESETS)[number]["value"];

/** A key's editable fields once they satisfy every invariant that does not depend on stored state. */
export type ApiKeyFields = { name: string; scopes: ApiKeyScope[]; expiration: ExpirationValue };

export type ApiKeyFieldErrors = { name?: string; scopes?: string; expiration?: string };

function isExpirationValue(value: string): value is ExpirationValue {
  return EXPIRATION_PRESETS.some((preset) => preset.value === value);
}

function isPrintableName(name: string): boolean {
  return name.length > 0 && name.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(name);
}

/** Parses the create and edit form: a 1–80 printable-character name, at least one known scope, and a preset. */
export function parseApiKeyFields(form: FormData):
  | { success: true; data: ApiKeyFields }
  | { success: false; errors: ApiKeyFieldErrors } {
  const name = String(form.get("name") ?? "").trim();
  const scopes = [...new Set(form.getAll("scope").map(String))];
  const expiration = String(form.get("expiration") ?? "");
  const nameValid = isPrintableName(name);
  const knownScopes = scopes.filter(isApiKeyScope);
  const scopesValid = scopes.length > 0 && knownScopes.length === scopes.length;
  if (nameValid && scopesValid && isExpirationValue(expiration)) {
    return { success: true, data: { name, scopes: knownScopes, expiration } };
  }
  const expirationValid = isExpirationValue(expiration);
  return {
    success: false,
    errors: {
      ...(nameValid ? {} : { name: "Enter a name of 1 to 80 printable characters." }),
      ...(scopesValid ? {} : { scopes: "Choose at least one permission." }),
      ...(expirationValid ? {} : { expiration: "Choose an expiration." }),
    },
  };
}
