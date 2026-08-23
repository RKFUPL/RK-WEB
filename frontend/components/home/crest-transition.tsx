import { footerSignatureDarkImage, footerSignatureLightImage } from '@/lib/home-content';

function CrestOrnament({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      className={`footer-signature-ornament footer-signature-ornament-${side}`}
      viewBox="0 0 240 54"
      fill="none"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
        <path d="M6 27H58C72 27 78 21 91 21C108 21 116 27 132 27C149 27 158 21 174 21C193 21 205 25 235 27" />
        <path d="M7 31C22 31 32 28 43 24" opacity="0.62" />
        <path d="M219 27C224 21 230 21 235 27C230 33 224 33 219 27Z" />
        <path d="M6 23L10 27L6 31" />
      </g>
      <path d="M232 27L236 23L240 27L236 31Z" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

export function CrestTransition() {
  return (
    <div className="footer-signature-ornament-row">
      <CrestOrnament side="left" />
      <div className="footer-signature-art-wrap">
        <img src={footerSignatureLightImage} alt="Rashi Kapoor floral monogram" className="footer-signature-art footer-signature-light" />
        <img src={footerSignatureDarkImage} alt="Rashi Kapoor floral monogram" className="footer-signature-art footer-signature-dark" />
      </div>
      <CrestOrnament side="right" />
    </div>
  );
}
