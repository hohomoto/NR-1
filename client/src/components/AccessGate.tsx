import { useState } from 'react';
import { useNR1Store } from '../store/useNR1Store';

// Shown on deployments that set NR1_ACCESS_CODE, so the shared Anthropic key
// is only spent by people who were given the code.
export function AccessGate() {
  const serverConfigLoaded = useNR1Store((s) => s.serverConfigLoaded);
  const accessRequired     = useNR1Store((s) => s.accessRequired);
  const accessGranted      = useNR1Store((s) => s.accessGranted);
  const analyzeConfigured  = useNR1Store((s) => s.analyzeConfigured);
  const submitAccessCode   = useNR1Store((s) => s.submitAccessCode);

  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!serverConfigLoaded) return null;

  if (!analyzeConfigured) {
    return (
      <div className="bg-amber-dim/40 border-b border-amber/30 px-4 py-1.5 font-mono text-xs text-amber shrink-0">
        Analysis is not configured on this deployment yet — the dashboard is view-only.
      </div>
    );
  }

  if (!accessRequired || accessGranted) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setChecking(true);
    setError(null);
    const ok = await submitAccessCode(code.trim());
    setChecking(false);
    if (!ok) setError('That code was not accepted.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-panel border border-border-bright p-5 flex flex-col gap-3"
      >
        <div className="font-mono text-amber font-bold text-lg tracking-wide">NR-1</div>
        <p className="text-sm text-text-muted">
          Enter the access code you were given to run analyses.
        </p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          aria-label="Access code"
          className="bg-background border border-border p-2 text-sm font-mono text-text-primary placeholder:text-text-dim focus:outline-none focus:border-border-bright"
        />
        {error && <div className="text-xs font-mono text-red">{error}</div>}
        <button
          type="submit"
          disabled={checking || !code.trim()}
          className="bg-amber text-background font-mono font-semibold text-sm py-2 disabled:opacity-40"
        >
          {checking ? 'CHECKING…' : 'ENTER'}
        </button>
      </form>
    </div>
  );
}
