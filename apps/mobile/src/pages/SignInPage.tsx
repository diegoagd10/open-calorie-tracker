import { useRef, useState } from 'react';

import { IonButton, IonIcon, IonInput, IonSpinner } from '@ionic/react';
import { arrowForwardOutline, refreshOutline } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';

import { ApiError, resendMagicLink, sendMagicLink } from '../api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { StatusMessage } from '../components/StatusMessage';
import { releaseFocus } from '../utils/navigation';

export const SignInPage = () => {
  const history = useHistory();
  const emailInput = useRef<HTMLIonInputElement>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [deliveryRequestId, setDeliveryRequestId] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const focusEmail = () => {
    window.requestAnimationFrame(() => void emailInput.current?.setFocus());
  };

  const continueToEmail = (requestId: string, resendAvailableAt: string) => {
    releaseFocus();
    history.push('/auth/check-email', { email, requestId, resendAvailableAt });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter the email address you want to use.');
      focusEmail();
      return;
    }

    setError(undefined);
    setDeliveryRequestId(undefined);
    setIsSubmitting(true);
    try {
      const response = await sendMagicLink(email);
      continueToEmail(response.requestId, response.resendAvailableAt);
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      setError(apiError?.message ?? 'We could not send the sign-in email. Please try again.');
      setDeliveryRequestId(apiError?.requestId);
      if (!apiError?.requestId) focusEmail();
    } finally {
      setIsSubmitting(false);
    }
  };

  const retryDelivery = async () => {
    if (!deliveryRequestId) return;
    setError(undefined);
    setIsSubmitting(true);
    try {
      const response = await resendMagicLink(deliveryRequestId);
      continueToEmail(deliveryRequestId, response.resendAvailableAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not resend the email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout currentStep={1} recordLabel="Private access record">
      <div className="action-sheet">
        <div className="sheet-heading">
          <span className="sheet-folio">Access / Email</span>
          <h2>Sign in with your email.</h2>
          <p>We’ll send a one-time link. It expires in 15 minutes.</p>
        </div>

        <form className="auth-form" onSubmit={submit} noValidate>
          <IonInput
            ref={emailInput}
            className={`email-input ${error && !deliveryRequestId ? 'ion-invalid ion-touched' : ''}`}
            type="email"
            inputMode="email"
            autocomplete="email"
            label="Email address"
            labelPlacement="stacked"
            placeholder="you@example.com"
            value={email}
            onIonInput={(event) => {
              setEmail(String(event.detail.value ?? ''));
              if (error && !deliveryRequestId) setError(undefined);
            }}
            aria-describedby={error && !deliveryRequestId ? 'email-error' : undefined}
            aria-invalid={Boolean(error && !deliveryRequestId)}
          />

          {error && !deliveryRequestId && (
            <p id="email-error" className="field-error" role="alert">{error}</p>
          )}

          {error && deliveryRequestId && (
            <StatusMessage kind="error" title="Email not sent">
              {error} Your sign-in request is saved, so you can resend without starting over.
            </StatusMessage>
          )}

          {deliveryRequestId ? (
            <IonButton
              className="primary-action"
              type="button"
              expand="block"
              disabled={isSubmitting ? true : undefined}
              onClick={retryDelivery}
            >
              {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon slot="end" icon={refreshOutline} />}
              Try sending again
            </IonButton>
          ) : (
            <IonButton
              className="primary-action"
              type="submit"
              expand="block"
              disabled={isSubmitting ? true : undefined}
            >
              {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon slot="end" icon={arrowForwardOutline} />}
              Email me a sign-in link
            </IonButton>
          )}
        </form>

        <p className="privacy-note">
          By continuing, you’re only confirming this email belongs to you. We won’t ask for demographic or health-profile information.
        </p>
      </div>
    </AuthLayout>
  );
};
