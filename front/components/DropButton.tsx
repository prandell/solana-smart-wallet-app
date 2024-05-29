'use client';
import axios from 'axios';
import { dropUrl } from '@/utils/urls';
import { useSWRConfig } from 'swr';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { getItemWithExpiry } from '@/utils/localStorage';

interface DropButtonProps {
  setTxHash: Dispatch<SetStateAction<string>>;
}

export function DropButton(props: DropButtonProps) {
  const [dropping, setDropping] = useState(false);
  const { mutate } = useSWRConfig();

  useEffect(() => {
    async function startDrop() {
      if (dropping === true) {
        const res = await axios.post(
          dropUrl(),
          {},
          {
            withCredentials: true,
            headers: { sessionId: getItemWithExpiry('sessionId') },
          }
        );
        if (res.status !== 200) {
          console.error('error while attempting to drop!', res);
          setDropping(false);
        } else {
          setTimeout(() => {
            props.setTxHash(res.data['signature']);
            setDropping(false);
          }, 1500);
        }
      }
    }

    startDrop();
  }, [dropping, mutate, props]);

  //   if (props.dropsLeft == 0) {
  //     return <span>No more drops left! 😭</span>;
  //   }

  //   if (dropping === true) {
  //     return <span>Drop in progress...</span>;
  //   }

  return (
    <button
      type="button"
      onClick={() => {
        setDropping(true);
      }}
      className="flex m-auto rounded-md bg-receive-pill px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:hover:bg-zinc-900 disabled:opacity-75"
    >
      {dropping ? 'Drop in progress...' : 'Give me Wren'}
    </button>
  );
}
