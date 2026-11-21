# Auth

The server has one account. Until it exists, every page leads to `/register`, where the user creates it. After that `/register` is closed, every page needs a session, and the user logs in at `/login` and logs out from the header.

## Sub-features

- `login-fail` keeps the user on `/login` with `Invalid username or password` for a wrong password.
- `login` logs in with the right password, stores the session in an HTTP-only cookie, and opens the Food Log.
- `logout` ends the session from `Log out` in the header and shows the login form. After that, `/` leads to `/login`.
- `register` creates the first account at `/register` and logs it in.
- `register-closed` sends `/register` to `/login` once the account exists.

## How to get to it (user POV)

- Open any page without a session. The app sends you to `/login`.
- Choose `Log out` in the header of the Food Log, Weight, or Settings.
- Open any page while the server has no account. The app sends you to `/register`.

## Driving it with control-oct

Preconditions:

- A fresh `up`. The browser has no session, and the account `ana` exists.

```bash
C=.claude/skills/verify-open-calorie-tracker/control-oct.ts
$C goto /register                       # exits 1: the account exists, so /register redirected to /login, and the browser has no session
$C type textbox "Username" ana
$C type textbox "Password" wrong-password
$C click button "Log in"
$C snapshot                             # url /login, form "Log in" has alert "Invalid username or password"
$C type textbox "Password" correct-horse-battery-staple
$C click button "Log in"                # url /, heading "Food Log"
$C api GET /v1/settings/profile         # 200 {username: ana}
$C click button "Log out"               # url /login
$C goto /                               # exits 1: redirected to /login, the browser has no session
$C reset                                # setup: "Deleted every user"
$C goto /                               # url /register, form "Create account"
$C type textbox "Username" ana
$C type textbox "Password" correct-horse-battery-staple
$C type textbox "Confirm password" correct-horse-battery-staple
$C click button "Create account"        # url /, heading "Food Log"
$C api GET /v1/settings/profile         # 200 {username: ana}, the account the form created
$C screenshot auth.png
$C doctor                               # every check passes again
```

End state that proves it works:

- The snapshot after the wrong password shows the alert, and the browser stays on `/login`.
- `goto /` after `Log out` fails with `the browser has no session`.
- After `Create account`, `auth.png` shows the Food Log, and `GET /v1/settings/profile` returns `ana` with the session the form stored.
- `doctor` passes, because the form created the seed user again with the seed password.

## Gotchas

- `control-oct.ts` always seeds `ana`, so it cannot start an instance without an account. The block empties it with `control-oct.ts reset`, which runs `dist/reset.js`, the script behind `pnpm --filter api db:reset`: in `apps/api` for a local instance, and in the `seed` service of `docker-compose.verify.yml` for a `--docker` one. That script deletes every user and with them every entry, goal, and key. It refuses to run with `NODE_ENV=production`, so it never runs in the `api` container itself.
- Register `ana` with the seed password. Another account makes the `login` check of `doctor` fail, and `login` without flags fails too. Run `up` again to get the seed user back.
- Five wrong passwords lock the account for 15 minutes, and the alert then says the account is locked. The block uses one. Run `up` again to reseed after a lockout.
- The `login` command clears the cookies and fills the same form. Drive the form by hand, as here, when the form is what you verify.
- The username field drops anything but letters and digits as you type.
- Next.js adds a `role="alert"` route announcer to every page. Read the alert inside the form, not the last `alert` line of a snapshot.
