import { useEffect, useState } from 'react';

import { IonButton, IonIcon, IonSpinner, IonToast } from '@ionic/react';
import { mailOpenOutline, refreshOutline } from 'ionicons/icons';
import { useHistory, useLocation } from 'react-router-dom';

import { getMockLink, resendMagicLink } from '../api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { StatusMessage } from '../components/StatusMessage';

interface CheckEmailState {
  email: string;
  requestId: string;
  resendAvailableAt: string;
}

const secondsUntil = (timestamp: string) =>
  Math.max(0, Math.ceil((new Date(timestamp).getTime() - Date.now()) / 1000));

const formatCountdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export const CheckEmailPage = () => {
  const history = useHistory();
  const location = useLocation<CheckEmailState>();
  const previewParams = new URLSearchParams(location.search);
  const email = location.state?.email ?? (import.meta.env.DEV ? previewParams.get('email') : null) ?? 'your email';
  const requestId = location.state?.requestId ?? (import.meta.env.DEV ? previewParams.get('requestId') : null) ?? '';
  const [resendAvailableAt, setResendAvailableAt] = useState(
    location.state?.resendAvailableAt ?? new Date(Date.now() + 60_000).toISOString(),
  );
  const [secondsRemaining, setSecondsRemaining] = useState(() => secondsUntil(resendAvailableAt));
  const [isResending, setIsResending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [mockHref, setMockHref] = useState<string>();

  useEffect(() => {
    if (!requestId && !import.meta.env.DEV) {
      history.replace('/auth/sign-in');
      return;
    }
    const updateRemaining = () => setSecondsRemaining(secondsUntil(resendAvailableAt));
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [history, requestId, resendAvailableAt]);

  useEffect(() => {
    if (!import.meta.env.DEV || !requestId) return;
    getMockLink(requestId)
      .then((response) => setMockHref(response.href))
      .catch(() => setMockHref(undefined));
  }, [requestId]);

  const resend = async () => {
    if (!requestId) return;
    setError(undefined);
    setIsResending(true);
    try {
      const response = await resendMagicLink(requestId);
      setMessage(response.confirmation);
      setResendAvailableAt(response.resendAvailableAt);
      if (import.meta.env.DEV) {
        const mockLink = await getMockLink(requestId);
        setMockHref(mockLink.href);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not resend the email.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <AuthLayout
      currentStep={2}
      recordLabel="Link dispatched"
      aside={
        <div className="context-statement compact">
          <h1>Check your inbox.</h1>
          <p>The link is single-use. Opening it verifies the address and this phone in one step.</p>
        </div>
      }
    >
      <div className="action-sheet">
        <div className="mail-mark" aria-hidden="true">
          <IonIcon icon={mailOpenOutline} />
          <span>15 min</span>
        </div>
        <div className="sheet-heading">
          <span className="sheet-folio">Access / Verify</span>
          <h2>We sent the link.</h2>
          <p>
            Open the email sent to <strong>{email}</strong>. You can close this screen while you check.
          </p>
        </div>

        {error && (
          <StatusMessage kind="error" title="New link not sent">
            {error} The previous working link remains valid.
          </StatusMessage>
        )}

        <div className="delivery-details">
          <div>
            <span>Delivery</span>
            <strong>Accepted</strong>
          </div>
          <div>
            <span>Link lifetime</span>
            <strong>15 minutes</strong>
          </div>
        </div>

        <IonButton
          className="secondary-action"
          fill="clear"
          disabled={secondsRemaining > 0 || isResending || !requestId ? true : undefined}
          onClick={resend}
        >
          {isResending ? <IonSpinner name="crescent" /> : <IonIcon slot="start" icon={refreshOutline} />}
          {secondsRemaining > 0 ? `Resend available in ${formatCountdown(secondsRemaining)}` : 'Resend sign-in link'}
        </IonButton>

        {mockHref && (
          <div className="prototype-shortcut">
            <span>Prototype shortcut</span>
            <a href={mockHref}>Open the generated sign-in link</a>
            <p>This development-only link stands in for the transactional email.</p>
          </div>
        )}

        <a className="text-link" href="/auth/sign-in">Use a different email</a>
      </div>

      <IonToast
        isOpen={Boolean(message)}
        message={message}
        duration={2400}
        position="top"
        color="success"
        onDidDismiss={() => setMessage(undefined)}
      />
    </AuthLayout>
  );
};
