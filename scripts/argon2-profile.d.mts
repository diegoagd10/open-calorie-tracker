export type Argon2Profile = {
  memory: number;
  parallelism: number;
  passes: number;
  tagLength: number;
};

export function getArgon2Profile(options?: {
  environment?: Record<string, string | undefined>;
  useTestProfile?: boolean;
}): Argon2Profile;
