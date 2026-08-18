import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route } from 'react-router-dom';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/display.css';
import '@ionic/react/css/palettes/dark.always.css';

import { AuthReviewPage } from './pages/AuthReviewPage';
import { CheckEmailPage } from './pages/CheckEmailPage';
import { SetupGatePage } from './pages/SetupGatePage';
import { SignInPage } from './pages/SignInPage';
import { SessionLandingPage } from './pages/SessionLandingPage';
import { VerifyPage } from './pages/VerifyPage';
import './theme/variables.css';
import './theme/app.css';

setupIonicReact({ mode: 'ios' });

export const App = () => (
  <IonApp>
    <IonReactRouter>
      <IonRouterOutlet>
        <Route exact path="/auth/sign-in" component={SignInPage} />
        <Route exact path="/auth/check-email" component={CheckEmailPage} />
        <Route exact path="/auth/verify" component={VerifyPage} />
        <Route exact path="/setup" component={SetupGatePage} />
        <Route exact path="/review/auth" component={AuthReviewPage} />
        <Route exact path="/" component={SessionLandingPage} />
      </IonRouterOutlet>
    </IonReactRouter>
  </IonApp>
);
