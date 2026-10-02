import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en  from './locales/en.json';
import es  from './locales/es.json';
import zh  from './locales/zh.json';
import pcm from './locales/pcm.json';
import pt  from './locales/pt.json';
import fr  from './locales/fr.json';
import de  from './locales/de.json';
import sw  from './locales/sw.json';
import hi  from './locales/hi.json';
import ar  from './locales/ar.json';

export const LANGUAGES = [
  { code: 'en',  label: 'English',    flag: '🇺🇸' },
  { code: 'es',  label: 'Español',    flag: '🇪🇸' },
  { code: 'zh',  label: '中文',        flag: '🇨🇳' },
  { code: 'hi',  label: 'हिन्दी',      flag: '🇮🇳' },
  { code: 'ar',  label: 'العربية',    flag: '🇸🇦' },
  { code: 'pcm', label: 'Naija',      flag: '🇳🇬' },
  { code: 'pt',  label: 'Português',  flag: '🇧🇷' },
  { code: 'fr',  label: 'Français',   flag: '🇫🇷' },
  { code: 'de',  label: 'Deutsch',    flag: '🇩🇪' },
  { code: 'sw',  label: 'Kiswahili',  flag: '🇰🇪' },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en:  { translation: en  },
      es:  { translation: es  },
      zh:  { translation: zh  },
      hi:  { translation: hi  },
      ar:  { translation: ar  },
      pcm: { translation: pcm },
      pt:  { translation: pt  },
      fr:  { translation: fr  },
      de:  { translation: de  },
      sw:  { translation: sw  },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
