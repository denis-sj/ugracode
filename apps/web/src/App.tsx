import type { MetaResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { ApiDownScreen, SplashScreen } from './screens/ApiDownScreen';
import { LoginScreen } from './screens/LoginScreen';
import { SessionProvider, useSession } from './session';
import { AppShell } from './shell/AppShell';

type MetaState =
  | { status: 'loading' }
  | { status: 'ok'; meta: MetaResponse }
  | { status: 'error'; message: string };

function Root({ metaState, onRetry }: { metaState: MetaState; onRetry: () => void }): JSX.Element {
  const session = useSession();

  if (metaState.status === 'error') {
    return <ApiDownScreen message={metaState.message} onRetry={onRetry} />;
  }

  if (metaState.status === 'loading' || session.loading) {
    return <SplashScreen />;
  }

  if (!session.user) {
    return <LoginScreen meta={metaState.meta} />;
  }

  return <AppShell user={session.user} meta={metaState.meta} onSignOut={session.signOut} />;
}

export function App(): JSX.Element {
  const [metaState, setMetaState] = useState<MetaState>({ status: 'loading' });

  const loadMeta = useCallback((): void => {
    setMetaState({ status: 'loading' });
    api
      .meta()
      .then((meta) => setMetaState({ status: 'ok', meta }))
      .catch((cause: unknown) =>
        setMetaState({
          status: 'error',
          message: cause instanceof ApiError ? cause.message : 'Не удалось загрузить метаданные',
        }),
      );
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  return (
    <SessionProvider>
      <Root metaState={metaState} onRetry={loadMeta} />
    </SessionProvider>
  );
}
