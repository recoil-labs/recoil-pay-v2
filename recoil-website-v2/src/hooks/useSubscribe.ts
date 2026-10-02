import { useCallback, useState } from 'react';
import { isValidEmail, subscribeEmail } from '../lib/subscribe';

export type MessageType = 'success' | 'error' | '';

export function useSubscribe() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('');
  const [loading, setLoading] = useState(false);

  const handleChange = useCallback((value: string) => {
    setEmail(value);
    setMessage('');
    setMessageType('');
  }, []);

  const handleSubscribe = useCallback(async () => {
    setMessage('');
    setMessageType('');

    if (!email.trim()) {
      setMessage('Please enter your email.');
      setMessageType('error');
      return;
    }
    if (!isValidEmail(email)) {
      setMessage('Please enter a valid email address.');
      setMessageType('error');
      return;
    }

    setLoading(true);
    try {
      const result = await subscribeEmail(email);
      setMessage(result.message);
      setMessageType(result.success ? 'success' : 'error');
      if (result.success) setEmail('');
    } finally {
      setLoading(false);
    }
  }, [email]);

  return { email, message, messageType, loading, handleChange, handleSubscribe } as const;
}
