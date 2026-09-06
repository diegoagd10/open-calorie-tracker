import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigate, useRevalidator } from "react-router";
import type { PhotoAnalysisService } from "../photo-analysis/photo-analysis.server";
import styles from "../photo-analysis/photo-meals.module.css";

type PhotoMeal = ReturnType<PhotoAnalysisService["view"]>;
type PhotoAction = { error?: string; id?: string };

function imageUrl(id: string) {
  return `/photo-analysis?id=${encodeURIComponent(id)}&image=1`;
}

export function PhotoMeals({
  meals,
  date,
  csrfToken,
}: {
  meals: PhotoMeal[];
  date: string;
  csrfToken: string;
}) {
  const upload = useFetcher<PhotoAction>();
  const revalidator = useRevalidator();
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const pendingUpload = useRef<FormData | null>(null);
  const active = meals.some((meal) => meal.status === "active");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 1000);
    return () => clearInterval(timer);
  }, [active, revalidator]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  return (
    <section aria-label="Photo meals" className={styles.section}>
      <label className={styles.capture}>
        Take plate photo
        <input
          aria-label="Take plate photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          disabled={upload.state !== "idle"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 8388608) {
              setError("Choose a photo up to 8 MB.");
              return;
            }
            setError(undefined);
            setPreview(URL.createObjectURL(file));
            const form = new FormData();
            form.set("intent", "start");
            form.set("date", date);
            form.set("csrfToken", csrfToken);
            form.set("idempotencyKey", crypto.randomUUID());
            form.set("photo", file);
            pendingUpload.current = form;
            void upload.submit(form, {
              action: "/photo-analysis",
              method: "post",
              encType: "multipart/form-data",
            });
            event.target.value = "";
          }}
        />
      </label>
      <p className={styles.privacy}>
        Photos are sent to the configured AI provider. Estimates save
        automatically and can be corrected. Photos and history stay private with
        your meal until you delete it. Local deletion does not delete
        provider-managed data.
      </p>
      {upload.state !== "idle" ? (
        <article className={styles.card}>
          {preview && preview.startsWith("blob:") ? (
            <img src={preview} alt="Plate being uploaded" />
          ) : null}
          <div>
            <strong role="status">Uploading photo…</strong>
            <progress aria-label="Uploading photo" />
            <p>Keep this page open until upload finishes.</p>
          </div>
        </article>
      ) : null}
      {error || upload.data?.error ? (
        <div role="alert">
          <p>{error ?? upload.data?.error}</p>
          {pendingUpload.current ? (
            <button
              type="button"
              onClick={() => {
                void upload.submit(pendingUpload.current, {
                  action: "/photo-analysis",
                  method: "post",
                  encType: "multipart/form-data",
                });
              }}
            >
              Retry upload
            </button>
          ) : null}
        </div>
      ) : null}
      {meals.map((meal) => (
        <PhotoMealCard key={meal.id} meal={meal} csrfToken={csrfToken} />
      ))}
    </section>
  );
}

function PhotoMealCard({
  meal,
  csrfToken,
}: {
  meal: PhotoMeal;
  csrfToken: string;
}) {
  const action = useFetcher<PhotoAction>();
  const [elapsed, setElapsed] = useState(0);
  const active = meal.status === "active";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(
      () =>
        setElapsed(
          Math.max(
            0,
            Math.floor((Date.now() - Date.parse(meal.startedAt)) / 1000),
          ),
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [active, meal.startedAt]);
  const title = meal.name ?? meal.result?.name ?? "Plate photo";
  return (
    <article className={styles.card} aria-label={title}>
      <img src={imageUrl(meal.id)} alt="Your plate" />
      <div className={styles.content}>
        {meal.entryId && !active ? (
          <Link
            data-entry-editor-trigger
            to={`/?date=${meal.foodLogDate}&entry=${meal.entryId}`}
          >
            <strong>{title}</strong>
          </Link>
        ) : (
          <strong>{title}</strong>
        )}
        <small>
          AI photo estimate
          {meal.energyMilliKcal === null
            ? ""
            : ` · ${Math.round(meal.energyMilliKcal / 1000)} kcal`}
        </small>
        {active ? (
          <>
            <p role="status">{meal.stage}</p>
            <progress aria-label={meal.stage} />
            <small>
              {elapsed} seconds elapsed
              {meal.entryId ? " · Previous nutrition retained" : ""}
            </small>
          </>
        ) : null}
        {meal.error ? <p role="status">{meal.error}</p> : null}
        <action.Form
          action="/photo-analysis"
          method="post"
          className={styles.actions}
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="id" value={meal.id} />
          <input type="hidden" name="attemptId" value={meal.attemptId} />
          <input
            type="hidden"
            name="idempotencyKey"
            value={`retry:${meal.attemptId}`}
          />
          {active ? (
            <button
              disabled={action.state !== "idle"}
              name="intent"
              value="cancel"
            >
              Cancel analysis
            </button>
          ) : meal.status !== "succeeded" ? (
            <>
              <button
                disabled={action.state !== "idle"}
                name="intent"
                value="retry"
              >
                Retry analysis
              </button>
              <button
                disabled={action.state !== "idle"}
                name="intent"
                value="delete"
              >
                Delete photo meal
              </button>
            </>
          ) : null}
        </action.Form>
        {action.data?.error ? <p role="alert">{action.data.error}</p> : null}
      </div>
    </article>
  );
}

export function PhotoCorrection({
  meal,
  csrfToken,
}: {
  meal: PhotoMeal;
  csrfToken: string;
}) {
  const action = useFetcher<PhotoAction>();
  const navigate = useNavigate();
  const [key, setKey] = useState<string>();
  useEffect(() => {
    if (action.state === "idle" && action.data?.id)
      void navigate(`/?date=${meal.foodLogDate}`);
  }, [action.state, action.data, meal.foodLogDate, navigate]);
  return (
    <section className={styles.correction} aria-label="Photo analysis details">
      <img
        className={styles.detailPhoto}
        src={imageUrl(meal.id)}
        alt="Original plate"
      />
      <details>
        <summary>Components, sources and assumptions</summary>
        <p>Consumed fraction: {meal.result?.consumedFraction}</p>
        {meal.result?.components.map((component) => (
          <p key={component.id}>
            <strong>{component.name}</strong> · {component.quantity}{" "}
            {component.unit}
            <br />
            {component.source.kind === "usda"
              ? `USDA FDC ${component.source.fdcId}`
              : `AI estimate: ${component.source.reason}`}
            {component.supplements.map((item) => (
              <span key={item.nutrient}>
                <br />
                AI estimate for {item.nutrient}: {item.amount} — {item.reason}
              </span>
            ))}
          </p>
        ))}
        <ul>
          {meal.result?.assumptions.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </details>
      {key ? (
        <action.Form action="/photo-analysis" method="post">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="entryId" type="hidden" value={meal.entryId ?? ""} />
          <input name="idempotencyKey" type="hidden" value={key} />
          <input name="intent" type="hidden" value="correct" />
          <label>
            Correction
            <textarea
              name="correction"
              required
              maxLength={2000}
              placeholder="For example: it has butter"
              autoFocus
            />
          </label>
          <button disabled={action.state !== "idle"}>
            {action.state === "idle"
              ? "Apply correction"
              : "Starting correction…"}
          </button>
          {action.data?.error ? <p role="alert">{action.data.error}</p> : null}
        </action.Form>
      ) : (
        <button type="button" onClick={() => setKey(crypto.randomUUID())}>
          Correct with AI
        </button>
      )}
    </section>
  );
}
