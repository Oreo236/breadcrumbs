import { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type Profile = {
  id: string;
  display_name: string;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  setDisplayName: (name: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const { data } = await supabase.auth.getSession();
        let currentSession = data.session;

        if (!currentSession) {
          const { data: signInData, error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) throw signInError;
          currentSession = signInData.session;
        }

        if (!mounted) return;
        setSession(currentSession);

        if (currentSession) {
          await loadProfile(currentSession.user.id);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to sign in');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    async function loadProfile(userId: string) {
      const { data } = await supabase.from('profiles').select('id, display_name').eq('id', userId).maybeSingle();
      if (mounted) setProfile(data ?? null);
    }

    init();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) loadProfile(newSession.user.id);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function setDisplayName(name: string) {
    if (!session) throw new Error('Not signed in');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name cannot be empty');

    const { data, error: upsertError } = await supabase
      .from('profiles')
      .upsert({ id: session.user.id, display_name: trimmed })
      .select('id, display_name')
      .single();

    if (upsertError) throw upsertError;
    setProfile(data);
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, error, setDisplayName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
