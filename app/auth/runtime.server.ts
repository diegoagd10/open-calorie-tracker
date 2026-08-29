import { getApplicationDatabase } from "../database/runtime.server";
import { AuthenticationService } from "./authentication.server";
import { PreAuthenticationCsrfService } from "./pre-authentication-csrf.server";

let authenticationService: AuthenticationService | undefined;
let preAuthenticationCsrfService: PreAuthenticationCsrfService | undefined;

export function getAuthenticationService(): AuthenticationService {
  authenticationService ??= new AuthenticationService(
    getApplicationDatabase().getClient(),
  );

  return authenticationService;
}

export function getPreAuthenticationCsrfService(): PreAuthenticationCsrfService {
  preAuthenticationCsrfService ??= new PreAuthenticationCsrfService(
    getApplicationDatabase().getClient(),
  );

  return preAuthenticationCsrfService;
}
