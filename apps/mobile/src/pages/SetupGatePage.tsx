import { useEffect, useState } from 'react';

import { IonButton, IonIcon, IonSpinner } from '@ionic/react';
import { arrowForwardOutline, logOutOutline } from 'ionicons/icons';
import { useHistory, useLocation } from 'react-router-dom';

import { type Account, getSession, signOut } from '../api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { StatusMessage } from '../components/StatusMessage';
import { releaseFocus } from '../utils/navigation';

export const SetupGatePage = () => {
  const history = useHistory();
  const location = useLocation<{ account?: Account }>();
  const [account, setAccount] = useState<Account | undefined>(location.state?.account);
  const [isLoading, setIsLoading] = useState(!location.state?.account);

  useEffect(() => {
    if (account) return;
    getSession()
      .then((session) => setAccount(session.account))
      .catch(() => history.replace('/auth/sign-in'))
      .finally(() => setIsLoading(false));
  }, [account, history]);

  const leave = async () => {
    await signOut();
    releaseFocus();
    history.replace('/auth/sign-in');
  };

  return (
    <AuthLayout
      currentStep={3}
      recordLabel="Setup gate"
      aside={
        <div className="context-statement compact">
          <h1>Access is complete.</h1>
          <p>The next step defines units and goals. No personal health profile is required.</p>
        </div>
      }
    >
      <div className="action-sheet">
        {isLoading ? (
          <div className="loading-block"><IonSpinner name="crescent" /> Loading your session…</div>
        ) : (
          <>
            <div className="sheet-heading">
              <span className="sheet-folio">Handoff / Setup</span>
              <h2>Your private account is ready.</h2>
              <p>This authentication mock stops at the approved first-time setup gate.</p>
            </div>
            {account && (
              <StatusMessage kind="success" title="Verified email">
                {account.email}
              </StatusMessage>
            )}
            <div className="setup-preview">
              <div><span>Next</span><strong>Choose US or metric</strong></div>
              <div><span>Then</span><strong>Set daily goals</strong></div>
            </div>
            <IonButton className="primary-action" expand="block" disabled>
              <IonIcon slot="end" icon={arrowForwardOutline} />
              Setup is outside this mock
            </IonButton>
            <IonButton className="secondary-action" fill="clear" onClick={leave}>
              <IonIcon slot="start" icon={logOutOutline} />
              Sign out on this phone
            </IonButton>
          </>
        )}
      </div>
    </AuthLayout>
  );
};
