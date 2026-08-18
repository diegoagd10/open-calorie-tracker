import { IonIcon } from '@ionic/react';
import { alertCircleOutline, checkmarkCircleOutline, timeOutline } from 'ionicons/icons';

interface StatusMessageProps {
  children: React.ReactNode;
  kind: 'error' | 'success' | 'info';
  title: string;
}

const icons = {
  error: alertCircleOutline,
  info: timeOutline,
  success: checkmarkCircleOutline,
};

export const StatusMessage = ({ children, kind, title }: StatusMessageProps) => (
  <div className="status-message" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'}>
    <IonIcon icon={icons[kind]} aria-hidden="true" />
    <div>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  </div>
);
