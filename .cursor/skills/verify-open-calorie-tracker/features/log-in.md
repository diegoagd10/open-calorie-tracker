# Log in

Log in lets a person with an account open Open Calorie Tracker by entering a username and password, and lands them on the Food Log.

## Sub-features

- `login-disabled` keeps `Log in` disabled until both fields have text.
- `login-reject` shows an error for a wrong password and stays on the form.
- `login-submit` accepts the seed user and opens the Food Log.
- `login-redirect` sends a signed-out visit to `/` back to `/login`.

## How to get to it (user POV)

- Open `/login`.
- Open `/`, `/weight`, or `/settings` while signed out. The app redirects to `/login` once an account exists.
- Choose `Log in instead` on the registration error. On a seeded stack, `/register` itself redirects to `/login`.

## Driving it with ocal

Preconditions:

- `./scripts/verify/ocal doctor` prints `"ok": true` for this run.
- The stack was seeded. The username is `demo` and the password is `demo-password`.
- The browser jar is empty. Run `./scripts/verify/ocal browser reset` if a previous recipe signed in.

- **Open the form.** Run `./scripts/verify/ocal browser open /login`. The JSON `url` path is `/login`.
- **Button starts disabled.** Run `./scripts/verify/ocal browser text --role button --name "Log in"`. `disabled` is true.
- **Reject a wrong password.** Run `./scripts/verify/ocal browser fill --role textbox --name Username --value demo` and `./scripts/verify/ocal browser fill --role textbox --name Password --value wrong-password`. Run `./scripts/verify/ocal browser click --role button --name "Log in" --wait-role alert --within-role form --within-name "Log in"`. Run `./scripts/verify/ocal browser text --role alert --within-role form --within-name "Log in"`. The text is `Invalid username or password` and the URL path is still `/login`.
- **Sign in.** Run `./scripts/verify/ocal browser fill --role textbox --name Password --value demo-password` and `./scripts/verify/ocal browser click --role button --name "Log in" --wait-role heading --wait-name "Food Log"`. The heading text from `./scripts/verify/ocal browser text --role heading --name "Food Log"` is `Food Log`.
- **Signed-out redirect.** Run `./scripts/verify/ocal browser reset` and `./scripts/verify/ocal browser open /`. The JSON `url` path is `/login`.
- **Proof.** Run `./scripts/verify/ocal browser screenshot --path artifacts/verify/log-in/form.png` while the form is showing, and `./scripts/verify/ocal browser snapshot --aria --path artifacts/verify/log-in/form.aria.txt`.

## Gotchas

- `Log in` stays disabled until both fields are non-empty. Clicking it early fails the command.
- The username field drops every character that is not a letter or a number, so `demo` is the seeded name and `demo@host` becomes `demohost`.
- Five wrong passwords lock that username and IP for 15 minutes. One rejection in this recipe is enough. Do not loop on failures.
- After a successful sign-in, `browser open /login` follows the redirect to `/`. Run `browser reset` before repeating the form.
- The Next.js route announcer is also an alert. Read the alert inside the form named `Log in`, not the first alert on the page.
- `/register` redirects to `/login` once `demo` exists. First-run registration needs `OCAL_SKIP_SEED=1` on its own ports and run directory. Do not call that path verified by visiting `/login`.
