'use client';

import { useEffect } from 'react';

const hasthkalaLookbookUrl =
  'https://heyzine.com/flip-book/2a2d77de0e.html';

export default function HasthkalaLookbookPage() {
  const openLookbook = () => {
    window.location.replace(hasthkalaLookbookUrl);
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.location.replace(hasthkalaLookbookUrl);
    }, 4400);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <main className="hasthkala-intro relative flex min-h-screen items-center justify-center overflow-hidden bg-black px-6 text-center text-white">
      <div className="pointer-events-none absolute inset-8 border border-white/[0.12] md:inset-12" />
      <div className="pointer-events-none absolute left-1/2 top-8 h-16 w-px bg-gradient-to-b from-white/40 to-transparent md:top-12" />

      <div className="relative z-10 flex w-full max-w-6xl flex-col items-center">
        <p className="intro-label text-[0.58rem] uppercase tracking-[0.55em] text-white/55 md:text-[0.65rem]">
          RK Lookbook / 01
        </p>
        <div className="intro-rule mt-8 h-px w-20 bg-white/45 md:mt-10" />
        <h1 className="intro-title mt-8 max-w-6xl font-aakaar text-[clamp(3.2rem,9vw,8.5rem)] leading-[0.9] tracking-[0.025em] text-white md:mt-10">
          Welcome to the world of
          <span className="mt-3 block text-[1.08em] italic tracking-[0.01em] text-white/90 md:mt-5">
            Hasthkala
          </span>
        </h1>
        <div className="intro-details mt-10 flex flex-col items-center gap-5 md:mt-14">
          <p className="text-[0.6rem] uppercase tracking-[0.5em] text-white/55">
            Opening lookbook
          </p>
          <button
            type="button"
            onClick={openLookbook}
            className="group border border-white/35 px-7 py-3.5 text-[0.62rem] uppercase tracking-[0.35em] text-white/75 transition duration-500 hover:border-white hover:bg-white hover:text-black"
          >
            <span className="transition-transform duration-500 group-hover:inline-block group-hover:translate-x-1">
              Enter lookbook <span aria-hidden="true">→</span>
            </span>
          </button>
        </div>
      </div>

      <style jsx>{`
        .hasthkala-intro {
          animation: intro-exit 4.2s cubic-bezier(0.76, 0, 0.24, 1) forwards;
          background-image: radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.07), transparent 34%);
        }

        .intro-label,
        .intro-rule,
        .intro-title,
        .intro-details {
          opacity: 0;
          transform: translateY(24px);
        }

        .intro-label {
          animation: reveal 0.9s 0.15s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .intro-rule {
          animation: reveal-rule 1s 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .intro-title {
          animation: reveal 1.2s 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .intro-details {
          animation: reveal 1s 1.05s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        @keyframes reveal {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes reveal-rule {
          from {
            opacity: 0;
            transform: scaleX(0);
          }
          to {
            opacity: 1;
            transform: scaleX(1);
          }
        }

        @keyframes intro-exit {
          0%, 76% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .hasthkala-intro,
          .intro-label,
          .intro-rule,
          .intro-title,
          .intro-details {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </main>
  );
}
