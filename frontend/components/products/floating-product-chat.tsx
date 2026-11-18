"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";

export function FloatingProductChat({ href, hidden = false }: { href: string; hidden?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const [clear, setClear] = useState(false);
  const [promptClear, setPromptClear] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visible = Boolean(href) && clear && !hidden;
  const promptVisible = visible && promptClear && (hovered || focused);
  const closePrompt = () => { setHovered(false); setFocused(false); };

  useEffect(() => {
    if (!href) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const obstacles = Array.from(document.querySelectorAll<HTMLElement>(
        // Normal page content must never hide the launcher while scrolling.
        // Only other explicitly floating controls can be genuine collisions.
        '.theme-toggle',
      )).filter(element => !element.closest("[data-product-chat-widget]"));
      const fits = (area: DOMRect) => area.top >= 8 && area.left >= 8 && !obstacles.some(element => {
        const other = element.getBoundingClientRect();
        return other.width > 0 && other.height > 0 && area.left < other.right + 8 && area.right > other.left - 8 && area.top < other.bottom + 8 && area.bottom > other.top - 8;
      });
      const modalOpen = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
      setClear(fits(rect) && !modalOpen);
      const promptRect = promptRef.current?.getBoundingClientRect();
      setPromptClear(Boolean(promptRect && fits(promptRect) && !modalOpen));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [href]);

  if (!href) return null;
  return <div data-product-chat-widget
    onPointerEnter={event => { if (event.pointerType === "mouse" && window.matchMedia("(hover: hover)").matches) setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onFocusCapture={event => setFocused(event.target.matches(":focus-visible"))}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    onKeyDown={event => { if (event.key === "Escape" && promptVisible) { event.preventDefault(); ref.current?.focus(); closePrompt(); } }}
    className={`fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] right-[calc(1rem+env(safe-area-inset-right,0px))] z-40 h-11 w-11 ${visible ? "pointer-events-auto" : "pointer-events-none"}`}>
    <a ref={ref} data-product-floating-chat href={href} target="_blank" rel="noopener noreferrer" onClick={closePrompt}
    aria-label="Chat with us on WhatsApp about this product" aria-describedby={promptVisible ? "product-chat-size-prompt" : undefined}
    aria-hidden={!visible} tabIndex={visible ? 0 : -1}
    className={`flex h-11 w-11 items-center justify-center rounded-full border border-charcoal/15 bg-ivory text-charcoal/80 shadow-sm transition-colors hover:border-gold/60 hover:bg-sand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${visible ? "visible" : "invisible pointer-events-none"}`}>
    <MessageCircle aria-hidden="true" size={19} strokeWidth={1.3} />
  </a>
    <div ref={promptRef} role="group" aria-label="Size assistance prompt" aria-hidden={!promptVisible}
      className={`absolute bottom-full right-0 mb-3 after:absolute after:inset-x-0 after:top-full after:h-3 after:content-[''] flex w-60 max-w-[calc(100vw-2rem-env(safe-area-inset-right,0px))] items-start rounded-lg border border-black/10 bg-ivory p-2 text-charcoal shadow-[0_3px_16px_rgba(0,0,0,0.06)] ${promptVisible ? "visible" : "invisible pointer-events-none"}`}>
      <a id="product-chat-size-prompt" href={href} target="_blank" rel="noopener noreferrer" tabIndex={promptVisible ? 0 : -1} onClick={closePrompt}
        className="min-w-0 flex-1 rounded px-2 py-1 text-xs leading-5 text-charcoal/80 hover:text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">Don't have your size?{" "}<span className="whitespace-nowrap">Chat with us</span></a>

    </div>
  </div>;
}
