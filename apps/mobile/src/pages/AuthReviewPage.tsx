import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  linkOutline,
  mailOutline,
} from 'ionicons/icons';

const reviewStates = [
  {
    icon: mailOutline,
    label: 'Start',
    title: 'Email entry',
    note: 'Default passwordless sign-in and validation.',
    href: '/auth/sign-in',
  },
  {
    icon: alertCircleOutline,
    label: 'Failure',
    title: 'Delivery unavailable',
    note: 'Enter delivery-failure@example.com to keep the resend action visible.',
    href: '/auth/sign-in',
  },
  {
    icon: linkOutline,
    label: 'Expired',
    title: 'Expired magic link',
    note: 'Terminal link state with a clear recovery action.',
    href: '/auth/verify?preview=expired',
  },
  {
    icon: linkOutline,
    label: 'Used',
    title: 'Replayed magic link',
    note: 'Single-use protection after a successful exchange.',
    href: '/auth/verify?preview=used',
  },
  {
    icon: linkOutline,
    label: 'Replaced',
    title: 'Superseded magic link',
    note: 'Directs the user to the newest email after resend.',
    href: '/auth/verify?preview=superseded',
  },
  {
    icon: checkmarkCircleOutline,
    label: 'Success',
    title: 'Verified session',
    note: 'Reached through the generated prototype link on the check-email screen.',
    href: '/auth/sign-in',
  },
];

export const AuthReviewPage = () => (
  <IonPage>
    <IonContent fullscreen className="review-content">
      <main className="review-shell">
        <header className="review-heading">
          <a className="wordmark" href="/auth/sign-in">Calorie Tracker</a>
          <h1>Authentication state index</h1>
          <p>Six focused states derived from the approved passwordless flow. Open any row to review it at phone or desktop width.</p>
        </header>
        <div className="review-list">
          {reviewStates.map((state) => (
            <a href={state.href} key={`${state.label}-${state.title}`} className="review-row">
              <IonIcon icon={state.icon} aria-hidden="true" />
              <span className="review-label">{state.label}</span>
              <span className="review-copy"><strong>{state.title}</strong><small>{state.note}</small></span>
              <span className="review-open">Open</span>
            </a>
          ))}
        </div>
        <footer className="review-footer">
          <span>Scope: authentication only</span>
          <a href="/auth/sign-in">Return to sign in</a>
        </footer>
      </main>
    </IonContent>
  </IonPage>
);
