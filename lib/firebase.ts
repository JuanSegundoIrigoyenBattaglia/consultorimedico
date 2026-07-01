import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

type FirebaseServices = {
  app: FirebaseApp;
  auth: Auth;
  googleProvider: GoogleAuthProvider;
  db: Firestore;
};

let services: FirebaseServices | null = null;
let appCheckStarted = false;

export function getFirebaseServices() {
  if (typeof window === "undefined") {
    throw new Error("Firebase solo debe inicializarse en el navegador.");
  }

  if (services) {
    return services;
  }

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };

  const requiredConfig = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.storageBucket,
    firebaseConfig.messagingSenderId,
    firebaseConfig.appId,
  ];

  if (requiredConfig.some((value) => !value)) {
    throw new Error("Faltan variables NEXT_PUBLIC_FIREBASE_* en la configuracion del entorno.");
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

  if (!appCheckStarted && process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckStarted = true;
  }

  services = {
    app,
    auth: getAuth(app),
    googleProvider: new GoogleAuthProvider(),
    db: getFirestore(app),
  };

  return services;
}
