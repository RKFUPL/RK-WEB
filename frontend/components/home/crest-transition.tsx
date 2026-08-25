import { footerSignatureArtwork } from '@/lib/home-content';

export function CrestTransition() {
  return (
    <div className="footer-signature-art-wrap">
      <img src={footerSignatureArtwork} alt="Rashi Kapoor crest" className="footer-signature-art" />
    </div>
  );
}
