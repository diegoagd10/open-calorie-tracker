import { useEffect } from 'react';

import { IonContent, IonPage, IonSpinner } from '@ionic/react';
import { useHistory } from 'react-router-dom';

import { getSession } from '../api/auth';

export const SessionLandingPage = () => {
  const history = useHistory();

  useEffect(() => {
    getSession()
      .then((session) => history.replace(session.next, { account: session.account }))
      .catch(() => history.replace('/auth/sign-in'));
  }, [history]);

  return (
    <IonPage>
      <IonContent fullscreen className="auth-content">
        <div className="session-landing" role="status" aria-live="polite">
          <IonSpinner name="crescent" />
          <span>Opening Calorie Tracker…</span>
        </div>
      </IonContent>
    </IonPage>
  );
};
