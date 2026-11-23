# Settings

Settings, at `/settings`, has four sections. `Profile` shows the username and changes the password. `Daily goals` sets the targets that the Food Log measures each day against. `Weight goal` sets the starting and goal weight, which [Weight goal](./weight-goal.md) covers. `API keys` creates keys that let other apps use the account, and revokes them.

## Sub-features

- `profile-username` shows the username in a disabled field.
- `password-change` changes the password from the `Change password` dialog and confirms `Password changed.` in Profile.
- `daily-goals` saves the changed goals, and the Food Log measures against them.
- `api-key-create` creates a named key with an expiry of 30 days, 90 days, 1 year, or never, and shows the full key once in `Key created`.
- `api-key-use` lets an app exchange the key for an access token at `POST /v1/token`. The list then says when the key was last used.
- `api-key-revoke` revokes a key after the `Revoke this key?` confirmation. The key stops working at once.

## How to get to it (user POV)

- Choose the `Settings` link in the header of the Food Log or Weight.
- On `/weight` without a weight goal, choose the `Settings` link in the notice.

## Driving it with control-oct

Preconditions:

- A fresh `up`. The seed user has the default goals and no API keys.

```bash
C=.claude/skills/verify-open-calorie-tracker/control-oct.ts
TODAY=$(TZ=America/New_York date +%F)
$C login
$C click link "Settings"                # url /settings; textbox "Username" [disabled]: ana
$C type textbox "Water" 80
$C press Enter                          # submits the Daily goals form
$C snapshot                             # form "Daily goals" shows "Daily goals saved."; textbox "Water": "80"
$C api GET /v1/settings/daily-goals     # water 80, the others unchanged
$C click button "Create API key"
$C type textbox "Name" Shortcuts
$C click radio "30 days"
$C click button "Create key"            # dialog "Key created": textbox "Your API key" holds the full key
$C click button "Done"                  # list "API keys": "Shortcuts New", "Never used"
KEY=$($C api GET /v1/settings/api-keys | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).body[0].key))')
$C api POST /v1/token --body "{\"apiKey\": \"$KEY\"}"   # status 200: an app traded the key for a token
$C goto /settings
$C snapshot                             # "Created today · Last used just now · Expires <date>"
$C click button "Revoke"
$C click button "Revoke key"            # "No API keys yet"
$C api POST /v1/token --body "{\"apiKey\": \"$KEY\"}"   # status 401: the revoked key is refused
$C click button "Change password"
$C type textbox "Current password" correct-horse-battery-staple
$C type textbox "New password" battery-horse-staple-2
$C type textbox "Confirm new password" battery-horse-staple-2
$C click button "Change password"       # the dialog closes; Profile has status "Password changed."
$C screenshot settings.png
$C login                                # exits 1: login as ana failed: Invalid username or password
$C login --password battery-horse-staple-2
$C snapshot                             # Food Log: Water "0 fl oz / 80 fl oz"
$C api GET "/v1/daily-log?date=$TODAY&timeZone=America/New_York"   # goals.water 80
```

End state that proves it works:

- `settings.png` shows `Password changed.` in Profile and the Water goal of 80.
- `GET /v1/settings/daily-goals` and the Food Log both show the Water goal of 80.
- `POST /v1/token` takes the key while it exists and refuses it once revoked.
- The old password fails at `/login` and the new one logs in.

## Gotchas

- Settings has two buttons named `Save`, one in Daily goals and one in Weight goal. Press `Enter` in a field of the form you mean.
- `Change password` names both the button in Profile and the dialog's submit button. While the dialog is open, `click` finds only the one in the dialog.
- After the password change, the `login` check of `doctor` fails, and `login` without `--password` fails too. Run `up` again before the next feature.
- `GET /v1/settings/api-keys` returns each full key, because the list copies it again. The transcript redacts them, but a screenshot does not. Never take a screenshot of the open `Key created` dialog.
- An API key does not work as a bearer token on the REST routes, which answer 401. Exchange it at `POST /v1/token`, or send it as the bearer token of `POST /v1/mcp`, the MCP endpoint.
- An expired key shows only `Delete`, which deletes it without asking.
