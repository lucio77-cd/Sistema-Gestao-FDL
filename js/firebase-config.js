import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCjamudm8uZozg0T6Xd9_Anc0cSz7wqoBA",
  authDomain: "sistema-gv-fdl.firebaseapp.com",
  projectId: "sistema-gv-fdl",
  storageBucket: "sistema-gv-fdl.firebasestorage.app",
  messagingSenderId: "1023604721555",
  appId: "1:1023604721555:web:46d9f5bc3daef29a7e8a66",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
