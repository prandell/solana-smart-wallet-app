'use client';

import Image from 'next/image';
import { useAuth } from '@/context/auth.context';
import { constructTxUrl, getWalletUrl, sendTxUrl } from '@/utils/urls';
import { WebauthnStamper } from '@turnkey/webauthn-stamper';
import { IframeStamper } from '@turnkey/iframe-stamper';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import useSWR from 'swr';
import { TurnkeyClient } from '@turnkey/http';
import { getItemWithExpiry } from '@/utils/localStorage';
import { TurnkeySigner } from '@turnkey/solana';
import { DropButton } from '@/components/DropButton';
import { AlertBanner } from '@/components/AlertBanner';
import { VersionedTransaction } from '@solana/web3.js';
import { WalletWithBalance } from '@/models';
import { AuthWidget } from '@/components/AuthWidget';

type Stamper = IframeStamper | WebauthnStamper;

type sendFormData = {
  destination: string;
  amount: string;
};

async function walletFetcher(
  url: string
): Promise<{ data: null | WalletWithBalance }> {
  if (!getItemWithExpiry('sessionId')) {
    return {
      data: null,
    };
  }
  let response = await axios.get(url, {
    withCredentials: true,
    headers: { sessionId: getItemWithExpiry('sessionId') },
  });
  if (response.status === 200) {
    return {
      data: response.data,
    };
  } else {
    // Other status codes indicate an error of some sort
    return {
      data: null,
    };
  }
}

