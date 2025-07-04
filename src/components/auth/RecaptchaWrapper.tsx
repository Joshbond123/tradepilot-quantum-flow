
import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

declare global {
  interface Window {
    grecaptcha: any;
  }
}

interface RecaptchaWrapperProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

export const RecaptchaWrapper = ({ onVerify, onExpire }: RecaptchaWrapperProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [widgetId, setWidgetId] = useState<number | null>(null);

  const { data: recaptchaSettings } = useQuery({
    queryKey: ['recaptcha-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recaptcha_settings')
        .select('site_key, is_enabled')
        .single();
      
      if (error || !data?.is_enabled) {
        return { enabled: false };
      }

      return {
        enabled: data.is_enabled,
        siteKey: data.site_key
      };
    },
  });

  useEffect(() => {
    if (!recaptchaSettings?.enabled || !recaptchaSettings?.siteKey) {
      return;
    }

    const loadRecaptcha = () => {
      if (window.grecaptcha) {
        setIsLoaded(true);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        setIsLoaded(true);
      };
      document.head.appendChild(script);
    };

    loadRecaptcha();
  }, [recaptchaSettings]);

  useEffect(() => {
    if (isLoaded && recaptchaSettings?.enabled && recaptchaSettings?.siteKey && window.grecaptcha) {
      const id = window.grecaptcha.render('recaptcha-container', {
        sitekey: recaptchaSettings.siteKey,
        callback: onVerify,
        'expired-callback': onExpire
      });
      setWidgetId(id);
    }
  }, [isLoaded, recaptchaSettings, onVerify, onExpire]);

  if (!recaptchaSettings?.enabled) {
    return null;
  }

  return (
    <div className="flex justify-center my-4">
      <div id="recaptcha-container"></div>
    </div>
  );
};
