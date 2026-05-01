'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Locale = 'en' | 'fr';

type Dict = Record<string, string>;

const DICTIONARY: Record<Locale, Dict> = {
  en: {
    'nav.signIn': 'Sign in',
    'nav.startTrial': 'Start free trial',
    'nav.pricing': 'Pricing',
    'cta.startTrial': 'Start free trial',
    'cta.seeInAction': 'See it in action',
    'cta.signIn': 'Sign in',
    'home.eyebrow': 'Built for Canadian immigration law firms',
    'home.heroLeft': 'The operating system for',
    'home.heroRight': 'Canadian immigration practices.',
    'home.subhead':
      'Walk-ins, leads, intake forms, consultations, retainers, IRCC submissions, and billing — one workspace your whole firm uses, from the receptionist to the principal lawyer.',
    'home.trialNote': '14-day trial · No credit card · Cancel anytime',
    'home.flowEyebrow': 'One workflow, end to end',
    'home.flow1.title': 'Walk-in or lead arrives',
    'home.flow1.detail':
      'Phone-first lookup. Existing clients show up with their full history; new ones become a lead in one click.',
    'home.flow2.title': 'Send intake form',
    'home.flow2.detail':
      'Branded form via email, SMS, or QR. Client fills on their own phone. You see the answers the moment they submit.',
    'home.flow3.title': 'Book consult, run case',
    'home.flow3.detail':
      'Booking gates on intake completion. Cases track retainers, documents, AI-extracted IRCC data, and payments.',
    'home.cta2.title': 'Ready to try it?',
    'home.cta2.body': 'The trial is 14 days, no card required. We’ll set you up in under five minutes.',
    'pricing.title': 'Simple, per-seat pricing',
    'pricing.subhead':
      '14-day free trial on every plan. No credit card to start. Switch tiers anytime — you only pay for active users.',
    'pricing.faq.title': 'Common questions',
    'pricing.cta.title': 'Still deciding?',
    'pricing.cta.body':
      'The trial is 14 days, no card required. We’ll set you up in under five minutes.',
    'pricing.cta.btn': 'Start free trial',
    'pricing.cta.contact': 'Talk to sales',
    'signin.title': 'Sign in',
    'signin.subhead': 'Welcome back. Sign in with your firm email and password.',
    'signin.email': 'Email',
    'signin.password': 'Password',
    'signin.submit': 'Sign in',
    'signin.forgot': 'Forgot password?',
    'signup.title': 'Start your free trial',
    'signup.subhead': '14 days, no credit card. We’ll email you a link to finish setup.',
    'signup.legalName': 'Firm legal name',
    'signup.displayName': 'Display name (what clients see)',
    'signup.slug': 'Workspace URL slug',
    'signup.contactName': 'Your name',
    'signup.contactEmail': 'Your email',
    'signup.submit': 'Send setup email',
    'signup.terms':
      'By signing up you agree to our terms. Already have an account?',
    'signup.signin': 'Sign in',
    'demo.eyebrow': 'You’re seeing what an OnsecBoad client sees.',
    'demo.note':
      'This is a sample intake form. Nothing here is saved — fill it in to feel the flow, then sign up to build your own forms with the fields your firm needs.',
    'demo.title': 'Sample Immigration Intake',
    'demo.subhead': 'Once submitted, the form locks and your immigration consultant takes over.',
    'demo.submit': 'Submit demo',
    'footer.poweredBy': 'Hosted in Canada',
  },
  fr: {
    'nav.signIn': 'Se connecter',
    'nav.startTrial': 'Essai gratuit',
    'nav.pricing': 'Tarifs',
    'cta.startTrial': 'Commencer l’essai',
    'cta.seeInAction': 'Voir le produit',
    'cta.signIn': 'Se connecter',
    'home.eyebrow': 'Conçu pour les cabinets d’immigration canadiens',
    'home.heroLeft': 'Le système d’exploitation pour',
    'home.heroRight': 'les cabinets d’immigration canadiens.',
    'home.subhead':
      'Visites au comptoir, prospects, formulaires d’accueil, consultations, mandats, soumissions IRCC et facturation — un seul espace de travail pour tout votre cabinet, de la réception à l’avocat principal.',
    'home.trialNote': 'Essai 14 jours · Sans carte de crédit · Annulez quand vous voulez',
    'home.flowEyebrow': 'Un flux de travail, du début à la fin',
    'home.flow1.title': 'Visite ou prospect arrive',
    'home.flow1.detail':
      'Recherche par numéro de téléphone. Les clients existants apparaissent avec leur historique complet ; les nouveaux deviennent un prospect en un clic.',
    'home.flow2.title': 'Envoyer le formulaire d’accueil',
    'home.flow2.detail':
      'Formulaire personnalisé par courriel, SMS ou QR. Le client le remplit sur son téléphone. Vous voyez les réponses dès la soumission.',
    'home.flow3.title': 'Réserver une consultation, gérer le dossier',
    'home.flow3.detail':
      'La prise de rendez-vous dépend de l’accueil rempli. Les dossiers suivent les mandats, documents, données IRCC extraites par IA et paiements.',
    'home.cta2.title': 'Prêt à l’essayer ?',
    'home.cta2.body':
      'L’essai dure 14 jours, sans carte. Configuration en moins de cinq minutes.',
    'pricing.title': 'Tarification simple, par utilisateur',
    'pricing.subhead':
      'Essai gratuit de 14 jours sur tous les plans. Sans carte. Changez de palier à tout moment — vous ne payez que pour les utilisateurs actifs.',
    'pricing.faq.title': 'Questions fréquentes',
    'pricing.cta.title': 'Encore en réflexion ?',
    'pricing.cta.body':
      'L’essai dure 14 jours, sans carte. Configuration en moins de cinq minutes.',
    'pricing.cta.btn': 'Commencer l’essai',
    'pricing.cta.contact': 'Parler aux ventes',
    'signin.title': 'Se connecter',
    'signin.subhead':
      'Bon retour. Connectez-vous avec votre courriel professionnel et votre mot de passe.',
    'signin.email': 'Courriel',
    'signin.password': 'Mot de passe',
    'signin.submit': 'Se connecter',
    'signin.forgot': 'Mot de passe oublié ?',
    'signup.title': 'Commencer votre essai gratuit',
    'signup.subhead':
      '14 jours, sans carte de crédit. Nous vous enverrons un lien pour finir la configuration.',
    'signup.legalName': 'Raison sociale du cabinet',
    'signup.displayName': 'Nom affiché (vu par les clients)',
    'signup.slug': 'Identifiant URL de l’espace',
    'signup.contactName': 'Votre nom',
    'signup.contactEmail': 'Votre courriel',
    'signup.submit': 'Envoyer le courriel de configuration',
    'signup.terms':
      'En vous inscrivant, vous acceptez nos conditions. Vous avez déjà un compte ?',
    'signup.signin': 'Se connecter',
    'demo.eyebrow': 'Voici ce que voit un client OnsecBoad.',
    'demo.note':
      'Ceci est un formulaire d’accueil de démonstration. Rien n’est sauvegardé — remplissez-le pour ressentir le flux, puis inscrivez-vous pour créer vos propres formulaires.',
    'demo.title': 'Accueil immigration (exemple)',
    'demo.subhead':
      'Une fois soumis, le formulaire se verrouille et votre consultant en immigration prend le relais.',
    'demo.submit': 'Soumettre la démo',
    'footer.poweredBy': 'Hébergé au Canada',
  },
};

