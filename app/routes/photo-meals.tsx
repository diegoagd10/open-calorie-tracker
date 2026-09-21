import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigate, useRevalidator } from "react-router";
import type { PhotoAnalysisService } from "../photo-analysis/photo-analysis.server";
import type { PresentedPhotoAnalysisReadiness } from "./photo-analysis-readiness";
import styles from "../photo-analysis/photo-meals.module.css";
import foodStyles from "../food-log.module.css";
import methodStyles from "./add-food-method.module.css";
import { UiIcon } from "../ui-icon";

type PhotoMeal = ReturnType<PhotoAnalysisService["view"]>;
type PhotoAction = { destination?: string; error?: string; id?: string };

function imageUrl(id: string) {
  return `/photo-analysis?id=${encodeURIComponent(id)}&image=1`;
}

export function usePhotoUpload(
  date: string,
  csrfToken: string,
  readiness: PresentedPhotoAnalysisReadiness = { state: "ready" },
) {
  const upload = useFetcher<PhotoAction>();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const pendingUpload = useRef<FormData | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const pending = upload.state !== "idle";
  return {
    pending,
    capture: (
      <div className={methodStyles.captureMethod}>
        <label className={methodStyles.method}>
          <span className={methodStyles.icon}>
            <UiIcon name="camera" />
          </span>
          <span className={methodStyles.label}>AI photo</span>
          <input
            aria-describedby={
              readiness.state === "unavailable"
                ? "photo-analysis-readiness"
                : undefined
            }
            aria-label="Take photo · AI calories"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={pending || readiness.state === "unavailable"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void navigate(`/?date=${date}`);
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
        {readiness.state === "unavailable" ? (
          <div
            className={methodStyles.availability}
            data-open={availabilityOpen || undefined}
          >
            <button
              aria-controls="photo-analysis-readiness"
              aria-expanded={availabilityOpen}
              aria-label="Why AI photo is unavailable"
              className={methodStyles.availabilityTrigger}
              onClick={() => setAvailabilityOpen(open => !open)}
              type="button"
            >
              <UiIcon name="help" />
            </button>
            <div
              aria-label="AI photo unavailable"
              className={methodStyles.availabilityPopover}
              id="photo-analysis-readiness"
              role="note"
            >
              <p>{readiness.reason}</p>
              {readiness.destination ? (
                <Link to={readiness.destination}>Open settings</Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    ),
    feedback: pending || error || upload.data?.error ? (
      <>
        {pending ? (
          <article className={styles.card}>
            {preview && preview.startsWith("blob:") ? (
              <img src={encodeURI(preview)} alt="Plate being uploaded" />
            ) : null}
            <div>
              <strong role="status">Uploading photo…</strong>
              <progress aria-label="Uploading photo" />
              <p>Keep this page open until upload finishes.</p>
            </div>
          </article>
        ) : null}
        {error || upload.data?.error ? (
          <article className={styles.card} role="alert">
            <div>
              <strong>Photo upload failed</strong>
              <p>{error ?? upload.data?.error}</p>
              {upload.data?.destination ? (
                <Link to={upload.data.destination}>Open settings</Link>
              ) : null}
              {pendingUpload.current ? (
                <button type="button" onClick={() => {
                  void upload.submit(pendingUpload.current, {
                    action: "/photo-analysis", method: "post", encType: "multipart/form-data",
                  });
                }}>Retry upload</button>
              ) : null}
            </div>
          </article>
        ) : null}
      </>
    ) : null,
  };
}

export function usePhotoMealPolling(meals: PhotoMeal[]) {
  const revalidator = useRevalidator();
  const active = meals.some((meal) => meal.status === "active");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 1000);
    return () => clearInterval(timer);
  }, [active, revalidator]);
}

export function PhotoMealCard({
  meal,
  csrfToken,
}: {
  meal: PhotoMeal;
  csrfToken: string;
}) {
  const active = meal.status === "active";
  const unsuccessful = !active && meal.status !== "succeeded";
  const title = meal.name ?? meal.result?.name ?? "Plate photo";
  const status = active
    ? "Analyzing photo"
    : meal.status === "canceled"
      ? "Analysis canceled"
      : meal.status === "interrupted"
        ? "Analysis interrupted"
        : meal.status === "failed"
          ? "Analysis failed"
          : "AI photo estimate";
  const content = (
    <>
      <span
        className={`${foodStyles.foodEntryMarker} ${unsuccessful ? styles.failedMarker : ""}`}
        aria-hidden={active ? undefined : true}
      >
        {active ? (
          <img className={styles.mealPhoto} src={imageUrl(meal.id)} alt="Your plate" />
        ) : (
          <UiIcon name={unsuccessful ? "info" : "utensils"} />
        )}
      </span>
      <span className={styles.rowLabel}>AI photo estimate</span>
      <span className={foodStyles.foodEntryContent}>
        <strong>{title}</strong>
        <small
          className={unsuccessful ? styles.failedStatus : undefined}
          role={meal.status === "succeeded" ? undefined : "status"}
        >
          {active ? <span className={foodStyles.photoActivityDot} aria-hidden="true" /> : null}
          {status}
        </small>
      </span>
      {meal.energyMilliKcal !== null ? (
        <span className={foodStyles.foodEntryEnergy}>
          {Math.round(meal.energyMilliKcal / 1000)} <small>kcal</small>
        </span>
      ) : null}
    </>
  );
  if (meal.entryId && meal.status === "succeeded") {
    return (
      <article aria-label={title}>
        <Link
          className={`${foodStyles.foodEntryCard} ${styles.rowSummary}`}
          data-entry-editor-trigger
          to={`/?date=${meal.foodLogDate}&entry=${meal.entryId}`}
        >
          {content}
        </Link>
      </article>
    );
  }
  return (
    <article className={styles.mealRow} aria-label={title} aria-busy={active || undefined}>
      <details>
        <summary className={`${foodStyles.foodEntryCard} ${styles.rowSummary}`}>
          {content}
        </summary>
        <div className={styles.rowDetails}>
          <PhotoMealStatus meal={meal} csrfToken={csrfToken} />
        </div>
      </details>
    </article>
  );
}

export function PhotoMealStatus({ meal, csrfToken }: { meal: PhotoMeal; csrfToken: string }) {
  const action = useFetcher<PhotoAction>();
  const active = meal.status === "active";
  return (
    <div className={styles.status}>
      {active && meal.entryId ? <small>Previous nutrition retained</small> : null}
      {meal.error ? <p role="alert">{meal.error}</p> : null}
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
      {action.data?.error ? (
        <p role="alert">
          {action.data.error}
          {action.data.destination ? (
            <> <Link to={action.data.destination}>Open settings</Link></>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function PhotoCorrection({
  meal,
  csrfToken,
}: {
  meal: PhotoMeal;
  csrfToken: string;
}) {
  const action = useFetcher<PhotoAction>({ key: `photo-correction:${meal.id}` });
  const navigate = useNavigate();
  const [key, setKey] = useState<string>();
  const submitted = useRef(false);
  useEffect(() => {
    if (action.state !== "idle" || (submitted.current && action.data)) {
      if (action.state === "idle") submitted.current = false;
      void navigate(`/?date=${meal.foodLogDate}`);
    }
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
        {meal.provenanceState === "legacy" ? (
          <p>
            <small>Legacy analysis · detailed matching provenance unavailable</small>
          </p>
        ) : null}
        <p>Consumed fraction: {meal.result?.consumedFraction}</p>
        {meal.result?.components.map((component) => (
          <p key={component.id}>
            <strong>{component.name}</strong> · {component.quantity}{" "}
            {component.unit}
            <br />
            {component.source.kind === "usda"
              ? `USDA${component.source.dataType ? ` ${component.source.dataType}` : ""} · FDC ${component.source.fdcId}`
              : `${meal.provenanceState === "recorded" ? "Gemini" : "AI"} estimate: ${component.source.reason}`}
            {component.supplements.map((item) => (
              <span key={item.nutrient}>
                <br />
                {`${meal.provenanceState === "recorded" ? "Gemini" : "AI"} estimate for ${item.nutrient}: ${item.amount} — ${item.reason}`}
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
        <action.Form action="/photo-analysis" method="post" onSubmit={() => { submitted.current = true; }}>
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="entryId" type="hidden" value={meal.entryId ?? ""} />
          <input name="idempotencyKey" type="hidden" value={key} />
          <input name="intent" type="hidden" value="correct" />
          <label>
            Correction
            <textarea
              name="correction"
              disabled={action.state !== "idle"}
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
          {action.data?.error ? (
            <p role="alert">
              {action.data.error}
              {action.data.destination ? (
                <> <Link to={action.data.destination}>Open settings</Link></>
              ) : null}
            </p>
          ) : null}
        </action.Form>
      ) : (
        <button type="button" onClick={() => setKey(crypto.randomUUID())}>
          Correct with AI
        </button>
      )}
    </section>
  );
}
