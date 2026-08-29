import { getApplicationDatabase } from "../database/runtime.server";
import { AuthenticationService } from "./authentication.server";

let authenticationService: AuthenticationService | undefined;

export function getAuthenticationService(): AuthenticationService {
  authenticationService ??= new AuthenticationService(
    getApplicationDatabase().getConnection(),
  );

  return authenticationService;
}
