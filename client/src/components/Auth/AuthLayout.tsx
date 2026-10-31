import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import {
  BadgeCheck,
  Building2,
  Database,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import { Banner } from '../Banners';
import Footer from './Footer';

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>
        </div>
      );
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>
            {localize('com_auth_error_invalid_reset_token')}{' '}
            <a className="font-semibold text-green-600 hover:underline" href="/forgot-password">
              {localize('com_auth_click_here')}
            </a>{' '}
            {localize('com_auth_to_try_again')}
          </ErrorMessage>
        </div>
      );
    } else if (error != null && error) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize(error)}</ErrorMessage>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-[#f4f7f5] text-slate-950 dark:bg-gray-950 dark:text-white">
      <Banner />
      <DisplayError />
      <div className="absolute right-4 top-4 z-10">
        <ThemeSelector returnThemeOnly />
      </div>

      <main className="flex flex-grow items-stretch justify-center px-4 py-6 md:px-8 md:py-10">
        <div className="grid min-h-[720px] w-full max-w-6xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.10)] dark:border-gray-800 dark:bg-gray-900 lg:grid-cols-[1.08fr_0.92fr]">
          <section className="relative hidden bg-[#0f2f2c] px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(96,165,250,0.22),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(52,211,153,0.20),transparent_30%)]" />
            <div className="relative">
              <div className="flex items-center gap-3">
                <div className="bg-white/12 flex h-11 w-11 items-center justify-center rounded-xl">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-lg font-semibold">三所小智</div>
                  <div className="text-xs text-emerald-100/80">Enterprise AI Assistant</div>
                </div>
              </div>

              <div className="mt-20 max-w-xl">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm text-emerald-50">
                  <ShieldCheck className="h-4 w-4" />
                  三所小智欢迎您
                </div>
                <h2 className="text-5xl font-semibold leading-tight tracking-normal">
                  三所小智
                  <br />
                  欢迎您
                </h2>
                <p className="mt-5 max-w-md text-base leading-7 text-emerald-50/80">
                  面向内部知识、文件处理、视觉理解和长期记忆的一体化 AI 工作入口。
                </p>
              </div>
            </div>

            <div className="relative grid grid-cols-3 gap-3">
              <div className="border-white/12 rounded-2xl border bg-white/10 p-4">
                <LockKeyhole className="mb-3 h-5 w-5 text-emerald-200" />
                <div className="text-sm font-medium">统一身份</div>
                <div className="mt-1 text-xs text-emerald-50/65">SSO 登录</div>
              </div>
              <div className="border-white/12 rounded-2xl border bg-white/10 p-4">
                <MessageSquareText className="mb-3 h-5 w-5 text-sky-200" />
                <div className="text-sm font-medium">稳定会话</div>
                <div className="mt-1 text-xs text-emerald-50/65">中文助手</div>
              </div>
              <div className="border-white/12 rounded-2xl border bg-white/10 p-4">
                <Database className="mb-3 h-5 w-5 text-amber-100" />
                <div className="text-sm font-medium">文件能力</div>
                <div className="mt-1 text-xs text-emerald-50/65">Sandbox</div>
              </div>
            </div>
          </section>

          <section className="flex flex-col justify-center px-6 py-8 sm:px-12 lg:px-14">
            <div className="mx-auto w-full max-w-[430px]">
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-950 text-white">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-lg font-semibold">三所小智</div>
                  <div className="text-xs text-slate-500 dark:text-gray-400">
                    Enterprise AI Assistant
                  </div>
                </div>
              </div>

              {!hasStartupConfigError && !isFetching && header && (
                <div className="mb-7">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                    <BadgeCheck className="h-4 w-4" />
                    三所小智
                  </div>
                  <h1
                    className="text-3xl font-semibold tracking-normal text-slate-950 dark:text-white"
                    style={{ userSelect: 'none' }}
                  >
                    {header}
                  </h1>
                </div>
              )}

              {children}
            </div>
          </section>
        </div>
      </main>
      <Footer startupConfig={startupConfig} />
    </div>
  );
}

export default AuthLayout;
