import type { PropsWithChildren, ReactNode } from 'react';

import {
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { lockClosedOutline } from 'ionicons/icons';

interface AuthLayoutProps extends PropsWithChildren {
  aside?: ReactNode;
  currentStep: 1 | 2 | 3;
  recordLabel: string;
}

const steps = ['Email', 'Verify', 'Setup'];

export const AuthLayout = ({
  aside,
  children,
  currentStep,
  recordLabel,
}: AuthLayoutProps) => (
  <IonPage>
    <IonHeader translucent className="auth-header">
      <IonToolbar>
        <IonTitle>Calorie Tracker</IonTitle>
        <IonButtons slot="end">
          <span className="privacy-mark">
            <IonIcon icon={lockClosedOutline} aria-hidden="true" />
            Private
          </span>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent fullscreen className="auth-content">
      <div className="auth-shell">
        <main className="auth-stage">
          <section
            className="record-context"
            aria-label={`${recordLabel}. Authentication progress`}
          >
            <div className="app-icon" aria-hidden="true">
              <IonIcon icon={lockClosedOutline} />
            </div>
            {aside ?? (
              <div className="context-statement">
                <h1>Your day, kept private.</h1>
                <p>
                  Sign in without a password. We only use your email to verify
                  access to your private record.
                </p>
              </div>
            )}
            <ol className="auth-steps" aria-label="Sign-in progress">
              {steps.map((step, index) => {
                const stepNumber = (index + 1) as 1 | 2 | 3;
                const state =
                  stepNumber < currentStep
                    ? 'complete'
                    : stepNumber === currentStep
                      ? 'current'
                      : 'upcoming';
                return (
                  <li
                    key={step}
                    data-state={state}
                    aria-current={state === 'current' ? 'step' : undefined}
                  >
                    <span className="step-indicator" aria-hidden="true" />
                    <span>{step}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="record-action">{children}</section>
        </main>

        <footer className="app-footer">
          <span>English · Units are chosen after verification</span>
          {import.meta.env.DEV && <a href="/review/auth">Review auth states</a>}
        </footer>
      </div>
    </IonContent>
  </IonPage>
);
