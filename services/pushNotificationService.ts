import { apiClient } from '@/services/api';

interface PushConfiguration {
  publicKey: string;
}

function decodeApplicationServerKey(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export const pushNotificationService = {
  async registerServiceWorker(): Promise<ServiceWorkerRegistration> {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers are not supported in this browser');
    }
    return navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  },

  async requestPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      throw new Error('Notifications are not supported in this browser');
    }
    return Notification.requestPermission();
  },

  async subscribe(
    registration: ServiceWorkerRegistration,
  ): Promise<PushSubscription> {
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) return existingSubscription;

    const { data } = await apiClient.get<PushConfiguration>(
      '/notifications/push/config',
    );
    if (!data?.publicKey) {
      throw new Error('Push notification configuration is unavailable');
    }

    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(data.publicKey),
    });
  },

  async saveSubscription(subscription: PushSubscription): Promise<void> {
    await apiClient.post('/notifications/push/subscriptions',
      subscription.toJSON(),
    );
  },
};
