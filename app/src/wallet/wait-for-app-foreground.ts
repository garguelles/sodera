import { AppState } from 'react-native';

export function waitForAppForeground(): Promise<boolean> {
  if (AppState.currentState === 'active') return Promise.resolve(true);

  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    let subscription: ReturnType<typeof AppState.addEventListener>;
    const finish = (isForeground: boolean) => {
      clearTimeout(timeout);
      subscription.remove();
      resolve(isForeground);
    };

    subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish(true);
    });
    timeout = setTimeout(() => finish(false), 1000);

    if (AppState.currentState === 'active') finish(true);
  });
}
