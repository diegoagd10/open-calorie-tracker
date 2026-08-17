import { useEffect, useState } from 'react';

import { IonButton, IonIcon, IonSpinner } from '@ionic/react';
import { arrowForwardOutline, checkmarkOutline, refreshOutline } from 'ionicons/icons';
import { useHistory, useLocation } from 'react-router-dom';

import { ApiError, type SessionResponse, exchangeMagicLink } from '../api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { StatusMessage } from '../components/StatusMessage';
import { releaseFocus } from '../utils/navigation';

type VerifyState = 'working' | 'success' | 'error';

const previewErrors: Record<string, { code: string; message: string }> = {
  expired: {
    code: 'MAGIC_LINK_EXPIRED',
    message: 'This sign-in link has expired. Request a new one.',
  },
  invalid: {
    code: 'INVALID_MAGIC_LINK',
    message: 'This sign-in link is not valid.',
  },
  superseded: {
    code: 'MAGIC_LINK_SUPERSEDED',
    message: 'A newer sign-in link was requested. Use the latest email.',
  },
  used: {
    code: 'MAGIC_LINK_USED',
    message: 'This sign-in link has already been used.',
  },
};

export const VerifyPage = () => {
  const history = useHistory();
  const location = useLocation();
  const [state, setState] = useState<VerifyState>('working');
  const [session, setSession] = useState<SessionResponse>();
  const [error, setError] = useState<{ code: string; message: string }>();

  useEffect(() => {
    const preview = new URLSearchParams(location.search).get('preview');
    if (preview && previewErrors[preview]) {
      setError(previewErrors[preview]);
      setState('error');
      return;
    }

    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    if (!token) {
      setError(previewErrors.invalid);
      setState('error');
      return;
    }

    exchangeMagicLink(token)
      .then((response) => {
        setSession(response);
        setState('success');
      })
      .catch((caught) => {
        const apiError = caught instanceof ApiError ? caught : undefined;
        setError({
          code: apiError?.code ?? 'VERIFY_FAILED',
          message: apiError?.message ?? 'We could not verify this link.',
        });
        setState('error');
      });
  }, [location.search]);

  const retryLabel = error?.code === 'MAGIC_LINK_SUPERSEDED' ? 'Return to your inbox' : 'Request a new link';

  return (
    <AuthLayout
      currentStep={state === 'success' ? 3 : 2}
      recordLabel={state === 'success' ? 'Identity verified' : 'Link verification'}
      aside={
        <div className="context-statement compact">
          <h1>{state === 'success' ? 'Email confirmed.' : state === 'error' ? 'This link needs attention.' : 'Verifying your link.'}</h1>
          <p>Your account is created only after the email link is accepted.</p>
        </div>
      }
    >
      <div className="action-sheet verify-sheet" aria-live="polite">
        {state === 'working' && (
          <>
            <div className="verification-seal is-working">
              <IonSpinner name="crescent" />
            </div>
            <div className="sheet-heading centered">
              <span className="sheet-folio">Access / Exchange</span>
              <h2>Opening your private record…</h2>
              <p>We’re checking that the link is active and hasn’t been used.</p>
            </div>
          </>
        )}

        {state === 'success' && session && (
          <>
            <div className="verification-seal is-success">
              <IonIcon icon={checkmarkOutline} />
            </div>
            <div className="sheet-heading centered">
              <span className="sheet-folio">Access / Confirmed</span>
              <h2>You’re signed in.</h2>
              <p><strong>{session.account.email}</strong> is verified on this phone.</p>
            </div>
            <StatusMessage kind="success" title="Session saved">
              You’ll stay signed in here until you sign out on this phone.
            </StatusMessage>
            <IonButton
              className="primary-action"
              expand="block"
              onClick={() => {
                releaseFocus();
                history.replace(session.next, { account: session.account });
              }}
            >
              <IonIcon slot="end" icon={arrowForwardOutline} />
              Continue to setup
            </IonButton>
          </>
        )}

        {state === 'error' && error && (
          <>
            <div className="verification-seal is-error">!</div>
            <div className="sheet-heading centered">
              <span className="sheet-folio">Access / Not confirmed</span>
              <h2>The link can’t be used.</h2>
            </div>
            <StatusMessage kind="error" title="Verification stopped">
              {error.message}
            </StatusMessage>
            <IonButton
              className="primary-action"
              expand="block"
              routerLink="/auth/sign-in"
              routerDirection="back"
            >
              <IonIcon slot="start" icon={refreshOutline} />
              {retryLabel}
            </IonButton>
          </>
        )}
      </div>
    </AuthLayout>
  );
};
