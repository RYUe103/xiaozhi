import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';

const SocialButton = ({ id, enabled, serverDomain, oauthPath, Icon, label }) => {
  if (!enabled) {
    return null;
  }

  return (
    <div className="mt-2 flex gap-x-2">
      <a
        aria-label={`${label}`}
        className="group flex h-12 w-full items-center justify-between rounded-2xl bg-emerald-950 px-4 text-white shadow-sm transition-colors duration-200 hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        href={`${serverDomain}/oauth/${oauthPath}`}
        data-testid={id}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="bg-white/12 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
            {id === 'openid' ? <ShieldCheck className="h-5 w-5" /> : <Icon />}
          </span>
          <span className="truncate text-sm font-medium">{label}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </a>
    </div>
  );
};

export default SocialButton;
