import { useState, useEffect } from 'react';

function App(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(console.error);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Video Cataloger</h1>
        {appVersion && <span className="version">v{appVersion}</span>}
      </header>
      <main className="app-main">
        <p>Welcome to AI Video Cataloger</p>
        <p className="platform">Running on {window.electronAPI?.platform ?? 'unknown platform'}</p>
      </main>
    </div>
  );
}

export default App;
