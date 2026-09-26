import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import './styles.css';

const DOWNLOAD_URL = '/download/android';

const steps = [
  {
    title: 'Download the APK',
    body: 'Tap the download button on your Android phone. Your browser may warn about the file type; keep it.',
  },
  {
    title: 'Allow the install',
    body: 'Open the file and let your browser install unknown apps when Android asks. Sodera is not on Play yet.',
  },
  {
    title: 'Create your wallet',
    body: 'Android asks you to create a passkey. That passkey is your wallet. No seed phrase, no password.',
  },
  {
    title: 'Claim a name, set Home',
    body: 'Pick a free name.sodera.eth, then choose Sodera as your Home app. Press Home any time to get back.',
  },
];

const features = [
  {
    label: 'PASSKEY',
    title: 'Seedless by design',
    body: 'A smart account controlled by the passkey on your phone. Nothing to write down, nothing to lose.',
  },
  {
    label: 'ENS',
    title: 'A name, not a hex string',
    body: 'Every wallet gets a verified name.sodera.eth. Send to names; Sodera resolves them on-chain.',
  },
  {
    label: 'DERA',
    title: 'Ask, review, sign',
    body: 'Tell Dera what you want to do in plain words. It returns a plan you review before anything is signed.',
  },
  {
    label: 'HOME',
    title: 'Your wallet is your launcher',
    body: 'Balance, swaps, and earn live on the home screen, with all your apps one swipe away.',
  },
];

function Phone({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`phone ${className}`}>
      <img src={src} alt={alt} loading="eager" />
    </div>
  );
}

function DownloadButton() {
  return (
    <a className="button primary" href={DOWNLOAD_URL} download="sodera.apk">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14" />
      </svg>
      Download for Android
    </a>
  );
}

function Landing() {
  return (
    <>
      <header className="nav">
        <a className="brand" href="/">
          <span className="brand-dot" />
          SODERA
        </a>
        <span className="chip">
          <span className="pulse" />
          LIVE ON SEPOLIA
        </span>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">WALLET MEETS HOME</p>
            <h1>Your wallet, right at home.</h1>
            <p className="lede">
              Sodera is a seedless smart-account wallet that replaces your Android home screen. A passkey controls
              your account, a Sodera name replaces your address, and your money is one tap from Home.
            </p>
            <div className="actions">
              <DownloadButton />
              <a className="button" href="#try">
                How to install
              </a>
            </div>
            <p className="meta">APK · 56 MB · ANDROID · SEPOLIA TESTNET · NO REAL FUNDS</p>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="glow" />
            <Phone src="/screens/onboarding.jpg" alt="" className="back" />
            <Phone src="/screens/home.jpg" alt="Sodera home screen with wallet balance and market prices" />
          </div>
        </section>

        <section className="try" id="try">
          <p className="eyebrow">TRY IT IN TWO MINUTES</p>
          <h2>Install Sodera on your phone.</h2>
          <ol className="steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="step-index">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="gallery">
            <Phone src="/screens/onboarding.jpg" alt="Onboarding: your wallet, right at home" />
            <Phone src="/screens/claim.jpg" alt="Claiming a sodera.eth name" />
            <Phone src="/screens/home.jpg" alt="Sodera as the Android home screen" />
            <Phone src="/screens/wallet.jpg" alt="Wallet with send, receive, and swap" />
          </div>
        </section>

        <section className="features">
          {features.map((feature) => (
            <article key={feature.title}>
              <p className="eyebrow">{feature.label}</p>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </section>

        <section className="cta">
          <h2>No seed phrase. Just your phone.</h2>
          <p>Sodera runs on the Ethereum Sepolia testnet. Test assets only; nothing here costs real money.</p>
          <DownloadButton />
        </section>
      </main>

      <footer>
        <span>sodera.xyz</span>
        <span>Built for ETHGlobal Tokyo</span>
      </footer>
    </>
  );
}

const router = createBrowserRouter([{ path: '*', element: <Landing /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
