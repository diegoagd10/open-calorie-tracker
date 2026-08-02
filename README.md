# Food ingredient extractor

Small Node.js CLI that sends a local image to an OpenAI vision model. It prints `no food` when the image is not clearly food; otherwise it prints the identified ingredients as JSON.

`gpt-image-2` is an image-generation model whose output is an image, so it is not suitable for returning ingredient text. This script uses the configurable `OPENAI_MODEL` setting and defaults to `gpt-5.6-terra`, a vision-capable text-output model.

## Setup

```bash
pnpm install
pnpm setup-key
```

Open the local URL printed by `pnpm setup-key`, enter your API key, and close the page after it says it was saved. The key is written to `.env` with owner-only permissions and is ignored by git. Then run:

```bash
pnpm extract ./path/to/image.jpg
```

For a non-food image, stdout is exactly:

```text
no food
```

For a food image, stdout looks like:

```json
{
  "ingredients": ["rice", "chicken", "broccoli"]
}
```

You can override the model without changing the code:

```bash
OPENAI_MODEL=gpt-4.1-mini pnpm extract ./path/to/image.jpg
```