export default function Dashboard() {
  const { state } = useAuth();
  const [disabledSend, setDisabledSend] = useState(false);
  const [txHash, setTxHash] = useState('');

  const router = useRouter();
  const { register: sendFormRegister, handleSubmit: sendFormSubmit } =
    useForm<sendFormData>();

  const { data: key, error: keyError } = useSWR(getWalletUrl(), walletFetcher, {
    refreshInterval: 5000,
  });

  useEffect(() => {
    if (state.isLoaded === true && state.isLoggedIn === false) {
      // Redirect the user to auth if not logged in
      router.push('/auth');
      return;
    }
  }, [state, router]);

  useEffect(() => {
    if (key && key.data && key.data.solBalance === '0.00') {
      setDisabledSend(true);
    } else {
      setDisabledSend(false);
    }
  }, [key, setDisabledSend]);

  async function constructTransaction(data: sendFormData) {
    const constructRes = await axios.post(
      constructTxUrl(),
      {
        amount: data.amount,
        destination: data.destination,
      },
      {
        withCredentials: true,
        headers: { sessionId: getItemWithExpiry('sessionId') },
      }
    );

    if (constructRes.status !== 200) {
      throw new Error(
        `Unexpected response from tx construction endpoint: ${constructRes.status}: ${constructRes.data}`
      );
    }

    const { unsignedTransaction, subOrgId } = constructRes.data;
    return {
      txn: VersionedTransaction.deserialize(
        Buffer.from(unsignedTransaction, 'base64')
      ),
      organisationId: subOrgId,
    };
  }

  async function sendTransaction(
    stamper: Stamper,
    txData: { txn: VersionedTransaction; organisationId: string },
    data: sendFormData
  ) {
    const client = new TurnkeyClient(
      {
        baseUrl: process.env.NEXT_PUBLIC_TURNKEY_API_BASE_URL!,
      },
      stamper
    );

    const signer = new TurnkeySigner({
      organizationId: txData.organisationId,
      client,
    });

    if (key && key.data?.solAddress) {
      await signer.addSignature(txData.txn, key.data.solAddress);

      const sendRes = await axios.post(
        sendTxUrl(),
        {
          signedSendTx: Buffer.from(txData.txn.serialize()).toString('base64'),
        },
        {
          withCredentials: true,
          headers: { sessionId: getItemWithExpiry('sessionId') },
        }
      );

      if (sendRes.status === 200) {
        console.log('Successfully sent! Hash', sendRes.data['hash']);
        // setTxHash(sendRes.data['hash']);
      } else {
        throw new Error(
          `Unexpected response when submitting signed transaction: ${sendRes.status}: ${sendRes.data}`
        );
      }
    }

    return;
  }

  async function getCurrentStamper(): Promise<Stamper> {
    console.log('Using passkey stamper');

    return new WebauthnStamper({
      rpId: process.env.NEXT_PUBLIC_DEMO_PASSKEY_WALLET_RPID!,
    });
  }

  // When a user attempts a send, we will first check if they are logged in with email auth
  // (if the credential is valid via whoami check). Else, use passkey.
  async function sendFormHandler(formData: sendFormData) {
    setDisabledSend(true);
    try {
      const constructedTx = await constructTransaction(formData);
      console.log(constructedTx);
      const stamper = await getCurrentStamper();
      await sendTransaction(stamper, constructedTx, formData);
    } catch (e: any) {
      const msg = `Caught error: ${e.toString()}`;
      console.error(msg);
      alert(msg);
    }

    setDisabledSend(false);
  }

  if (keyError) {
    console.error('failed to load wallet information:', keyError);
  }

  return (
    <div>
      <div>
        <AuthWidget />
      </div>
      <div className="max-w-5xl mx-auto">
        <AlertBanner txHash={txHash} setTxHash={setTxHash}></AlertBanner>
        <section className="lg:bg-subtle-accent p-8 lg:mt-16 lg:border border-zinc-300 divide-y divide-zinc-300">
          <div className="grid grid-cols-5 gap-8 mb-8">
            <div className="col-span-5 lg:col-span-2">
              <h3 className="text-3xl font-medium favorit mb-4">Your wallet</h3>
              <p className="text-destructive-red text-sm mt-1">
                Your wallet contains two accounts, an Ethereum and Solana
                account (both on Devnet&apos;s)
              </p>
            </div>

            <div className="col-span-5 lg:col-span-3 sm:col-span-5">
              <div className="mb-4">
                <span className="font-semibold mr-2">Sol Address:</span>
                <span className="font-mono">{key && key.data?.solAddress}</span>
                <br />
                {key ? (
                  <Link
                    className="text-indigo-600 cursor-pointer underline"
                    target="_blank"
                    href={
                      'https://explorer.solana.com/address/' +
                      key.data?.solAddress +
                      '?cluster=devnet'
                    }
                  >
                    View on Solana Explorer{' '}
                    <Image
                      className={`inline-block`}
                      src="/arrow.svg"
                      alt="->"
                      width={20}
                      height={20}
                      priority
                    />
                  </Link>
                ) : null}
              </div>
              <div className="mb-4">
                <span className="font-semibold mr-2">Eth Address:</span>
                <span className="font-mono">{key && key.data?.ethAddress}</span>
                <br />
                {key ? (
                  <Link
                    className="text-indigo-600 cursor-pointer underline"
                    target="_blank"
                    href={
                      'https://sepolia.etherscan.io/address/' +
                      key.data?.ethAddress
                    }
                  >
                    View on Etherscan{' '}
                    <Image
                      className={`inline-block`}
                      src="/arrow.svg"
                      alt="->"
                      width={20}
                      height={20}
                      priority
                    />
                  </Link>
                ) : null}
              </div>
              <p>
                <span className="font-semibold mr-2">Balance:</span>
                <span className="font-mono">
                  {key ? key.data?.solBalance ?? '_ . __' : '_ . __'} Sol
                </span>
                <br />
              </p>
            </div>
          </div>

          <form
            action="#"
            method="POST"
            onSubmit={sendFormSubmit(sendFormHandler)}
          >
            <div className="grid grid-cols-5 gap-8 my-8">
              <div className="col-span-5 lg:col-span-2">
                <h3 className="text-3xl font-medium favorit mb-4">
                  Wren Token Account
                </h3>
                <p className="text-sm mt-1">
                  Click the button to receieve some Wren token, or enter an
                  address and send some to a friend
                </p>
              </div>

              <div className="col-span-5 lg:col-span-3 sm:col-span-5">
                <div className="mb-4">
                  <span className="font-semibold mr-2">Wren Address:</span>
                  <span className="font-mono">
                    {key && key.data?.wrenAddress}
                  </span>
                  <br />
                  {key ? (
                    <Link
                      className="text-indigo-600 cursor-pointer underline"
                      target="_blank"
                      href={
                        'https://explorer.solana.com/address/' +
                        key.data?.wrenAddress +
                        '?cluster=devnet'
                      }
                    >
                      View on Solana Explorer{' '}
                      <Image
                        className={`inline-block`}
                        src="/arrow.svg"
                        alt="->"
                        width={20}
                        height={20}
                        priority
                      />
                    </Link>
                  ) : null}
                </div>
                <div className="flex flex-row">
                  <p className="items-center text-center justify-center flex">
                    <span className="font-semibold mr-2">Balance:</span>
                    <span className="font-mono">
                      {key ? key.data?.wrenBalance ?? '_ . __' : '_ . __'} Wren
                    </span>
                    <br />
                  </p>
                  <DropButton setTxHash={setTxHash} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-8">
              <div className="col-span-5 lg:col-span-2">
                <h3 className="text-3xl font-medium favorit mb-4">Address</h3>
                <p className="text-sm">Address to send some Wren to.</p>
              </div>

              <div className="col-span-5 lg:col-span-3 rounded-sm font-mono">
                <input
                  {...sendFormRegister('destination')}
                  defaultValue="C23n62b7urvmV3CfizXPsErcSNNvk1XGhCXQxtuVKbLP"
                  id="destination"
                  name="destination"
                  type="text"
                  required
                  className="block w-full px-3 rounded-md border-0 py-3 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-zinc-900 disabled:opacity-75 disabled:text-zinc-400"
                />
              </div>

              <div className="col-span-5 lg:col-span-2">
                {' '}
                <h3 className="text-3xl font-medium favorit mb-4">Amount</h3>
                <p className="text-sm">How much to send.</p>
              </div>

              <div className="col-span-5 lg:col-span-3 rounded-sm flex h-fit">
                <input
                  {...sendFormRegister('amount')}
                  defaultValue="0.02"
                  id="amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  className="block px-3 flex-1 rounded-md border-0 py-3 font-mono text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-zinc-900 disabled:opacity-75 disabled:text-zinc-400"
                />
                <button
                  type="submit"
                  disabled={disabledSend}
                  className="block flex-none ml-1 rounded-md bg-send-pill px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:hover:bg-zinc-900 disabled:opacity-75"
                >
                  Send
                </button>
              </div>
            </div>
          </form>
        </section>

        <div className="text-zinc-500 text-center mt-12 mb-12">
          {state.subOrganizationId ? (
            <p className="text-sm">
              Turnkey Sub-Organization ID: {state.subOrganizationId}.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
