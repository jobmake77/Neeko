import React, { useState, useEffect, ReactNode } from 'react';
import { onLocaleChange } from './i18n';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    return onLocaleChange(() => forceUpdate((n) => n + 1));
  }, []);
  return <>{children}</>;
}
