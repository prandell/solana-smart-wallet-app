'use client';

import { TurnkeyClient, getWebAuthnAttestation } from '@turnkey/http';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import { useForm } from 'react-hook-form';
import { WebauthnStamper } from '@turnkey/webauthn-stamper';
import {
  authenticateUrl,
  registerUrl,
  registrationStatusUrl,
  whoamiUrl,
} from '@/utils/urls';
import { useAuth } from '@/context/auth.context';
import { setItemWithExpiry } from '@/utils/localStorage';

const DEMO_PASSKEY_WALLET_RPID =
  process.env.NEXT_PUBLIC_DEMO_PASSKEY_WALLET_RPID!;

type authenticationFormData = {
  email: string;
};

// All algorithms can be found here: https://www.iana.org/assignments/cose/cose.xhtml#algorithms
// We only support ES256, which is listed here
const es256 = -7;

// This constant designates the type of credential we want to create.
// The enum only supports one value, "public-key"
// https://www.w3.org/TR/webauthn-2/#enumdef-publickeycredentialtype
const publicKey = 'public-key';

const generateRandomBuffer = (): ArrayBuffer => {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr.buffer;
};

const base64UrlEncode = (challenge: ArrayBuffer): string => {
  return Buffer.from(challenge)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

export default function Home() {
  const [disabledSubmit, setDisabledSubmit] = useState(false);
  const { state } = useAuth();
  const router = useRouter();
  const { mutate } = useSWRConfig();

  const { register: subOrgFormRegister, handleSubmit: subOrgFormSubmit } =
    useForm<authenticationFormData>();

  useEffect(() => {
    if (state.isLoggedIn === true) {
      // Redirect the user to their dashboard if already logged in
      router.push('/');
      return;
    }
  }, [router, state]);

  /**
   * This function looks up whether a given email is registered with our backend already
   * If it is registered, a webauthn "get" ceremony takes place.
   * If it isn't, a webauthn "create" ceremony takes place instead.
   * @param data form data from the authentication form.
   */
  async function registerOrAuthenticate(data: authenticationFormData) {
    setDisabledSubmit(true);

    try {
      const subOrganizationId = await subOrganizationIdForEmail(data.email);

      if (subOrganizationId !== null) {
        await authenticate(subOrganizationId);
      } else {
        await signup(data.email);
      }
    } catch (e: any) {
      const message = `Caught an error: ${e.toString()}`;
      // TODO: convert to proper UI toast / modal
      alert(message);
      console.error(message);
    }

    setDisabledSubmit(false);
  }

  async function subOrganizationIdForEmail(
    email: string
  ): Promise<string | null> {
    const res = await axios.get(registrationStatusUrl(email));

    // If API returns a non-empty 200, this email maps to an existing user.
    if (res.status == 200) {
      return res.data['sub_org_id'];
    } else if (res.status === 204) {
      return null;
    } else {
      throw new Error(
        `Unexpected response from registration status endpoint: ${res.status}: ${res.data}`
      );
    }
  }

  // In order to know whether the user is logged in for `subOrganizationId`, we make them sign
  // a request for Turnkey's "whoami" endpoint.
  // The backend will then forward to Turnkey and get a response on whether the stamp was valid.
  // If this is successful, our backend will issue a logged in session.
  async function authenticate(subOrganizationId: string) {
    const stamper = new WebauthnStamper({
      rpId: process.env.NEXT_PUBLIC_DEMO_PASSKEY_WALLET_RPID!,
    });
    const client = new TurnkeyClient(
      {
        baseUrl: process.env.NEXT_PUBLIC_TURNKEY_API_BASE_URL!,
      },
      stamper
    );

    var signedRequest;
    try {
      signedRequest = await client.stampGetWhoami({
        organizationId: subOrganizationId,
      });
    } catch (e) {
      throw new Error(`Error during webauthn prompt: ${e}`);
    }

    const res = await axios.post(
      authenticateUrl(),
      {
        signedWhoamiRequest: signedRequest,
      },
      { withCredentials: true }
    );

    if (res.status === 200) {
      console.log('Successfully logged in! Redirecting you to dashboard');
      setItemWithExpiry('sessionId', res.data.sessionId, 1000 * 60 * 60 * 1)
      mutate(whoamiUrl());
      router.push('/');
      return;
    } else {
      throw new Error(
        `Unexpected response from authentication endpoint: ${res.status}: ${res.data}`
      );
    }
  }

  /**
   * This signup function triggers a webauthn "create" ceremony and POSTs the resulting attestation to the backend
   * The backend uses Turnkey to create a brand new sub-organization with a new private key.
   * @param email user email
   */
  async function signup(email: string) {
    const challenge = generateRandomBuffer();
    const authenticatorUserId = generateRandomBuffer();

    // An example of possible options can be found here:
    // https://www.w3.org/TR/webauthn-2/#sctn-sample-registration
    const attestation = await getWebAuthnAttestation({
      publicKey: {
        rp: {
          id: DEMO_PASSKEY_WALLET_RPID,
          name: 'Demo Passkey Wallet',
        },
        challenge,
        pubKeyCredParams: [
          {
            type: publicKey,
            alg: es256,
          },
        ],
        user: {
          id: authenticatorUserId,
          name: email,
          displayName: email,
        },
        authenticatorSelection: {
          requireResidentKey: true,
          residentKey: 'required',
          userVerification: 'preferred',
        },
      },
    });

    const res = await axios.post(
      registerUrl(),
      {
        email: email,
        attestation,
        challenge: base64UrlEncode(challenge),
      },
      { withCredentials: true }
    );

    if (res.status === 200) {
      console.log('Successfully registered! Redirecting you to dashboard');
      setItemWithExpiry('sessionId', res.data.sessionId, 1000 * 60 * 60 * 1)
      mutate(whoamiUrl());
      router.push('/');
      return;
    } else {
      throw new Error(
        `Unexpected response from registration endpoint: ${res.status}: ${res.data}`
      );
    }
  }
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
      <div className="z-10 w-full max-w-md overflow-hidden rounded-2xl border border-gray-100 shadow-xl">
        <div className="flex flex-col items-center justify-center space-y-3 border-b border-gray-200 bg-white px-4 py-6 pt-8 text-center sm:px-16">
          <h3 className="text-xl font-semibold">Sign up</h3>
          <p className="text-sm text-gray-500">Create an account</p>
        </div>
        <form
          action="#"
          method="POST"
          onSubmit={subOrgFormSubmit(registerOrAuthenticate)}
          className="flex flex-col space-y-4 bg-gray-50 px-4 py-8 sm:px-16"
        >
          <div>
            <label
              htmlFor="email"
              className="block text-xs text-gray-600 uppercase"
            >
              Email Address
            </label>
            <input
              {...subOrgFormRegister('email')}
              disabled={disabledSubmit}
              id="email"
              name="email"
              type="email"
              placeholder="someone@labeleven.dev"
              autoComplete="email"
              required
              className="mt-1 block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-black focus:outline-none focus:ring-black sm:text-sm"
            />
          </div>
          <button
            type="submit"
            aria-disabled={disabledSubmit}
            disabled={disabledSubmit}
            className="flex h-10 w-full items-center justify-center rounded-md border text-sm transition-all focus:outline-none"
          >
            Authenticate with Passkey
            <span aria-live="polite" className="sr-only" role="status">
              Loading...
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