const COOKIE_NAME = 'onsec.locale';

function readLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const cookie = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (cookie) {
    const v = cookie.slice(COOKIE_NAME.length + 1);
    if (v === 'fr' || v === 'en') return v;
  }
  const nav = (navigator.language ?? '').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : 'en';
}

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
}>({
  locale: 'en',
  setLocale: () => undefined,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  useEffect(() => {
    setLocaleState(readLocale());
  }, []);
  function setLocale(l: Locale): void {
    if (typeof document !== 'undefined') {
      document.cookie = `${COOKIE_NAME}=${l}; path=/; max-age=${60 * 60 * 24 * 365}`;
    }
    setLocaleState(l);
  }
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>
  );
}

export function useT(): {
  t: (key: string, fallback?: string) => string;
  locale: Locale;
  setLocale: (l: Locale) => void;
} {
  const ctx = useContext(LocaleContext);
  return {
    t: (key: string, fallback?: string) =>
      DICTIONARY[ctx.locale]?.[key] ?? DICTIONARY.en[key] ?? fallback ?? key,
    locale: ctx.locale,
    setLocale: ctx.setLocale,
  };
}

export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useT();
  return (
    <div
      className={
        'inline-flex items-center gap-0.5 rounded-[var(--radius-pill)] border border-[var(--color-border)] p-0.5 text-[10px] font-semibold ' +
        className
      }
    >
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={
          'rounded-[var(--radius-pill)] px-2 py-0.5 ' +
          (locale === 'en'
            ? 'bg-[var(--color-primary)] text-white'
            : 'text-[var(--color-text-muted)]')
        }
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale('fr')}
        className={
          'rounded-[var(--radius-pill)] px-2 py-0.5 ' +
          (locale === 'fr'
            ? 'bg-[var(--color-primary)] text-white'
            : 'text-[var(--color-text-muted)]')
        }
      >
        FR
      </button>
    </div>
  );
}
