'use client';

import axios from 'axios';
import {
  Dispatch,
  SetStateAction,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import { whoamiUrl } from '@/utils/urls';
import useSWR from 'swr';
import { getItemWithExpiry } from '@/utils/localStorage';
import { User } from '@/models';

type AuthState = {
  isLoaded: boolean;
  isLoggedIn: boolean;
  email: string | null;
  userId: number | null;
  subOrganizationId: string | null;
};

const initialState: AuthState = {
  isLoaded: false,
  isLoggedIn: false,
  email: null,
  userId: null,
  subOrganizationId: null,
};

async function authStateFetcher(url: string): Promise<AuthState> {
  let response = await axios.get<User>(url, {
    withCredentials: true,
    headers: { sessionId: getItemWithExpiry('sessionId') },
  });
  if (response.status === 200) {
    return {
      isLoaded: true,
      isLoggedIn: true,
      email: response.data.email,
      userId: response.data.userId,
      subOrganizationId: response.data.subOrgId,
    };
  } else if (response.status === 204) {
    // A 204 indicates "no current user"
    return {
      isLoaded: true,
      isLoggedIn: false,
      email: response.data.email,
      userId: response.data.userId,
      subOrganizationId: response.data.subOrgId,
    };
  } else {
    // Other status codes indicate an error of some sort
    return initialState;
  }
}

export const AuthContext = createContext<{
  state: AuthState;
  setState: Dispatch<SetStateAction<AuthState>>;
}>({
  state: initialState,
  setState: function (value: SetStateAction<AuthState>): void {
    throw new Error('Function not implemented.');
  },
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState(initialState);

  const { data, error } = useSWR(whoamiUrl(), authStateFetcher);
  if (error) {
    console.error('error while loading auth status!', error);
  }

  useEffect(() => {
    if (data !== undefined) {
      setState(data);

      if (!data.isLoggedIn) {
        // If user is not logged in, we want to make sure localStorage is clear of any auth bundle
        window.localStorage.removeItem('sessionId');
      }
    }
  }, [data]);

  return (
    <AuthContext.Provider
      value={{
        state,
        setState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export const AuthConsumer = AuthContext.Consumer;
